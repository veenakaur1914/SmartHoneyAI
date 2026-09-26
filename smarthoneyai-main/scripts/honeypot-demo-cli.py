#!/usr/bin/env python3
"""Presentation CLI for the authorized SmartHoneyAI WordPress demo target."""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python 3.9+ includes zoneinfo.
    ZoneInfo = None  # type: ignore[assignment]


TARGET_HOST = "demo.finalyearproject.my"
TARGET_ORIGIN = f"https://{TARGET_HOST}"
BLOCK_MESSAGE = "Request denied by site security automation."
ROOT = Path(__file__).resolve().parent.parent
STORE_PATH = Path(
    os.environ.get(
        "HONEYPOT_DEMO_ENDPOINTS_FILE",
        ROOT / "output" / "crawler" / "custom-endpoints.json",
    )
).expanduser()
REPORT_PATH = ROOT / "output" / "crawler" / "last-run.json"
ATTACK_REPORT_PATH = ROOT / "output" / "crawler" / "last-attack-types-run.json"

ATTACK_TYPE_ENDPOINTS = [
    {
        "path": "/database/query",
        "label": "SQL injection honeypot",
        "threatType": "SQL_INJECTION",
        "method": "POST",
        "form": {"query": "SELECT * FROM users WHERE id = 1 OR 1=1", "authorizedTest": "true"},
    },
    {
        "path": "/preview/render",
        "label": "XSS honeypot",
        "threatType": "XSS",
        "method": "POST",
        "form": {"content": "<script>console.log('SmartHoneyAI authorized XSS test')</script>", "authorizedTest": "true"},
    },
    {
        "path": "/system/diagnostics",
        "label": "Command injection honeypot",
        "threatType": "COMMAND_INJECTION",
        "method": "POST",
        "form": {"command": "id; printf SMARTHONEYAI_AUTHORIZED_COMMAND_TEST", "authorizedTest": "true"},
    },
]

BUILT_IN_ENDPOINTS = [
    *[{"path": item["path"], "label": item["label"]} for item in ATTACK_TYPE_ENDPOINTS],
    {"path": "/adminer.php", "label": "Adminer database console"},
    {"path": "/actuator/env", "label": "Application environment endpoint"},
    {"path": "/wp-content/backups/site-backup.zip", "label": "Backup archive"},
    {"path": "/phpmyadmin", "label": "Database administration"},
    {"path": "/backup.sql", "label": "Database backup"},
    {"path": "/env", "label": "Environment diagnostic endpoint"},
    {"path": "/secure-admin-login", "label": "Fake administration login"},
    {"path": "/internal/admin-console", "label": "Internal administration console"},
    {"path": "/server-diagnostics", "label": "Server diagnostic endpoint"},
    {"path": "/git-config", "label": "Source control diagnostic endpoint"},
    {"path": "/wp-config-backup", "label": "WordPress configuration diagnostic"},
    {"path": "/debug-log", "label": "WordPress debug diagnostic"},
]

PATH_PATTERN = re.compile(r"/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,511}\Z")
CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


class Colour:
    enabled = sys.stdout.isatty() and "NO_COLOR" not in os.environ
    cyan = "\033[96m" if enabled else ""
    green = "\033[92m" if enabled else ""
    yellow = "\033[93m" if enabled else ""
    red = "\033[91m" if enabled else ""
    bold = "\033[1m" if enabled else ""
    dim = "\033[2m" if enabled else ""
    reset = "\033[0m" if enabled else ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def malaysia_now() -> datetime:
    if ZoneInfo is not None:
        return datetime.now(ZoneInfo("Asia/Kuala_Lumpur"))
    return datetime.now(timezone(timedelta(hours=8)))


def banner() -> None:
    print(f"{Colour.cyan}{Colour.bold}")
    print("╔══════════════════════════════════════════════════════╗")
    print("║       SMARTHONEYAI — AUTHORIZED ATTACK DEMO         ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"{Colour.reset}Target locked: {Colour.bold}{TARGET_ORIGIN}{Colour.reset}")
    print("Real HTTPS requests • Observe-mode auto-block • MYT\n")


def validate_path(raw_path: str) -> str:
    path = raw_path.strip()
    parsed = urllib.parse.urlsplit(path)
    decoded = urllib.parse.unquote(path)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("Endpoint must be one absolute path without a domain, query, or fragment.")
    if not PATH_PATTERN.fullmatch(path):
        raise ValueError("Endpoint must start with / and contain only URL-safe path characters.")
    if "\\" in decoded or CONTROL_PATTERN.search(decoded):
        raise ValueError("Endpoint cannot contain backslashes or control characters.")
    if any(segment == ".." for segment in decoded.split("/")):
        raise ValueError("Endpoint traversal segments are not allowed.")
    return "/" + path.strip("/") if path != "/" else "/"


def validate_label(raw_label: str) -> str:
    label = " ".join(raw_label.strip().split())
    if not label or len(label) > 80 or CONTROL_PATTERN.search(label):
        raise ValueError("Label must contain 1-80 printable characters.")
    return label


def atomic_json_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_custom_endpoints() -> list[dict[str, str]]:
    if not STORE_PATH.exists():
        return []
    try:
        document = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot read endpoint store {STORE_PATH}: {error}") from error
    if document.get("domain") != TARGET_HOST or not isinstance(document.get("endpoints"), list):
        raise ValueError("Endpoint store is invalid or belongs to a different domain.")
    endpoints = []
    for item in document["endpoints"]:
        if not isinstance(item, dict):
            raise ValueError("Endpoint store contains an invalid row.")
        endpoints.append(
            {"path": validate_path(str(item.get("path", ""))), "label": validate_label(str(item.get("label", "")))}
        )
    return endpoints


def save_custom_endpoints(endpoints: list[dict[str, str]]) -> None:
    atomic_json_write(
        STORE_PATH,
        {"domain": TARGET_HOST, "updatedAtMYT": malaysia_now().isoformat(), "endpoints": endpoints},
    )


def combined_endpoints(custom_first: bool = False) -> list[dict[str, str]]:
    seen: set[str] = set()
    combined: list[dict[str, str]] = []
    custom = load_custom_endpoints()
    ordered = [*custom, *BUILT_IN_ENDPOINTS] if custom_first else [*BUILT_IN_ENDPOINTS, *custom]
    for endpoint in ordered:
        key = endpoint["path"].lower()
        if key not in seen:
            combined.append(endpoint)
            seen.add(key)
    return combined


def add_endpoint(path: str, label: str) -> None:
    normalized_path = validate_path(path)
    normalized_label = validate_label(label)
    existing = combined_endpoints()
    if any(item["path"].lower() == normalized_path.lower() for item in existing):
        raise ValueError(f"Endpoint already exists: {normalized_path}")
    custom = load_custom_endpoints()
    custom.append({"path": normalized_path, "label": normalized_label})
    save_custom_endpoints(custom)
    print(f"{Colour.green}ADDED{Colour.reset} {normalized_path} — {normalized_label}")
    print("This crawler path must also exist and be synchronized in SmartHoneyAI before a real run.")
    print("Use the run --custom-first option to exercise custom routes before auto-blocking.")


def remove_endpoint(path: str) -> None:
    normalized_path = validate_path(path)
    custom = load_custom_endpoints()
    remaining = [item for item in custom if item["path"].lower() != normalized_path.lower()]
    if len(remaining) == len(custom):
        raise ValueError(f"Custom endpoint not found: {normalized_path}")
    save_custom_endpoints(remaining)
    print(f"{Colour.yellow}REMOVED{Colour.reset} {normalized_path}")


def list_endpoints() -> None:
    custom_paths = {item["path"].lower() for item in load_custom_endpoints()}
    endpoints = combined_endpoints()
    print(f"\n{Colour.bold}{len(endpoints)} presentation endpoints for {TARGET_HOST}{Colour.reset}")
    print("─" * 78)
    for index, endpoint in enumerate(endpoints, start=1):
        source = "CUSTOM" if endpoint["path"].lower() in custom_paths else "BUILT-IN"
        print(f"{index:>2}. {endpoint['path']:<42} {source:<8} {endpoint['label']}")
    print()


def make_url(path: str, run_id: str, step: int) -> str:
    if path == "/":
        return f"{TARGET_ORIGIN}/"
    query = urllib.parse.urlencode({"authorizedCrawler": run_id, "step": step})
    return urllib.parse.urlunsplit(("https", TARGET_HOST, path, query, ""))


def wake_wordpress_cron(run_id: str, timeout: float) -> dict[str, Any]:
    query = urllib.parse.urlencode({
        "doing_wp_cron": f"{time.time():.6f}",
        "authorizedCrawler": run_id,
        "purpose": "alert-delivery",
    })
    url = urllib.parse.urlunsplit(("https", TARGET_HOST, "/wp-cron.php", query, ""))
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "text/plain,*/*;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": f"SmartHoneyAI-PythonCLI/1.1 ({run_id})",
        },
    )
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    body = response.read(64 * 1024).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    return {
        "path": "/wp-cron.php",
        "status": int(response.status),
        "contentType": response.headers.get("Content-Type", "unknown"),
        "preview": " ".join(body.split())[:120],
    }


def request_endpoint(
    path: str,
    run_id: str,
    step: int,
    timeout: float,
    method: str = "GET",
    form: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = make_url(path, run_id, step)
    body = urllib.parse.urlencode(form).encode("utf-8") if form else None
    headers = {
        "Accept": "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": f"SmartHoneyAI-PythonCLI/1.1 ({run_id})",
    }
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers=headers,
    )
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    body_bytes = response.read(512 * 1024)
    body = body_bytes.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    preview = " ".join(body.split())[:120]
    return {
        "path": path,
        "status": int(response.status),
        "contentType": response.headers.get("Content-Type", "unknown"),
        "preview": preview,
        "body": body,
    }


def is_automation_block(result: dict[str, Any]) -> bool:
    return result["status"] == 403 and result["body"].strip() == BLOCK_MESSAGE


def is_inert_honeypot_response(result: dict[str, Any]) -> bool:
    content_type = result["contentType"].lower()
    body = result["body"].strip()
    if result["status"] == 404 and content_type.startswith("text/plain"):
        return body == "Resource not found."
    if result["status"] == 404 and content_type.startswith("application/json"):
        try:
            return json.loads(body) == {"error": "endpoint_not_found", "status": 404}
        except json.JSONDecodeError:
            return False
    if result["status"] == 401 and content_type.startswith("text/html"):
        return "Authorized operators only." in body and '<form method="post"' in body
    return False


def countdown(seconds: int) -> None:
    print(f"\n{Colour.yellow}{Colour.bold}AUTHORIZED ATTACK STARTS IN{Colour.reset}")
    for number in range(seconds, 0, -1):
        print(f"{Colour.red}{Colour.bold}{number}...{Colour.reset}", flush=True)
        time.sleep(1)
    print(f"{Colour.red}{Colour.bold}ATTACK STARTED — REAL CRAWLING ACTIVE{Colour.reset}\n", flush=True)


def run_crawler(args: argparse.Namespace) -> int:
    endpoints = combined_endpoints(custom_first=args.custom_first)
    if args.max_endpoints is not None:
        endpoints = endpoints[: args.max_endpoints]
    run_id = f"python-cli-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.dry_run:
        print(json.dumps({
            "dryRun": True,
            "lockedTarget": TARGET_ORIGIN,
            "runId": run_id,
            "delaySeconds": args.delay,
            "timeoutSeconds": args.timeout,
            "endpoints": endpoints,
            "finalVerification": "/",
        }, indent=2))
        return 0

    banner()
    print(f"{Colour.yellow}WARNING:{Colour.reset} this real demo can block your current public IP for 24 hours.")
    if not args.yes:
        confirmation = input("Type ATTACK to continue: ").strip()
        if confirmation != "ATTACK":
            print("Cancelled. No network requests were sent.")
            return 2

    countdown(args.countdown)
    attempts: list[dict[str, Any]] = []
    blocked_at: str | None = None

    for index, endpoint in enumerate(endpoints, start=1):
        path = endpoint["path"]
        print(f"[{index:02}] GET {path:<44}", end=" ", flush=True)
        try:
            result = request_endpoint(path, run_id, index, args.timeout)
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            print(f"{Colour.red}NETWORK ERROR{Colour.reset}")
            raise RuntimeError(f"Real request failed for {path}: {error}") from error

        attempt = {key: result[key] for key in ("path", "status", "contentType", "preview")}
        attempt["verifiedHoneypot"] = is_inert_honeypot_response(result)
        attempts.append(attempt)
        if is_automation_block(result):
            blocked_at = path
            print(f"{Colour.red}{Colour.bold}403 — BANNED / AUTO-BLOCK TRIGGERED{Colour.reset}")
            break
        if is_inert_honeypot_response(result):
            print(f"{Colour.green}{result['status']} — HONEYPOT HIT{Colour.reset}")
        else:
            print(f"{Colour.red}{result['status']} — UNEXPECTED RESPONSE{Colour.reset}")
            raise RuntimeError(
                f"{path} did not return a verified SmartHoneyAI inert template. "
                f"Received HTTP {result['status']}: {result['preview']}"
            )
        if index < len(endpoints):
            time.sleep(args.delay)

    print("\nVerifying that the attacker can no longer open the real homepage...")
    homepage = request_endpoint("/", run_id, len(attempts) + 1, args.timeout)
    if not is_automation_block(homepage):
        raise RuntimeError(
            f"Block was not proven on /; received HTTP {homepage['status']}: {homepage['preview']}"
        )

    print(f"{Colour.red}{Colour.bold}403 / — ACCESS DENIED FOR THIS ATTACKER{Colour.reset}")
    print(f"{Colour.green}{Colour.bold}\nPASS: REAL 24-HOUR HONEYPOT AUTO-BLOCK VERIFIED{Colour.reset}")
    print(f"MYT: {malaysia_now().strftime('%d %b %Y, %I:%M:%S %p MYT')}")
    print(f"Distinct honeypots accepted before block: {sum(item['verifiedHoneypot'] for item in attempts)}")
    print(f"Block first observed at: {blocked_at or '/'}")

    report = {
        "status": "PASS",
        "realNetworkTest": True,
        "lockedTarget": TARGET_ORIGIN,
        "runId": run_id,
        "completedAtMYT": malaysia_now().isoformat(),
        "distinctHoneypotResponses": sum(item["verifiedHoneypot"] for item in attempts),
        "blockedAt": blocked_at or "/",
        "homepageStatus": homepage["status"],
        "blockMessage": homepage["body"].strip(),
        "attempts": attempts,
    }
    atomic_json_write(REPORT_PATH, report)
    print(f"Evidence: {REPORT_PATH}")
    return 0


def run_attack_types(args: argparse.Namespace) -> int:
    run_id = f"attack-types-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    if args.dry_run:
        print(json.dumps({
            "dryRun": True,
            "lockedTarget": TARGET_ORIGIN,
            "runId": run_id,
            "sequence": [
                {"method": item["method"], "path": item["path"], "threatType": item["threatType"]}
                for item in ATTACK_TYPE_ENDPOINTS
            ],
            "finalVerification": "/",
            "deliveryWake": {
                "path": "/wp-cron.php",
                "waitSeconds": args.delivery_wait,
            },
            "expectedTelegramAlerts": 3,
        }, indent=2))
        return 0

    banner()
    print(f"{Colour.yellow}WARNING:{Colour.reset} this real test submits three inert synthetic payloads and blocks your current public IP for 24 hours.")
    print("Expected Telegram result: SQL INJECTION, XSS, and COMMAND INJECTION alerts.")
    if not args.yes:
        confirmation = input("Type ATTACK to continue: ").strip()
        if confirmation != "ATTACK":
            print("Cancelled. No network requests were sent.")
            return 2

    countdown(args.countdown)
    attempts: list[dict[str, Any]] = []
    for index, endpoint in enumerate(ATTACK_TYPE_ENDPOINTS, start=1):
        print(f"[{index:02}] {endpoint['method']} {endpoint['path']:<39} {endpoint['threatType']:<18}", end=" ", flush=True)
        try:
            result = request_endpoint(
                endpoint["path"],
                run_id,
                index,
                args.timeout,
                method=endpoint["method"],
                form=endpoint["form"],
            )
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            print(f"{Colour.red}NETWORK ERROR{Colour.reset}")
            raise RuntimeError(f"Real request failed for {endpoint['path']}: {error}") from error

        if is_automation_block(result):
            print(f"{Colour.red}BLOCKED BEFORE THIS TYPE COULD TRIGGER{Colour.reset}")
            raise RuntimeError(
                "The source was already auto-blocked or had recent honeypot hits. "
                "Wait for the existing block to expire before running all three attack types."
            )
        verified = is_inert_honeypot_response(result)
        attempts.append({
            "method": endpoint["method"],
            "path": endpoint["path"],
            "threatType": endpoint["threatType"],
            "status": result["status"],
            "contentType": result["contentType"],
            "verifiedHoneypot": verified,
        })
        if not verified:
            print(f"{Colour.red}{result['status']} — UNEXPECTED RESPONSE{Colour.reset}")
            raise RuntimeError(
                f"{endpoint['path']} did not return a verified SmartHoneyAI inert template. "
                f"Received HTTP {result['status']}: {result['preview']}"
            )
        print(f"{Colour.green}{result['status']} — HONEYPOT HIT{Colour.reset}")
        if index < len(ATTACK_TYPE_ENDPOINTS):
            time.sleep(args.delay)

    print("\nVerifying repeat-attacker containment after all three classified events...")
    homepage = request_endpoint("/", run_id, len(attempts) + 1, args.timeout)
    if not is_automation_block(homepage):
        raise RuntimeError(
            f"All three honeypots triggered, but the expected homepage block was not proven; "
            f"received HTTP {homepage['status']}: {homepage['preview']}"
        )

    print(f"\nWaiting {args.delivery_wait:g} seconds for the scheduled event-spool delivery...")
    time.sleep(args.delivery_wait)
    try:
        cron = wake_wordpress_cron(run_id, args.timeout)
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"The honeypots passed, but the WordPress delivery queue could not be woken: {error}") from error
    if cron["status"] != 200:
        raise RuntimeError(
            "The honeypots passed, but WordPress did not accept the alert-delivery queue wake; "
            f"received HTTP {cron['status']}: {cron['preview']}"
        )
    print(f"{Colour.green}200 /wp-cron.php — EVENT DELIVERY QUEUE WOKEN{Colour.reset}")

    report = {
        "status": "PASS",
        "realNetworkTest": True,
        "lockedTarget": TARGET_ORIGIN,
        "runId": run_id,
        "completedAtMYT": malaysia_now().isoformat(),
        "classifiedAttackTypes": [item["threatType"] for item in attempts],
        "expectedTelegramAlerts": len(attempts),
        "deliveryQueueWakeStatus": cron["status"],
        "homepageStatus": homepage["status"],
        "blockMessage": homepage["body"].strip(),
        "attempts": attempts,
    }
    atomic_json_write(ATTACK_REPORT_PATH, report)
    print(f"{Colour.green}{Colour.bold}\nPASS: ALL THREE ATTACK HONEYPOTS TRIGGERED{Colour.reset}")
    print(f"{Colour.red}403 / — REPEAT ATTACKER CONTAINED{Colour.reset}")
    print("Telegram pipeline requested: 3 incident alerts (SQL INJECTION, XSS, COMMAND INJECTION).")
    print(f"Evidence: {ATTACK_REPORT_PATH}")
    return 0


def interactive_menu() -> int:
    while True:
        banner()
        print("1. Start real honeypot attack demo")
        print("2. List presentation endpoints")
        print("3. Add a custom endpoint")
        print("4. Remove a custom endpoint")
        print("5. Reset custom endpoints")
        print("0. Exit")
        choice = input("\nSelect: ").strip()
        try:
            if choice == "1":
                return run_crawler(argparse.Namespace(
                    delay=1.0,
                    timeout=20.0,
                    countdown=3,
                    max_endpoints=None,
                    dry_run=False,
                    yes=False,
                    custom_first=False,
                ))
            if choice == "2":
                list_endpoints()
                input("Press Enter to return to the menu...")
            elif choice == "3":
                add_endpoint(input("Endpoint path (example /my-decoy): "), input("Display label: "))
                input("Press Enter to return to the menu...")
            elif choice == "4":
                remove_endpoint(input("Custom endpoint path to remove: "))
                input("Press Enter to return to the menu...")
            elif choice == "5":
                confirmation = input("Type RESET to remove all custom endpoints: ").strip()
                if confirmation == "RESET":
                    save_custom_endpoints([])
                    print("Custom endpoints reset.")
                else:
                    print("Reset cancelled.")
                input("Press Enter to return to the menu...")
            elif choice == "0":
                return 0
            else:
                print("Choose 0-5.")
                time.sleep(1)
        except (ValueError, RuntimeError) as error:
            print(f"{Colour.red}ERROR:{Colour.reset} {error}")
            input("Press Enter to return to the menu...")


def positive_float(value: str) -> float:
    number = float(value)
    if number <= 0 or number > 60:
        raise argparse.ArgumentTypeError("value must be greater than 0 and no more than 60")
    return number


def bounded_integer(minimum: int, maximum: int):
    def parse(value: str) -> int:
        number = int(value)
        if number < minimum or number > maximum:
            raise argparse.ArgumentTypeError(f"value must be from {minimum} to {maximum}")
        return number
    return parse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Domain-locked SmartHoneyAI presentation crawler for demo.finalyearproject.my."
    )
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run the real countdown and honeypot crawl")
    run_parser.add_argument("--yes", action="store_true", help="Skip the ATTACK confirmation prompt")
    run_parser.add_argument("--dry-run", action="store_true", help="Show the sequence without network requests")
    run_parser.add_argument("--delay", type=positive_float, default=1.0, help="Seconds between requests (default: 1)")
    run_parser.add_argument("--timeout", type=positive_float, default=20.0, help="Per-request timeout (default: 20)")
    run_parser.add_argument("--countdown", type=bounded_integer(0, 10), default=3, help="Countdown seconds (default: 3)")
    run_parser.add_argument("--max-endpoints", type=bounded_integer(1, 200), help="Maximum distinct endpoints to try")
    run_parser.add_argument(
        "--custom-first",
        action="store_true",
        help="Try saved custom routes before the synchronized built-ins",
    )

    attack_parser = subparsers.add_parser(
        "attack-types",
        help="Trigger SQL injection, XSS, and command injection honeypots in one authorized run",
    )
    attack_parser.add_argument("--yes", action="store_true", help="Skip the ATTACK confirmation prompt")
    attack_parser.add_argument("--dry-run", action="store_true", help="Show the sequence without network requests")
    attack_parser.add_argument("--delay", type=positive_float, default=1.0, help="Seconds between requests (default: 1)")
    attack_parser.add_argument("--timeout", type=positive_float, default=20.0, help="Per-request timeout (default: 20)")
    attack_parser.add_argument("--countdown", type=bounded_integer(0, 10), default=3, help="Countdown seconds (default: 3)")
    attack_parser.add_argument(
        "--delivery-wait",
        type=positive_float,
        default=12.0,
        help="Seconds to wait before waking WordPress event delivery (default: 12)",
    )

    subparsers.add_parser("list", help="List built-in and custom endpoints")
    add_parser = subparsers.add_parser("add", help="Add a custom path for this demo domain only")
    add_parser.add_argument("path")
    add_parser.add_argument("--label", required=True)
    remove_parser = subparsers.add_parser("remove", help="Remove a custom endpoint")
    remove_parser.add_argument("path")
    reset_parser = subparsers.add_parser("reset", help="Remove all custom endpoints")
    reset_parser.add_argument("--yes", action="store_true", help="Confirm the reset")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command is None:
            return interactive_menu()
        if args.command == "run":
            return run_crawler(args)
        if args.command == "attack-types":
            return run_attack_types(args)
        if args.command == "list":
            list_endpoints()
            return 0
        if args.command == "add":
            add_endpoint(args.path, args.label)
            return 0
        if args.command == "remove":
            remove_endpoint(args.path)
            return 0
        if args.command == "reset":
            if not args.yes:
                raise ValueError("Pass --yes to reset custom endpoints.")
            save_custom_endpoints([])
            print("Custom endpoints reset.")
            return 0
        parser.error("Unknown command")
    except (ValueError, RuntimeError) as error:
        print(f"{Colour.red}FAIL:{Colour.reset} {error}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
