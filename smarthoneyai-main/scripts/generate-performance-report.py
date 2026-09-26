#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pdfplumber
from PIL import Image as PILImage
from pypdf import PdfReader
from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if not ARTIFACT or not ARTIFACT.is_dir():
    raise SystemExit("Usage: generate-performance-report.py ARTIFACT_DIR")

RUN_ID = (ARTIFACT / "run-id.txt").read_text().strip() if (ARTIFACT / "run-id.txt").exists() else ARTIFACT.name
PDF_PATH = ROOT / "output" / "pdf" / f"honeypot-production-simulation-{RUN_ID.removeprefix('perf-')}.pdf"
RENDER_DIR = ROOT / "tmp" / "pdfs" / RUN_ID
PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
RENDER_DIR.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    values = []
    if not path.exists():
        return values
    with path.open(errors="replace") as handle:
        for line in handle:
            try:
                values.append(json.loads(line))
            except Exception:
                continue
    return values


def metric(summary: dict[str, Any], name: str, key: str, default: float = 0.0) -> float:
    try:
        return float(summary["data"]["metrics"][name]["values"][key])
    except Exception:
        return default


def finite_number(value: Any, minimum: float | None = None) -> bool:
    """Return True only for real, finite numeric evidence (booleans are not numbers here)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    number = float(value)
    return math.isfinite(number) and (minimum is None or number >= minimum)


def integer_or(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return fallback


def percentile(values: list[float], value: float) -> float:
    if not values:
        return math.inf
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(value * len(ordered)) - 1))
    return ordered[index]


def json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


summaries = []
for path in (ARTIFACT / "k6").glob("*-summary.json"):
    value = read_json(path, {})
    if value:
        value["_path"] = str(path)
        summaries.append(value)
summaries.sort(key=lambda item: item.get("generatedAt", ""))

telemetry = read_jsonl(ARTIFACT / "telemetry.jsonl")
faults = read_jsonl(ARTIFACT / "faults.jsonl")
bot = read_json(ARTIFACT / "bot-functional.json", {})
agent_security = read_json(ARTIFACT / "agent-security.json", {})
redis_replay_probe = read_json(ARTIFACT / "redis-replay-fail-closed.json", {})
redis_replay_recovered = read_json(ARTIFACT / "redis-replay-recovered.json", {})
rate_atomic = read_json(ARTIFACT / "rate-limit-atomic.json", {})
final_agent_reconciliation = read_json(ARTIFACT / "final-agent-reconciliation.json", {})
final_fleet_reconciliation = read_json(ARTIFACT / "final-fleet-reconciliation.json", {})
final_cleanup = read_json(ARTIFACT / "snapshots" / "final-cleanup.json", {})
natural_recovery = read_json(ARTIFACT / "snapshots" / "natural-recovery.json", {})
reconciliation = read_json(ARTIFACT / "event-reconciliation.json", {}) or {}
breakpoint = read_json(ARTIFACT / "breakpoint-result.json", {}) or {}
abort = read_json(ARTIFACT / "abort.json", None)
run_complete = read_json(ARTIFACT / "run-complete.json", {}) or {}
run_integrity = read_json(ARTIFACT / "run-integrity.json", {}) or {}
redaction_pre = read_json(ARTIFACT / "evidence-redaction-pre.json", {}) or {}
browser_ui_smoke = read_json(ARTIFACT / "browser-ui-smoke.json", {}) or {}
exposure_scan = read_json(ARTIFACT / "exposure-scan.json", {}) or {}
image_inventory = read_json(ARTIFACT / "versions" / "image-inventory.json", {}) or {}
reproducibility = read_json(ARTIFACT / "versions" / "reproducibility.json", {}) or {}
resolved_compose = read_json(ARTIFACT / "versions" / "resolved-compose.json", {}) or {}
final_analysis_queue = read_json(ARTIFACT / "final-analysis-queue.json", {}) or {}
browser_session_revocation = read_json(ARTIFACT / "browser-session-revocation.json", {}) or {}
playwright_temp_verification = read_json(ARTIFACT / "playwright-temp-verification.json", {}) or {}
original_demo_verification = read_json(ARTIFACT / "original-demo-verification.json", {}) or {}
finalization_status = read_json(ARTIFACT / "finalization-status.json", {}) or {}
continuous_profile_completed = run_integrity.get("continuousProfileCompleted") is True
soak_planned_seconds = int(run_integrity.get("soakPlannedSeconds", 1800))
soak_observed_seconds = int(run_integrity.get("soakObservedActiveSeconds", 0))

EXPECTED_QUALITY_GATES = {
    "lint",
    "typecheck",
    "node-tests",
    "production-build",
    "php-syntax",
    "plugin-package",
    "compose-config",
    "image-digests",
    "runtime-exposure",
    "phpunit",
}
quality = []
quality_path = ARTIFACT / "quality-gates.tsv"
if quality_path.exists():
    for line in quality_path.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            quality.append({"name": parts[0], "status": parts[1]})
quality_names = [item["name"] for item in quality]
quality_name_set = set(quality_names)
quality_duplicates = sorted({name for name in quality_names if quality_names.count(name) > 1})
quality_missing = sorted(EXPECTED_QUALITY_GATES - quality_name_set)
quality_unexpected = sorted(quality_name_set - EXPECTED_QUALITY_GATES)
quality_inventory_valid = (
    len(quality) == len(EXPECTED_QUALITY_GATES)
    and not quality_duplicates
    and not quality_missing
    and not quality_unexpected
    and all(item["status"] == "PASS" for item in quality)
)

phase_metrics = []
for summary in summaries:
    phase = summary.get("phase", "unknown")
    phase_metrics.append({
        "phase": phase,
        "rate": float(summary.get("rate", 0)),
        "duration": str(summary.get("duration", "")),
        "requests": metric(summary, "http_reqs", "count"),
        "achievedRps": metric(summary, "http_reqs", "rate", math.inf),
        "normalP95Ms": metric(summary, "normal_latency", "p(95)", math.inf),
        "normalP99Ms": metric(summary, "normal_latency", "p(99)", math.inf),
        "normalErrorRate": max(0.0, 1.0 - metric(summary, "normal_response_correct", "rate", 0)),
        "normalRequests": metric(summary, "normal_requests", "count"),
        "firewallP95Ms": metric(summary, "firewall_latency", "p(95)", math.inf),
        "firewallRequests": metric(summary, "firewall_requests", "count"),
        "firewallCorrect": metric(summary, "firewall_response_correct", "rate", 0),
        "honeypotCorrect": metric(summary, "honeypot_response_correct", "rate", 0),
        "rateCorrect": metric(summary, "rate_limit_response_correct", "rate", 0),
        "rateRequests": metric(summary, "rate_limit_requests", "count"),
        "platformCorrect": metric(summary, "platform_response_correct", "rate", 0),
        "platformRequests": metric(summary, "platform_requests", "count"),
        "honeypotRequests": metric(summary, "honeypot_requests", "count"),
        "honeypotCaptured": metric(summary, "honeypot_captured", "count"),
        "firewallBlocked": metric(summary, "firewall_blocked", "count"),
        "rateLimited": metric(summary, "rate_limited", "count"),
        "droppedIterations": metric(summary, "dropped_iterations", "count"),
    })

generated_honeypot_attempts = int(sum(item["honeypotRequests"] for item in phase_metrics))
generated_honeypot = int(sum(item["honeypotCaptured"] for item in phase_metrics))
generated_firewall = int(sum(item["firewallBlocked"] for item in phase_metrics))
generated_rate = int(sum(item["rateLimited"] for item in phase_metrics))
traffic_counts = {
    "normal": int(sum(item["normalRequests"] for item in phase_metrics)),
    "honeypot": int(sum(item["honeypotRequests"] for item in phase_metrics)),
    "firewall": int(sum(item["firewallRequests"] for item in phase_metrics)),
    "rateLimit": int(sum(item["rateRequests"] for item in phase_metrics)),
    "platform": int(sum(item["platformRequests"] for item in phase_metrics)),
}
traffic_total = sum(traffic_counts.values())
traffic_mix = {name: count / traffic_total if traffic_total else 0.0 for name, count in traffic_counts.items()}
observed_mix_text = ", ".join(f"{name} {traffic_mix[name]:.2%} ({traffic_counts[name]})" for name in traffic_counts)

valid_telemetry = [item for item in telemetry if item.get("phase", {}).get("phase") not in (None, "unknown", "complete", "cleanup")]
readiness_samples = [item for item in valid_telemetry if not item.get("phase", {}).get("scheduledFault")]
readiness_ok = sum(1 for item in readiness_samples if item.get("readiness", {}).get("apiStatus") == 200)
readiness_ratio = readiness_ok / len(readiness_samples) if readiness_samples else 0.0
queue_samples = []
for item in telemetry:
    wordpress = item.get("deep", {}).get("wordpress", {})
    if all(finite_number(wordpress.get(field), 0) for field in ("queueDepth", "queueBytes", "droppedEvents")):
        queue_samples.append(item)
queue_coverage = len(queue_samples) / len(telemetry) if telemetry else 0.0
queue_telemetry_valid = bool(telemetry) and queue_coverage >= 0.90
max_queue = max((int(item["deep"]["wordpress"]["queueDepth"]) for item in queue_samples), default=0)
max_queue_bytes = max((int(item["deep"]["wordpress"]["queueBytes"]) for item in queue_samples), default=0)
max_drops = max((int(item["deep"]["wordpress"]["droppedEvents"]) for item in queue_samples), default=0)

EXPECTED_RESOURCE_SERVICES = {
    "postgres", "redis", "api", "worker", "wordpress-db", "wordpress",
    "wordpress-cron", "web", "nginx", "prometheus", "alertmanager", "grafana",
}
resource_samples = []
for item in telemetry:
    resources = item.get("resources", {})
    containers = item.get("containers")
    by_service = {
        container.get("service"): container
        for container in containers
        if isinstance(container, dict) and isinstance(container.get("service"), str)
    } if isinstance(containers, list) else {}
    resources_valid = (
        finite_number(resources.get("dockerMemoryBytes"), 0)
        and finite_number(resources.get("dockerMemoryLimitBytes"), 1)
        and finite_number(resources.get("dockerMemoryPercent"), 0)
        and finite_number(resources.get("hostAvailableBytes"), 1)
    )
    containers_valid = EXPECTED_RESOURCE_SERVICES.issubset(by_service) and all(
        isinstance(by_service[service].get("state"), str)
        and (
            finite_number(by_service[service].get("memoryBytes"), 0)
            or by_service[service].get("state") != "running"
        )
        and isinstance(by_service[service].get("oomKilled"), bool)
        and isinstance(by_service[service].get("unexpectedRestart"), bool)
        for service in EXPECTED_RESOURCE_SERVICES
    )
    if resources_valid and containers_valid:
        resource_samples.append(item)
resource_coverage = len(resource_samples) / len(telemetry) if telemetry else 0.0
resource_telemetry_valid = bool(telemetry) and resource_coverage >= 0.90
oom_or_restart = any(
    container.get("oomKilled") or container.get("unexpectedRestart")
    for item in resource_samples
    for container in item.get("containers", [])
    if container.get("service") in EXPECTED_RESOURCE_SERVICES
)
max_docker_memory = max((float(item["resources"]["dockerMemoryPercent"]) for item in resource_samples), default=0.0)
host_memory_low = any(float(item["resources"]["hostAvailableBytes"]) < 1024 ** 3 for item in resource_samples)
memory_high_max_seconds = 0.0
memory_high_started: datetime | None = None
memory_high_previous: datetime | None = None
for item in resource_samples:
    try:
        at = datetime.fromisoformat(item["at"].replace("Z", "+00:00"))
    except Exception:
        memory_high_started = None
        memory_high_previous = None
        continue
    high = float(item["resources"]["dockerMemoryPercent"]) >= 90.0
    continuous = memory_high_previous is not None and (at - memory_high_previous).total_seconds() <= 10
    if high:
        if memory_high_started is None or not continuous:
            memory_high_started = at
        memory_high_max_seconds = max(memory_high_max_seconds, (at - memory_high_started).total_seconds())
        memory_high_previous = at
    else:
        memory_high_started = None
        memory_high_previous = None

EXPECTED_CUSTOM_METRICS = {
    "honeypot_agent_ingestion_errors_total",
    "honeypot_agent_auth_failures_total",
    "honeypot_authorization_denials_total",
    "honeypot_site_policy_sync_age_seconds",
    "honeypot_sites_connection",
    "honeypot_ai_requests_total",
    "honeypot_queue_oldest_job_age_seconds",
    "honeypot_dead_letter_jobs",
}
prometheus_samples = []
prometheus_metric_coverage = {name: 0 for name in EXPECTED_CUSTOM_METRICS}
for item in telemetry:
    prometheus = item.get("deep", {}).get("prometheus", {})
    results = prometheus.get("data", {}).get("result", []) if prometheus.get("status") == "success" else []
    metric_names = {
        result.get("metric", {}).get("__name__")
        for result in results
        if isinstance(result, dict)
    }
    for name in EXPECTED_CUSTOM_METRICS & metric_names:
        prometheus_metric_coverage[name] += 1
    if EXPECTED_CUSTOM_METRICS.issubset(metric_names):
        prometheus_samples.append(item)
prometheus_ratio = len(prometheus_samples) / len(telemetry) if telemetry else 0.0
prometheus_missing_metrics = sorted(name for name, count in prometheus_metric_coverage.items() if count == 0)
telemetry_validation = run_integrity.get("telemetryValidation", {}) or {}
unhealthy_observations = [entry for item in telemetry for entry in item.get("healthSafety", {}).get("unhealthy", [])]
max_unhealthy_ms = max((float(item.get("durationMs") or 0) for item in unhealthy_observations), default=0.0)

cpu_series = [sum(float(container.get("cpuPercent") or 0) for container in item.get("containers", [])) for item in telemetry]
memory_series = [float(item.get("resources", {}).get("dockerMemoryPercent") or 0) for item in telemetry]
queue_series = [float(item.get("deep", {}).get("wordpress", {}).get("queueDepth") or 0) for item in telemetry]
event_series = [float(item.get("deep", {}).get("database", {}).get("events") or 0) for item in telemetry]
event_throughput_series = [0.0]
for index in range(1, len(telemetry)):
    try:
        elapsed = (datetime.fromisoformat(telemetry[index]["at"].replace("Z", "+00:00")) - datetime.fromisoformat(telemetry[index - 1]["at"].replace("Z", "+00:00"))).total_seconds()
        event_throughput_series.append(max(0.0, event_series[index] - event_series[index - 1]) / max(elapsed, 0.001))
    except Exception:
        event_throughput_series.append(0.0)

policy_state_samples = []
for item in telemetry:
    database = item.get("deep", {}).get("database", {})
    connection = database.get("connection", {})
    policy = database.get("policy", {})
    if all(finite_number(connection.get(field), 0) for field in ("online", "degraded", "offline", "pending")) and all(
        finite_number(policy.get(field), 0) for field in ("observe", "enforce", "activeRules", "unexpiredPolicies", "synchronizedPolicies")
    ):
        policy_state_samples.append(item)
policy_state_coverage = len(policy_state_samples) / len(telemetry) if telemetry else 0.0
policy_state_telemetry_valid = bool(telemetry) and policy_state_coverage >= 0.90

soak_memory = [item.get("resources", {}).get("dockerMemoryBytes") for item in telemetry if item.get("phase", {}).get("phase") == "soak-chaos" and item.get("resources", {}).get("dockerMemoryBytes")]
if len(soak_memory) >= 10:
    window = max(3, len(soak_memory) // 10)
    memory_growth = statistics.mean(soak_memory[-window:]) / statistics.mean(soak_memory[:window]) - 1
else:
    memory_growth = 0.0

soak_correctness_points = []
soak_raw_path = ARTIFACT / "k6" / "soak-chaos.jsonl"
if soak_raw_path.exists():
    with soak_raw_path.open(errors="replace") as handle:
        for line in handle:
            try:
                item = json.loads(line)
                if item.get("type") == "Point" and item.get("metric") == "normal_response_correct":
                    soak_correctness_points.append((datetime.fromisoformat(item["data"]["time"].replace("Z", "+00:00")), float(item["data"]["value"]) == 1.0))
            except Exception:
                continue


def telemetry_between(start: datetime, end: datetime) -> list[dict[str, Any]]:
    values = []
    for item in telemetry:
        try:
            at = datetime.fromisoformat(item["at"].replace("Z", "+00:00"))
            if start <= at <= end:
                values.append(item)
        except Exception:
            continue
    return values


def normal_correctness_between(start: datetime, end: datetime) -> list[bool]:
    return [correct for at, correct in soak_correctness_points if start <= at <= end]


def container_state(sample: dict[str, Any], service: str) -> dict[str, Any]:
    return next((item for item in sample.get("containers", []) if item.get("service") == service), {})


api_recovered_event = next((item for item in faults if item.get("service") == "api" and item.get("action") == "recovered"), None)
api_outage_event = next((item for item in faults if item.get("service") == "api" and item.get("action") == "outage_started"), None)
natural_drain = {"queueGrew": False, "drained": False, "drainSeconds": None, "dropsUnchanged": False}
if api_recovered_event and api_outage_event:
    api_down = datetime.fromisoformat(api_outage_event["at"].replace("Z", "+00:00"))
    api_up = datetime.fromisoformat(api_recovered_event["at"].replace("Z", "+00:00"))
    during = telemetry_between(api_down, api_up)
    post = telemetry_between(api_up, api_up + timedelta(seconds=300))
    depths_during = [item.get("deep", {}).get("wordpress", {}).get("queueDepth") for item in during]
    depths_during = [int(value) for value in depths_during if isinstance(value, (int, float)) and math.isfinite(value)]
    natural_drain["queueGrew"] = bool(depths_during) and max(depths_during) > 0
    drops = [item.get("deep", {}).get("wordpress", {}).get("droppedEvents") for item in during + post]
    drops = [int(value) for value in drops if isinstance(value, (int, float)) and math.isfinite(value)]
    natural_drain["dropsUnchanged"] = bool(drops) and max(drops) == min(drops)
    for item in post:
        depth = item.get("deep", {}).get("wordpress", {}).get("queueDepth")
        if depth == 0:
            drained_at = datetime.fromisoformat(item["at"].replace("Z", "+00:00"))
            natural_drain["drained"] = True
            natural_drain["drainSeconds"] = max(0.0, (drained_at - api_up).total_seconds())
            break


fault_results = []
integrity_faults = {item.get("service"): item for item in run_integrity.get("faultValidation", [])}
for service in ("worker", "api", "redis", "wordpress-db"):
    stops = [item for item in faults if item.get("service") == service and item.get("action") == "outage_started"] or [item for item in faults if item.get("service") == service and item.get("action") == "stop"]
    starts = [item for item in faults if item.get("service") == service and item.get("action") == "start"]
    recoveries = [item for item in faults if item.get("service") == service and item.get("action") == "recovered"]
    recovery_seconds = None
    outage_seconds = None
    if starts and recoveries:
        start = datetime.fromisoformat(starts[-1]["at"].replace("Z", "+00:00"))
        recovered = datetime.fromisoformat(recoveries[-1]["at"].replace("Z", "+00:00"))
        recovery_seconds = max(0.0, (recovered - start).total_seconds())
    if stops and starts:
        stopped = datetime.fromisoformat(stops[-1]["at"].replace("Z", "+00:00"))
        started = datetime.fromisoformat(starts[-1]["at"].replace("Z", "+00:00"))
        outage_seconds = max(0.0, (started - stopped).total_seconds())
    expected_outage = float(stops[-1].get("expectedOutageSeconds", 120)) if stops else 120.0
    integrity_fault = integrity_faults.get(service, {})
    duration_valid = integrity_fault.get("timingValid") is True
    outage_probe = read_json(ARTIFACT / f"fault-probe-{service}-outage.json", {}) or {}
    recovered_probe = read_json(ARTIFACT / f"fault-probe-{service}-recovered.json", {}) or {}
    behavior_ok = False
    behavior = "Required service behavior was not observable."
    if stops and recoveries:
        down_at = datetime.fromisoformat(stops[-1]["at"].replace("Z", "+00:00"))
        up_at = datetime.fromisoformat(recoveries[-1]["at"].replace("Z", "+00:00"))
        during = telemetry_between(down_at, up_at)
        after = telemetry_between(up_at, up_at + timedelta(seconds=180))
        correct_during = normal_correctness_between(down_at, up_at)
        if service == "worker":
            event_values = [item.get("deep", {}).get("database", {}).get("events") for item in during]
            pending_values = [item.get("deep", {}).get("database", {}).get("pending") for item in during]
            after_pending = [item.get("deep", {}).get("database", {}).get("pending") for item in after]
            event_values = [value for value in event_values if isinstance(value, (int, float)) and math.isfinite(value)]
            pending_values = [value for value in pending_values if isinstance(value, (int, float)) and math.isfinite(value)]
            after_pending = [value for value in after_pending if isinstance(value, (int, float)) and math.isfinite(value)]
            behavior_ok = len(event_values) >= 2 and max(event_values) > min(event_values) and pending_values and max(pending_values) > min(pending_values) and after_pending and after_pending[-1] <= min(pending_values)
            behavior = f"events during outage={min(event_values) if event_values else 'missing'}->{max(event_values) if event_values else 'missing'}; pending peak={max(pending_values) if pending_values else 'missing'}; pending after recovery={after_pending[-1] if after_pending else 'missing'}"
        elif service == "api":
            wordpress_healthy = bool(during) and all(container_state(item, "wordpress").get("state") == "running" for item in during)
            http_ok = outage_probe.get("status") == 200 and recovered_probe.get("status") == 200
            behavior_ok = wordpress_healthy and http_ok and natural_drain["queueGrew"] and natural_drain["drained"] and natural_drain["dropsUnchanged"]
            behavior = f"WordPress running={wordpress_healthy}; normal HTTP correct={sum(correct_during)}/{len(correct_during)}; passive queue recovery={natural_drain}"
        elif service == "redis":
            wordpress_healthy = bool(during) and all(container_state(item, "wordpress").get("state") == "running" for item in during)
            http_ok = outage_probe.get("status") == 200 and recovered_probe.get("status") == 200
            fail_closed = redis_replay_probe.get("status") == 503 and redis_replay_probe.get("code") == "REPLAY_PROTECTION_UNAVAILABLE"
            recovered_probe = redis_replay_recovered.get("status") == 200 and redis_replay_recovered.get("ok") is True
            behavior_ok = wordpress_healthy and http_ok and fail_closed and recovered_probe
            behavior = f"WordPress running={wordpress_healthy}; normal HTTP correct={sum(correct_during)}/{len(correct_during)}; replay 503={fail_closed}; signed recovery 200={recovered_probe}"
        else:
            api_ready = bool(during) and all(item.get("readiness", {}).get("apiStatus") == 200 for item in during)
            database_stopped = any(container_state(item, "wordpress-db").get("state") != "running" for item in during)
            wordpress_failed = outage_probe.get("status") is not None and outage_probe.get("status") != 200
            recovered_http = recovered_probe.get("status") == 200
            behavior_ok = api_ready and database_stopped and wordpress_failed and recovered_http
            behavior = f"API ready={api_ready}; WordPress DB stopped={database_stopped}; controlled WP status={outage_probe.get('status', 'missing')}; post-recovery WP status={recovered_probe.get('status', 'missing')}"
    if duration_valid and recovery_seconds is not None and recovery_seconds <= 60 and behavior_ok:
        status = "PASS"
    elif not run_complete or not stops or not starts or not recoveries:
        status = "BLOCKED"
    else:
        status = "FAIL"
    fault_results.append({"service": service, "expectedOutageSeconds": expected_outage, "outageSeconds": outage_seconds, "recoverySeconds": recovery_seconds, "durationValid": duration_valid, "behaviorOk": behavior_ok, "behavior": behavior, "status": status})

redaction_count = None
try:
    redaction_count = int((ARTIFACT / "redaction-database-count.txt").read_text().strip())
except Exception:
    pass

final_spool = {"queueDepth": None, "queueBytes": None, "droppedEvents": None}
try:
    queue, size, drops = (ARTIFACT / "wordpress-final-spool.txt").read_text().strip().split("|")
    final_spool = {"queueDepth": int(queue), "queueBytes": int(size), "droppedEvents": int(drops)}
except Exception:
    pass
final_spool_valid = all(finite_number(final_spool.get(field), 0) for field in ("queueDepth", "queueBytes", "droppedEvents"))
if final_spool_valid:
    max_drops = max(max_drops, int(final_spool["droppedEvents"]))

agent_runtime = read_json(ARTIFACT / "agent-runtime-final.json", None)
for item in reversed(telemetry):
    if agent_runtime:
        break
    candidate = item.get("deep", {}).get("agentRuntime")
    if candidate:
        agent_runtime = candidate
        break
agent_cycles = read_jsonl(ARTIFACT / "agent-cycles.jsonl")
fault_windows = []
for service in ("worker", "api", "redis", "wordpress-db"):
    stopped = next((item for item in faults if item.get("service") == service and item.get("action") == "stop"), None)
    recovered = next((item for item in reversed(faults) if item.get("service") == service and item.get("action") == "recovered"), None)
    if stopped and recovered:
        fault_windows.append((datetime.fromisoformat(stopped["at"].replace("Z", "+00:00")), datetime.fromisoformat(recovered["at"].replace("Z", "+00:00"))))
def outside_fault(value: dict[str, Any]) -> bool:
    try:
        at = datetime.fromisoformat(value["at"].replace("Z", "+00:00"))
        return not any(start <= at <= end for start, end in fault_windows)
    except Exception:
        return False
nonfault_agent_cycles = [item for item in agent_cycles if outside_fault(item)]
nonfault_telemetry = [item for item in telemetry if outside_fault(item)]
# Scheduled API/worker outages intentionally make one exporter unavailable.
# Metric coverage is therefore measured only where every required service is
# expected to be up; fault behavior has its own mandatory evidence rows.
prometheus_samples = [item for item in prometheus_samples if outside_fault(item)]
prometheus_metric_coverage = {name: 0 for name in EXPECTED_CUSTOM_METRICS}
for item in nonfault_telemetry:
    prometheus = item.get("deep", {}).get("prometheus", {})
    results = prometheus.get("data", {}).get("result", []) if prometheus.get("status") == "success" else []
    metric_names = {result.get("metric", {}).get("__name__") for result in results if isinstance(result, dict)}
    for name in EXPECTED_CUSTOM_METRICS & metric_names:
        prometheus_metric_coverage[name] += 1
prometheus_denominator = len(nonfault_telemetry)
prometheus_ratio = len(prometheus_samples) / prometheus_denominator if prometheus_denominator else 0.0
prometheus_missing_metrics = sorted(name for name, count in prometheus_metric_coverage.items() if count == 0)


def seconds_outside_faults(start: datetime, end: datetime) -> float:
    if end <= start:
        return 0.0
    excluded = 0.0
    for fault_start, fault_end in fault_windows:
        overlap_start = max(start, fault_start)
        overlap_end = min(end, fault_end)
        if overlap_end > overlap_start:
            excluded += (overlap_end - overlap_start).total_seconds()
    return max(0.0, (end - start).total_seconds() - excluded)


agent_cadence = {
    "valid": False,
    "runtimeStateValid": False,
    "cycleLogValid": False,
    "expectedMinimumCycles": 0,
    "observedNonFaultCycles": len(nonfault_agent_cycles),
    "successfulNonFaultCycles": sum(1 for item in nonfault_agent_cycles if item.get("status") == "PASS"),
    "effectiveDenominator": 0,
    "successRatio": 0.0,
    "maxActiveGapSeconds": None,
    "gapFailures": [],
}
if isinstance(agent_runtime, dict):
    try:
        runtime_start = datetime.fromisoformat(str(agent_runtime["startedAt"]).replace("Z", "+00:00"))
        runtime_stop = datetime.fromisoformat(str(agent_runtime["stoppedAt"]).replace("Z", "+00:00"))
        agent_count = int(agent_runtime.get("agentCount", 0))
        log_passes = sum(1 for item in agent_cycles if item.get("status") == "PASS")
        log_failures = sum(1 for item in agent_cycles if item.get("status") == "FAIL")
        log_indices = {int(item.get("agentIndex")) for item in agent_cycles if isinstance(item.get("agentIndex"), int)}
        log_rows_valid = all(
            item.get("status") in {"PASS", "FAIL"}
            and isinstance(item.get("agentIndex"), int)
            and 1 <= item["agentIndex"] <= agent_count
            and math.isfinite(datetime.fromisoformat(str(item["at"]).replace("Z", "+00:00")).timestamp())
            for item in agent_cycles
        )
        counter_valid = (
            int(agent_runtime.get("cyclesAttempted", -1)) == len(agent_cycles)
            and int(agent_runtime.get("cyclesSucceeded", -1)) == log_passes
            and int(agent_runtime.get("cyclesFailed", -1)) == log_failures
            and int(agent_runtime.get("cyclesSucceeded", -1)) + int(agent_runtime.get("cyclesFailed", -1)) == len(agent_cycles)
        )
        runtime_state_valid = (
            agent_count == 49
            and runtime_stop > runtime_start
            and agent_runtime.get("shutdownTimedOut") is False
            and counter_valid
        )
        cycle_log_valid = bool(agent_cycles) and log_rows_valid and log_indices == set(range(1, 50))

        # Each agent is initially spread over one minute, then scheduled every
        # 300s with +/-30s jitter. A 30s completion allowance makes 360s the
        # maximum evidence-backed active gap. Scheduled fault time is excluded.
        max_active_gap = 0.0
        gap_failures = []
        expected_minimum = 0
        for agent_index in range(1, 50):
            initial_due = runtime_start + timedelta(seconds=math.floor(((agent_index - 1) / 49) * 60))
            available = seconds_outside_faults(initial_due, runtime_stop)
            if available >= 30:
                expected_minimum += 1 + max(0, math.floor((available - 30) / 360))
            observed = sorted(
                datetime.fromisoformat(str(item["at"]).replace("Z", "+00:00"))
                for item in agent_cycles
                if item.get("agentIndex") == agent_index
            )
            points = [initial_due, *observed, runtime_stop]
            for left, right in zip(points, points[1:]):
                active_gap = seconds_outside_faults(left, right)
                max_active_gap = max(max_active_gap, active_gap)
                # The initial completion and final partial interval receive the
                # same upper bound as a regular jittered scheduling interval.
                if active_gap > 360:
                    gap_failures.append({"agentIndex": agent_index, "from": left.isoformat(), "to": right.isoformat(), "activeGapSeconds": active_gap})

        successful = agent_cadence["successfulNonFaultCycles"]
        denominator = max(len(nonfault_agent_cycles), expected_minimum)
        success_ratio = successful / denominator if denominator else 0.0
        agent_cadence.update({
            "runtimeStateValid": runtime_state_valid,
            "cycleLogValid": cycle_log_valid,
            "expectedMinimumCycles": expected_minimum,
            "effectiveDenominator": denominator,
            "successRatio": success_ratio,
            "maxActiveGapSeconds": max_active_gap,
            "gapFailures": gap_failures[:20],
            "valid": runtime_state_valid and cycle_log_valid and not gap_failures and successful >= expected_minimum and success_ratio >= 0.98,
        })
    except Exception as error:
        agent_cadence["error"] = str(error)[:240]
agent_success = float(agent_cadence["successRatio"])

EXPECTED_BREAKPOINT_RATES = [75, 100, 125, 150, 175, 200]
breakpoint_phase_rows = [item for item in phase_metrics if re.fullmatch(r"breakpoint-(75|100|125|150|175|200)", item["phase"])]
breakpoint_unknown_phases = sorted({
    item["phase"]
    for item in phase_metrics
    if item["phase"].startswith("breakpoint-") and not re.fullmatch(r"breakpoint-(75|100|125|150|175|200)", item["phase"])
})
breakpoint_phase_counts = {
    phase: sum(1 for item in breakpoint_phase_rows if item["phase"] == phase)
    for phase in {item["phase"] for item in breakpoint_phase_rows}
}
breakpoint_observed_rates = [int(item["phase"].split("-")[1]) for item in breakpoint_phase_rows]
breakpoint_rates = sorted(int(item["phase"].split("-")[1]) for item in breakpoint_phase_rows)
breakpoint_contiguous = (
    2 <= len(breakpoint_rates) <= len(EXPECTED_BREAKPOINT_RATES)
    and breakpoint_rates == EXPECTED_BREAKPOINT_RATES[:len(breakpoint_rates)]
    and breakpoint_observed_rates == EXPECTED_BREAKPOINT_RATES[:len(breakpoint_observed_rates)]
    and all(count == 1 for count in breakpoint_phase_counts.values())
    and not breakpoint_unknown_phases
)


def breakpoint_stage_passes(item: dict[str, Any]) -> bool:
    target = int(item["phase"].split("-")[1]) if item["phase"].startswith("breakpoint-") else int(item["rate"])
    return (
        item["rate"] == target
        and math.isfinite(item["achievedRps"])
        and item["achievedRps"] >= target * 0.98
        and item["normalErrorRate"] <= 0.01
        and item["normalP95Ms"] <= 750
        and item["droppedIterations"] == 0
    )


breakpoint_stage_results = []
for rate in breakpoint_rates:
    item = next(value for value in breakpoint_phase_rows if value["phase"] == f"breakpoint-{rate}")
    breakpoint_stage_results.append({
        "rate": rate,
        "achievedRps": item["achievedRps"],
        "droppedIterations": item["droppedIterations"],
        "passed": breakpoint_stage_passes(item),
        "securityCorrect": item["firewallCorrect"] == 1 and item["honeypotCorrect"] == 1 and item["rateCorrect"] == 1 and item["platformCorrect"] == 1,
        "firewallP95Ms": item["firewallP95Ms"],
    })
trailing_breakpoint_failures = 0
for item in reversed(breakpoint_stage_results):
    if item["passed"]:
        break
    trailing_breakpoint_failures += 1
reported_breakpoint_breaches = integer_or(breakpoint.get("stoppedAfterConsecutiveBreaches"), -1)
breakpoint_stop_valid = bool(breakpoint_stage_results) and reported_breakpoint_breaches == trailing_breakpoint_failures and (
    len(breakpoint_rates) == len(EXPECTED_BREAKPOINT_RATES) or trailing_breakpoint_failures >= 2
)
sustained_capacity_row = next((item for item in phase_metrics if item["phase"] == "sustained"), None)
base_capacity_passed = bool(sustained_capacity_row) and (
    sustained_capacity_row["rate"] == 50
    and math.isfinite(sustained_capacity_row["achievedRps"])
    and sustained_capacity_row["achievedRps"] >= 49
    and sustained_capacity_row["normalErrorRate"] <= 0.01
    and sustained_capacity_row["normalP95Ms"] <= 750
    and sustained_capacity_row["droppedIterations"] == 0
)
passing_breakpoint_rates = [item["rate"] for item in breakpoint_stage_results if item["passed"]]
recomputed_highest_passing = max(([50] if base_capacity_passed else []) + passing_breakpoint_rates, default=0)
reported_highest_passing = integer_or(breakpoint.get("highestPassingRps"), -1)
breakpoint_capacity_valid = (
    breakpoint_contiguous
    and breakpoint_stop_valid
    and reported_highest_passing == recomputed_highest_passing
    and recomputed_highest_passing > 0
)
breakpoint_validation = {
    "valid": breakpoint_capacity_valid,
    "contiguous": breakpoint_contiguous,
    "stopValid": breakpoint_stop_valid,
    "executedRates": breakpoint_rates,
    "observedRates": breakpoint_observed_rates,
    "unknownPhases": breakpoint_unknown_phases,
    "stageResults": breakpoint_stage_results,
    "trailingFailures": trailing_breakpoint_failures,
    "reportedConsecutiveBreaches": reported_breakpoint_breaches,
    "reportedHighestPassingRps": reported_highest_passing,
    "recomputedHighestPassingRps": recomputed_highest_passing,
    "base50Passed": base_capacity_passed,
}

soak_metric_values = {
    "normal_latency": [],
    "normal_response_correct": [],
    "firewall_latency": [],
    "firewall_response_correct": [],
    "honeypot_response_correct": [],
    "rate_limit_response_correct": [],
    "platform_response_correct": [],
    "dropped_iterations": [],
}
soak_raw_path = ARTIFACT / "k6" / "soak-chaos.jsonl"
if soak_raw_path.exists():
    with soak_raw_path.open(errors="replace") as handle:
        for line in handle:
            try:
                item = json.loads(line)
                metric_name = item.get("metric")
                if item.get("type") != "Point" or metric_name not in soak_metric_values:
                    continue
                at = datetime.fromisoformat(item["data"]["time"].replace("Z", "+00:00"))
                if not any(start <= at <= end for start, end in fault_windows):
                    soak_metric_values[metric_name].append(float(item["data"]["value"]))
            except Exception:
                continue
soak_normal_values = soak_metric_values["normal_latency"]
soak_p95 = percentile(soak_normal_values, 0.95)
soak_p99 = percentile(soak_normal_values, 0.99)
soak_normal_correct = soak_metric_values["normal_response_correct"]
soak_firewall_correct = soak_metric_values["firewall_response_correct"]
soak_honeypot_correct = soak_metric_values["honeypot_response_correct"]
soak_rate_correct = soak_metric_values["rate_limit_response_correct"]
soak_platform_correct = soak_metric_values["platform_response_correct"]
soak_firewall_p95 = percentile(soak_metric_values["firewall_latency"], 0.95)
soak_dropped = sum(soak_metric_values["dropped_iterations"])
nonfault_soak_ok = (
    bool(soak_normal_correct)
    and bool(soak_firewall_correct)
    and bool(soak_honeypot_correct)
    and bool(soak_rate_correct)
    and bool(soak_platform_correct)
    and (1 - sum(soak_normal_correct) / len(soak_normal_correct)) <= 0.01
    and soak_p95 <= 500
    and soak_p99 <= 1000
    and all(value == 1 for value in soak_firewall_correct)
    and soak_firewall_p95 <= 350
    and all(value == 1 for value in soak_honeypot_correct)
    and all(value == 1 for value in soak_rate_correct)
    and all(value == 1 for value in soak_platform_correct)
    and soak_dropped == 0
)
reference_phase = next((item for item in phase_metrics if item["phase"] == "sustained"), None)
reference_p95 = reference_phase["normalP95Ms"] if reference_phase else math.inf
latency_drift = max(0.0, soak_p95 / reference_p95 - 1) if math.isfinite(soak_p95) and math.isfinite(reference_p95) and reference_p95 > 0 else math.inf

required_capture_labels = {
    "baseline", "sustained", "peak", "fault-worker", "recovered-worker",
    "fault-api", "recovered-api", "fault-redis", "recovered-redis",
    "fault-wordpress-db", "recovered-wordpress-db", "recovery", "final",
}
browser_assertions = {label: read_json(ARTIFACT / "screenshots" / f"{label}-assertions.json", {}) or {} for label in required_capture_labels}
required_browser = {
    "baseline-dashboard.png", "sustained-dashboard.png", "peak-dashboard.png",
    "fault-worker-dashboard.png", "recovered-worker-dashboard.png",
    "fault-api-dashboard.png", "recovered-api-dashboard.png",
    "fault-redis-dashboard.png", "recovered-redis-dashboard.png",
    "fault-wordpress-db-dashboard.png", "recovered-wordpress-db-dashboard.png",
    "recovery-dashboard.png", "final-sites.png", "final-events.png", "final-firewall.png",
}
browser_images = list((ARTIFACT / "screenshots").glob("*.png"))
browser_names = {path.name for path in browser_images}
missing_browser = sorted(required_browser - browser_names)
invalid_browser_images = []
for name in sorted(required_browser & browser_names):
    path = ARTIFACT / "screenshots" / name
    try:
        with PILImage.open(path) as image:
            if image.width < 1000 or image.height < 700:
                invalid_browser_images.append(name)
    except Exception:
        invalid_browser_images.append(name)
trace_action_files = list((ARTIFACT / "traces").glob("**/*.trace"))
trace_network_files = list((ARTIFACT / "traces").glob("**/*.network"))
missing_capture_traces = sorted(label for label in required_capture_labels if not list((ARTIFACT / "traces" / label).glob("**/*.trace")))
browser_assertions_ok = all(browser_assertions[label].get("status") == "PASS" and browser_assertions[label].get("traceValidated") is True and browser_assertions[label].get("consoleCaptureValid") is True for label in required_capture_labels)
browser_smoke_trace_ok = browser_ui_smoke.get("status") == "PASS" and browser_ui_smoke.get("checks", {}).get("traceSanitized") is True and browser_ui_smoke.get("checks", {}).get("traceStructurallyValid") is True
browser_evidence_ok = not missing_browser and not invalid_browser_images and not missing_capture_traces and not trace_network_files and browser_assertions_ok and browser_smoke_trace_ok

rows: list[dict[str, Any]] = []


def add(name: str, status: str, evidence: str, mandatory: bool = True) -> None:
    rows.append({"name": name, "status": status, "evidence": evidence, "mandatory": mandatory})


add("Static quality gates", "PASS" if quality_inventory_valid else "FAIL", f"exact expected inventory={quality_inventory_valid}; missing={quality_missing or 'none'}; unexpected={quality_unexpected or 'none'}; duplicates={quality_duplicates or 'none'}; " + (", ".join(f"{item['name']}={item['status']}" for item in quality) or "No gate evidence"))
add("Report finalization preverification", "PASS" if finalization_status.get("status") == "PASS" and finalization_status.get("draftRedactionVerified") is True and finalization_status.get("draftManifestVerified") is True else "FAIL", f"Two-pass report safety state={finalization_status or 'missing'}; the final artifact is rescanned and remanifested after rendering")
reproducibility_ok = reproducibility.get("status") == "PASS" and reproducibility.get("docker", {}).get("cpus", 0) >= 8 and reproducibility.get("docker", {}).get("memoryBytes", 0) >= int(7.5 * 1024 ** 3) and bool(resolved_compose.get("services"))
add("Runtime allocation and reproducibility inventory", "PASS" if reproducibility_ok else "FAIL", f"allocation/tool/source inventory={reproducibility or 'missing'}; resolved services={len(resolved_compose.get('services', {}))}")
add("Pinned official image digests", "PASS" if image_inventory.get("status") == "PASS" and len(image_inventory.get("images", [])) == 4 else "FAIL", f"Resolved official image inventory={image_inventory.get('status', 'missing')}; images={len(image_inventory.get('images', []))}")
add("Loopback-only runtime exposure", "PASS" if exposure_scan.get("status") == "PASS" and exposure_scan.get("loopbackOnly") is True else "FAIL", f"Published bindings={exposure_scan.get('bindings', 'missing')}; expected only nginx 80/443 and WordPress 8080 on 127.0.0.1")
continuity_status = "PASS" if continuous_profile_completed else ("FAIL" if run_integrity.get("interruptionClassification") == "FAIL" else "BLOCKED")
add("Continuous 90-minute profile", continuity_status, f"Completed={continuous_profile_completed}; active soak={soak_observed_seconds}s/{soak_planned_seconds}s; reason={run_integrity.get('reason', 'missing run-complete evidence')}")
add("Two-second telemetry integrity", "PASS" if telemetry_validation.get("valid") is True else "FAIL", f"samples={telemetry_validation.get('samples')}/{telemetry_validation.get('expectedSamples')}; density={telemetry_validation.get('density')}; p95 gap={telemetry_validation.get('p95GapSeconds')}s; max gap={telemetry_validation.get('maxGapSeconds')}s")
add("Prometheus custom metrics collection", "PASS" if nonfault_telemetry and prometheus_ratio >= 0.90 and not prometheus_missing_metrics else "FAIL", f"Non-fault samples containing every required custom series={len(prometheus_samples)}/{prometheus_denominator} ({prometheus_ratio:.2%}); required={sorted(EXPECTED_CUSTOM_METRICS)}; never observed={prometheus_missing_metrics or 'none'}; per-series samples={dict(sorted(prometheus_metric_coverage.items()))}")
add("Real bot, honeypot, and firewall suite", "PASS" if bot.get("verdict") == "PASS" else "FAIL", f"Bot functional verdict={bot.get('verdict', 'missing')}; counts={bot.get('capturedEventCounts', {})}")
agent_security_ok = bool(agent_security.get("ok")) and all(agent_security.get("checks", {}).values())
add("Signed-agent security suite", "PASS" if agent_security_ok else "FAIL", f"Malformed/stale signatures, replay, scope, ETag, idempotency, revocation, and persisted redaction checks={agent_security.get('checks', 'missing')}")
replay_fail_closed = redis_replay_probe.get("status") == 503 and redis_replay_probe.get("code") == "REPLAY_PROTECTION_UNAVAILABLE"
add("Redis replay protection fail-closed", "PASS" if replay_fail_closed else "FAIL", f"Signed heartbeat during Redis outage={redis_replay_probe or 'missing'}")

core_phases = [item for item in phase_metrics if item["phase"] in {"baseline", "ramp-10", "ramp-25", "ramp-50", "sustained"}]
core_ok = {item["phase"] for item in core_phases} == {"baseline", "ramp-10", "ramp-25", "ramp-50", "sustained"} and all(item["normalErrorRate"] <= 0.01 and item["normalP95Ms"] <= 500 and item["normalP99Ms"] <= 1000 and item["droppedIterations"] == 0 for item in core_phases)
add("Normal traffic SLO", "PASS" if core_ok else "FAIL", "Baseline/ramp/sustained require <=1% errors, p95 <=500ms, p99 <=1000ms")
spike = next((item for item in phase_metrics if item["phase"] == "spike"), None)
spike_ok = bool(spike) and spike["normalErrorRate"] <= 0.02 and spike["normalP95Ms"] <= 1000 and spike["droppedIterations"] == 0
add("Spike SLO", "PASS" if spike_ok else "FAIL", f"error={spike['normalErrorRate']:.2%}, p95={spike['normalP95Ms']:.1f}ms, p99={spike['normalP99Ms']:.1f}ms, dropped iterations={spike['droppedIterations']:.0f}" if spike else "Missing spike evidence")

highest_passing = recomputed_highest_passing
add("Breakpoint capacity evidence", "PASS" if breakpoint_capacity_valid else "FAIL", f"contiguous ordered stages={breakpoint_contiguous}; stop semantics={breakpoint_stop_valid}; observed={breakpoint_observed_rates}; unknown={breakpoint_unknown_phases or 'none'}; reported/recomputed headline={reported_highest_passing}/{recomputed_highest_passing} RPS; stages={breakpoint_stage_results}")
def within_validated_capacity(item: dict[str, Any]) -> bool:
    if item["phase"] == "soak-chaos":
        return False
    if item["phase"].startswith("breakpoint-"):
        return int(item["phase"].split("-")[1]) <= highest_passing
    return True

firewall_phases = [item for item in phase_metrics if within_validated_capacity(item) and item["firewallRequests"] > 0]
firewall_ok = bool(firewall_phases) and all(item["firewallCorrect"] == 1 and item["firewallP95Ms"] <= 350 for item in firewall_phases)
worst_firewall_p95 = max((item["firewallP95Ms"] for item in firewall_phases), default=math.inf)
worst_firewall_correct = min((item["firewallCorrect"] for item in firewall_phases), default=0)
add("Firewall under load", "PASS" if firewall_ok else "FAIL", f"All core/spike phases and breakpoint stages through the validated {highest_passing} RPS capacity; 403 responses={generated_firewall}; worst p95={worst_firewall_p95:.1f}ms; lowest correctness={worst_firewall_correct:.2%}; required p95 <=350ms and 100% correct")
rate_phases = [item for item in phase_metrics if within_validated_capacity(item) and item["rateRequests"] > 0]
rate_ok = generated_rate > 0 and bool(rate_phases) and all(item["rateCorrect"] == 1 for item in rate_phases)
worst_rate_correct = min((item["rateCorrect"] for item in rate_phases), default=0)
add("Rate limiting under load", "PASS" if rate_ok else "FAIL", f"All core/spike phases and breakpoint stages through validated capacity; real 429 responses={generated_rate}; lowest correctness={worst_rate_correct:.2%}")
honeypot_phases = [item for item in phase_metrics if within_validated_capacity(item) and item["honeypotRequests"] > 0]
honeypot_load_ok = bool(honeypot_phases) and all(item["honeypotCorrect"] == 1 for item in honeypot_phases)
add("Honeypot detection under load", "PASS" if honeypot_load_ok else "FAIL", f"Successful inert captures={generated_honeypot}/{generated_honeypot_attempts} attempts including scheduled chaos; every core/spike phase and breakpoint stage through validated capacity requires 100% expected 401/404 responses")
rate_atomic_ok = bool(rate_atomic.get("ok")) and rate_atomic.get("counts") == {"200": 10, "429": 10}
add("Atomic 10/10 rate-limit burst", "PASS" if rate_atomic_ok else "FAIL", f"Twenty concurrent fresh-IP requests expected exactly 10x200 and 10x429; observed={rate_atomic.get('counts', 'missing')}")
add("Platform readiness", "PASS" if readiness_ratio >= 0.999 else "FAIL", f"{readiness_ok}/{len(readiness_samples)} non-fault samples ready ({readiness_ratio:.3%})")
add("Connection and policy telemetry", "PASS" if policy_state_telemetry_valid else "FAIL", f"valid two-second connection/mode/rule/policy/acknowledgement samples={len(policy_state_samples)}/{len(telemetry)} ({policy_state_coverage:.2%})")
add("Non-fault soak traffic SLO", "PASS" if continuous_profile_completed and nonfault_soak_ok else ("BLOCKED" if not continuous_profile_completed else "FAIL"), f"normal correct={sum(soak_normal_correct):.0f}/{len(soak_normal_correct)}, p95={soak_p95:.1f}ms, p99={soak_p99:.1f}ms; firewall correct={sum(soak_firewall_correct):.0f}/{len(soak_firewall_correct)}, p95={soak_firewall_p95:.1f}ms; honeypot={sum(soak_honeypot_correct):.0f}/{len(soak_honeypot_correct)}; rate-limit={sum(soak_rate_correct):.0f}/{len(soak_rate_correct)}; platform={sum(soak_platform_correct):.0f}/{len(soak_platform_correct)}; dropped={soak_dropped:.0f}")

event_match = (
    reconciliation.get("honeypot") == generated_honeypot
    and reconciliation.get("firewall") == generated_firewall
    and reconciliation.get("rateLimit") == generated_rate
    and reconciliation.get("rateAtomic") == 10
    and reconciliation.get("markedEvents") == generated_honeypot + generated_firewall + generated_rate + 10
    and reconciliation.get("distinctMarkedEvents") == generated_honeypot + generated_firewall + generated_rate + 10
    and reconciliation.get("syntheticAgent") == int((agent_runtime or {}).get("eventsSubmitted", -1))
    and reconciliation.get("duplicateKeys") == 0
)
event_status = "PASS" if event_match and max_drops == 0 else ("FAIL" if max_drops > 0 or continuous_profile_completed or reconciliation else "BLOCKED")
add("Event integrity and exact-once delivery", event_status, f"generated H/F/R/S={generated_honeypot}/{generated_firewall}/{generated_rate}/{(agent_runtime or {}).get('eventsSubmitted', 'missing')}; expected unique request markers={generated_honeypot + generated_firewall + generated_rate + 10}; stored={reconciliation or 'final reconciliation unavailable'}; max drops={max_drops}")
redaction_smoke_ok = bool(agent_security.get("checks", {}).get("centralRedaction"))
redaction_ok = redaction_count == 0 and redaction_smoke_ok and redaction_pre.get("status") == "PASS"
add("Credential evidence redaction", "PASS" if redaction_ok else ("BLOCKED" if redaction_count is None else "FAIL"), f"Signed-agent persisted-redaction check={redaction_smoke_ok}; final database canary matches={redaction_count if redaction_count is not None else 'unavailable after interruption'}; recursive pre-report scan={redaction_pre.get('status', 'missing')} across {redaction_pre.get('scannedFiles', 0)} files")
spool_ok = queue_telemetry_valid and final_spool_valid and max_queue <= 10_000 and max_queue_bytes <= 67_108_864 and max_drops == 0 and final_spool["queueDepth"] == 0 and final_spool["queueBytes"] == 0
add("WordPress bounded spool", "PASS" if spool_ok else "FAIL", f"valid telemetry={len(queue_samples)}/{len(telemetry)} ({queue_coverage:.2%}); final readback valid={final_spool_valid}; peak rows={max_queue}; peak bytes={max_queue_bytes}; drops={max_drops}; final={final_spool}; root cause={run_integrity.get('queueDropRootCause', 'not recorded')}")

connections = final_fleet_reconciliation.get("connectionCounts", final_cleanup.get("connectionCounts", {}))
fleet_ok = final_fleet_reconciliation.get("siteCount", final_cleanup.get("siteCount")) == 50 and connections.get("ONLINE") == 50 and agent_cadence["valid"] is True and final_agent_reconciliation.get("succeeded") == 49 and final_agent_reconciliation.get("allFresh") is True and final_fleet_reconciliation.get("freshnessFailures") == []
fleet_status = "PASS" if fleet_ok else ("BLOCKED" if not final_cleanup else "FAIL")
add("Fifty-site agent fleet", fleet_status, f"final sites={final_fleet_reconciliation.get('siteCount', final_cleanup.get('siteCount'))}; connections={connections}; fresh synthetic reconciliation={final_agent_reconciliation.get('succeeded', 'missing')}/49; allFresh={final_agent_reconciliation.get('allFresh')}; site freshness failures={final_fleet_reconciliation.get('freshnessFailures', 'missing')}; cadence valid={agent_cadence['valid']}; non-fault successes/denominator={agent_cadence['successfulNonFaultCycles']}/{agent_cadence['effectiveDenominator']} ({agent_success:.2%}); expected minimum={agent_cadence['expectedMinimumCycles']}; max active gap={agent_cadence['maxActiveGapSeconds']}s")
for result in fault_results:
    add(f"{result['service']} fault recovery", result["status"], f"Observed outage={result['outageSeconds']}s (expected {result['expectedOutageSeconds']}s); recovery after start={result['recoverySeconds']}s; duration valid={result['durationValid']}; behavior valid={result['behaviorOk']}; {result['behavior']}")

natural_wp = natural_recovery.get("wordpress") or {}
natural_drain_ok = natural_drain["queueGrew"] and natural_drain["drained"] and natural_drain["dropsUnchanged"] and natural_drain["drainSeconds"] is not None and natural_drain["drainSeconds"] <= 300
add("Five-minute natural queue drain", "PASS" if natural_drain_ok else ("BLOCKED" if not api_recovered_event else "FAIL"), f"Passive two-second telemetry from API recovery={natural_drain}; later read-only recovery snapshot queue={natural_wp.get('queueDepth')}")
resource_safe = resource_telemetry_valid and not abort and not oom_or_restart and not host_memory_low and memory_high_max_seconds < 30 and max_unhealthy_ms < 30_000
add("Resource safety", "PASS" if resource_safe else "FAIL", f"valid telemetry={len(resource_samples)}/{len(telemetry)} ({resource_coverage:.2%}); abort={abort}; OOM/restart={oom_or_restart}; host below 1 GiB={host_memory_low}; peak Docker allocation={max_docker_memory:.1f}%; longest >=90% interval={memory_high_max_seconds:.1f}s; longest unplanned unhealthy observation={max_unhealthy_ms/1000:.1f}s")
soak_stable = memory_growth < 0.15 and latency_drift < 0.20
soak_status = "PASS" if continuous_profile_completed and soak_stable else ("BLOCKED" if not continuous_profile_completed else "FAIL")
add("Soak stability", soak_status, f"active soak={soak_observed_seconds}s/{soak_planned_seconds}s; sampled memory growth={memory_growth:.2%}; non-fault normal p95={soak_p95:.1f}ms vs sustained={reference_p95:.1f}ms (drift={latency_drift:.2%})")
analysis_queue_ok = final_analysis_queue.get("drained") is True and final_analysis_queue.get("jobs", {}).get("waiting") == 0 and final_analysis_queue.get("jobs", {}).get("active") == 0 and final_analysis_queue.get("jobs", {}).get("delayed") == 0 and final_analysis_queue.get("assessments", {}).get("pending") == 0 and final_analysis_queue.get("assessments", {}).get("processing") == 0
add("Final analysis queue drain", "PASS" if analysis_queue_ok else "FAIL", f"Stable three-sample internal BullMQ/database readback={final_analysis_queue or 'missing'}")
browser_cleanup_ok = browser_session_revocation.get("status") == "PASS" and browser_session_revocation.get("sessionCookieFound") is True and browser_session_revocation.get("verificationStatus") == 401 and browser_session_revocation.get("stateDeleted") is True and playwright_temp_verification.get("status") == "PASS" and playwright_temp_verification.get("removed") is True and playwright_temp_verification.get("networkTracesRemaining") == 0
add("Browser session and raw-trace cleanup", "PASS" if browser_cleanup_ok else "FAIL", f"session revocation={browser_session_revocation or 'missing'}; raw workspace={playwright_temp_verification or 'missing'}")
original_demo_ok = original_demo_verification.get("status") == "PASS" and original_demo_verification.get("wordpress", {}).get("enrolled") is True and original_demo_verification.get("wordpress", {}).get("effectiveMode") == "OBSERVE" and original_demo_verification.get("wordpress", {}).get("queueDepth") == 0 and original_demo_verification.get("platform", {}).get("activeRules") == 0
add("Original demo restoration", "PASS" if original_demo_ok else "FAIL", f"Post-restore enrolled/ONLINE/OBSERVE/zero-queue/zero-rule proof={original_demo_verification or 'missing'}")
final_safe = bool(final_cleanup.get("ok")) and final_cleanup.get("activeRules") == 0 and final_cleanup.get("residualRunRules") == 0 and final_cleanup.get("realSite", {}).get("enforcementMode") == "OBSERVE" and final_cleanup.get("wordpress", {}).get("queueDepth") == 0 and final_cleanup.get("wordpress", {}).get("droppedEvents") == 0 and analysis_queue_ok and browser_cleanup_ok and original_demo_ok and run_integrity.get("teardownComplete") is True and run_integrity.get("originalDemoRestored") is True
final_safe_status = "PASS" if final_safe else ("BLOCKED" if not final_cleanup else "FAIL")
add("Final safe state", final_safe_status, f"Pre-teardown OBSERVE/no-rule snapshot={final_cleanup or 'unavailable'}; isolated stack removed={run_integrity.get('teardownComplete')}; original demo restored={run_integrity.get('originalDemoRestored')}")
add("Playwright browser controls and evidence", "PASS" if browser_evidence_ok else "FAIL", f"UI control smoke={browser_ui_smoke.get('status', 'missing')}; assertions passing={sum(1 for value in browser_assertions.values() if value.get('status') == 'PASS')}/{len(required_capture_labels)}; missing screenshots={missing_browser or 'none'}; invalid images={invalid_browser_images or 'none'}; trace action files={len(trace_action_files)}; missing traces={missing_capture_traces or 'none'}; retained network traces={len(trace_network_files)}")
add("Hugging Face", "NOT CONFIGURED", "No provider secret; AI completion is excluded from core pass criteria", False)
add("Telegram", "NOT CONFIGURED", "No provider secret", False)
add("SMTP", "NOT CONFIGURED", "No provider secret", False)

mandatory_failures = [row for row in rows if row["mandatory"] and row["status"] != "PASS"]
verdict = "PASS" if not mandatory_failures else "FAIL"

limitations = [
    "Docker Desktop on one 8 CPU / approximately 8 GiB host is not a public multi-host production certification.",
    "One real WordPress plugin is combined with 49 protocol-accurate synthetic signed agents.",
    "External AI, SMTP, and Telegram providers were not configured; durable ingestion is measured separately from AI completion.",
    "The macOS host firewall and public-internet routing are outside scope.",
]
if not continuous_profile_completed:
    limitations.insert(0, run_integrity.get("reason", "The continuous-run completion record was unavailable."))
    limitations.insert(1, f"The soak contains {soak_observed_seconds} active seconds of the planned {soak_planned_seconds}; partial soak statistics are diagnostic, not a completed acceptance result.")


def phase_acceptance(item: dict[str, Any]) -> str:
    phase = item["phase"]
    scenario_ok = item["firewallCorrect"] == 1 and item["honeypotCorrect"] == 1 and item["rateCorrect"] == 1 and item["platformCorrect"] == 1
    if phase == "soak-chaos":
        return "PASS" if continuous_profile_completed and soak_stable and nonfault_soak_ok and all(value["status"] == "PASS" for value in fault_results) else ("BLOCKED" if not continuous_profile_completed else "FAIL")
    if phase == "spike":
        return "PASS" if spike_ok and scenario_ok and item["firewallP95Ms"] <= 350 else "FAIL"
    if phase.startswith("breakpoint-"):
        return "PASS" if breakpoint_stage_passes(item) else "FAIL"
    normal_ok = item["normalErrorRate"] <= 0.01 and item["normalP95Ms"] <= 500 and item["normalP99Ms"] <= 1000 and item["droppedIterations"] == 0
    return "PASS" if normal_ok and scenario_ok else "FAIL"


for item in phase_metrics:
    item["status"] = phase_acceptance(item)

result = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "runId": RUN_ID,
    "verdict": verdict,
    "productionLikeLocalOnly": True,
    "profile": (ARTIFACT / "profile.txt").read_text().strip() if (ARTIFACT / "profile.txt").exists() else None,
    "timeScale": float((ARTIFACT / "time-scale.txt").read_text().strip()) if (ARTIFACT / "time-scale.txt").exists() else None,
    "highestPassingRps": recomputed_highest_passing,
    "reportedHighestPassingRps": breakpoint.get("highestPassingRps"),
    "phaseMetrics": phase_metrics,
    "checks": rows,
    "faults": fault_results,
    "agentSecurity": agent_security,
    "redisReplayFailClosed": redis_replay_probe,
    "telemetry": {
        "samples": len(telemetry),
        "readinessRatio": readiness_ratio,
        "maxQueue": max_queue,
        "maxQueueBytes": max_queue_bytes,
        "maxDroppedEvents": max_drops,
        "maxDockerMemoryPercent": max_docker_memory,
        "queueEvidence": {"validSamples": len(queue_samples), "totalSamples": len(telemetry), "coverage": queue_coverage, "valid": queue_telemetry_valid, "finalReadbackValid": final_spool_valid},
        "resourceEvidence": {"validSamples": len(resource_samples), "totalSamples": len(telemetry), "coverage": resource_coverage, "valid": resource_telemetry_valid, "hostMemoryLow": host_memory_low, "memoryHighMaxSeconds": memory_high_max_seconds},
        "prometheusEvidence": {"requiredMetrics": sorted(EXPECTED_CUSTOM_METRICS), "completeSamples": len(prometheus_samples), "nonFaultSamples": prometheus_denominator, "coverage": prometheus_ratio, "neverObserved": prometheus_missing_metrics, "perMetricSamples": dict(sorted(prometheus_metric_coverage.items()))},
        "soakMemoryGrowth": memory_growth,
        "soakNormalP95Ms": soak_p95,
        "soakLatencyDrift": latency_drift,
        "finalSpool": final_spool,
    },
    "reconciliation": {"generated": {"honeypotCaptured": generated_honeypot, "honeypotAttempts": generated_honeypot_attempts, "firewall": generated_firewall, "rateLimit": generated_rate}, "stored": reconciliation},
    "qualityGateEvidence": {"expected": sorted(EXPECTED_QUALITY_GATES), "observed": quality, "missing": quality_missing, "unexpected": quality_unexpected, "duplicates": quality_duplicates, "valid": quality_inventory_valid},
    "agentCadence": agent_cadence,
    "breakpointValidation": breakpoint_validation,
    "finalAnalysisQueue": final_analysis_queue,
    "browserSessionRevocation": browser_session_revocation,
    "playwrightTempVerification": playwright_temp_verification,
    "originalDemoVerification": original_demo_verification,
    "reproducibility": reproducibility,
    "finalizationStatus": finalization_status,
    "policyTelemetry": {"validSamples": len(policy_state_samples), "totalSamples": len(telemetry), "coverage": policy_state_coverage, "valid": policy_state_telemetry_valid},
    "limitations": limitations,
    "runIntegrity": run_integrity,
}
result = json_safe(result)
(ARTIFACT / "result.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
os.chmod(ARTIFACT / "result.json", 0o600)


def esc(value: Any) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def short(value: Any, limit: int = 320) -> str:
    text = str(value).replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 3] + "..."


styles = getSampleStyleSheet()
NAVY = colors.HexColor("#0B172A")
BLUE = colors.HexColor("#1D63ED")
CYAN = colors.HexColor("#22B8CF")
GREEN = colors.HexColor("#16845B")
RED = colors.HexColor("#C23B3B")
AMBER = colors.HexColor("#B7791F")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#5C677D")
LIGHT = colors.HexColor("#EEF3F8")
WHITE = colors.white

styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=29, leading=34, textColor=WHITE, spaceAfter=12))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["BodyText"], fontName="Helvetica", fontSize=12, leading=18, textColor=colors.HexColor("#D6E4FF")))
styles.add(ParagraphStyle(name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=NAVY, spaceBefore=4, spaceAfter=10))
styles.add(ParagraphStyle(name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=INK, spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name="Bodyx", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13.5, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="Smallx", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED))
styles.add(ParagraphStyle(name="KPI", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=18, leading=20, textColor=NAVY, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="KPILabel", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9, textColor=MUTED, alignment=TA_CENTER))


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFillColor(NAVY)
        canvas.rect(0, A4[1] - 15 * mm, A4[0], 15 * mm, stroke=0, fill=1)
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(18 * mm, A4[1] - 9.5 * mm, "SmartHoneyAI | Production-like local validation")
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 9.5 * mm, RUN_ID)
        canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(18 * mm, 8.5 * mm, "Authorized isolated synthetic traffic only")
        canvas.drawRightString(A4[0] - 18 * mm, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


class ReportDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=22 * mm, bottomMargin=18 * mm, title="SmartHoneyAI Production Simulation Report", author="SmartHoneyAI local validation harness", subject=RUN_ID)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates(PageTemplate(id="report", frames=[frame], onPage=header_footer))


def section(title: str):
    return Paragraph(esc(title), styles["H1x"])


def body(text: str):
    return Paragraph(esc(text), styles["Bodyx"])


def status_color(status: str):
    return {"PASS": GREEN, "FAIL": RED, "BLOCKED": AMBER, "NOT CONFIGURED": MUTED}.get(status, MUTED)


def chart(title: str, labels: list[str], values: list[float], color=BLUE, suffix="") -> Drawing:
    width, height = 174 * mm, 62 * mm
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=colors.white, strokeColor=colors.HexColor("#DCE4EE"), rx=5, ry=5))
    drawing.add(String(9, height - 17, title, fontName="Helvetica-Bold", fontSize=9, fillColor=NAVY))
    if not values:
        drawing.add(String(9, height / 2, "No data", fontSize=9, fillColor=MUTED))
        return drawing
    plot_left, plot_bottom, plot_width, plot_height = 38, 28, width - 54, height - 57
    clean = [0 if not math.isfinite(v) else v for v in values]
    top = max(clean) or 1
    for tick in range(5):
        y = plot_bottom + plot_height * tick / 4
        drawing.add(Line(plot_left, y, plot_left + plot_width, y, strokeColor=colors.HexColor("#E6ECF2"), strokeWidth=0.5))
        tick_value = top * tick / 4
        decimals = 2 if suffix == "%" and top <= 1 else 1 if suffix == "%" and top < 10 else 0
        drawing.add(String(3, y - 2, f"{tick_value:.{decimals}f}{suffix}", fontSize=6.7, fillColor=MUTED))
    points = []
    for index, value in enumerate(clean):
        x = plot_left + (plot_width * index / max(1, len(clean) - 1))
        y = plot_bottom + plot_height * value / top
        points.extend([x, y])
        label = labels[index].replace("breakpoint-", "bp-").replace("harness-smoke", "smoke")
        drawing.add(String(x - 9, 8, label[:10], fontSize=6.5, fillColor=MUTED))
    if len(points) >= 4:
        drawing.add(PolyLine(points, strokeColor=color, strokeWidth=1.8))
    elif points:
        drawing.add(Rect(points[0] - 2, points[1] - 2, 4, 4, fillColor=color, strokeColor=color))
    return drawing


def multi_chart(title: str, labels: list[str], series: dict[str, list[float]], suffix="") -> Drawing:
    width, height = 174 * mm, 68 * mm
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=colors.white, strokeColor=colors.HexColor("#DCE4EE"), rx=5, ry=5))
    drawing.add(String(9, height - 17, title, fontName="Helvetica-Bold", fontSize=9, fillColor=NAVY))
    palette = [BLUE, CYAN, GREEN, RED, AMBER]
    clean_series = {name: [0 if not math.isfinite(value) else value for value in values] for name, values in series.items()}
    top = max((max(values, default=0) for values in clean_series.values()), default=0) or 1
    plot_left, plot_bottom, plot_width, plot_height = 38, 33, width - 54, height - 65
    for tick in range(5):
        y = plot_bottom + plot_height * tick / 4
        drawing.add(Line(plot_left, y, plot_left + plot_width, y, strokeColor=colors.HexColor("#E6ECF2"), strokeWidth=0.5))
        drawing.add(String(3, y - 2, f"{top * tick / 4:.0f}{suffix}", fontSize=6.5, fillColor=MUTED))
    for series_index, (name, values) in enumerate(clean_series.items()):
        line_color = palette[series_index % len(palette)]
        points = []
        for index, value in enumerate(values):
            x = plot_left + plot_width * index / max(1, len(values) - 1)
            y = plot_bottom + plot_height * value / top
            points.extend([x, y])
        if len(points) >= 4:
            drawing.add(PolyLine(points, strokeColor=line_color, strokeWidth=1.4))
        legend_x = 8 + (series_index % 3) * 155
        legend_y = 10 + (series_index // 3) * 10
        drawing.add(Line(legend_x, legend_y + 2, legend_x + 12, legend_y + 2, strokeColor=line_color, strokeWidth=1.8))
        drawing.add(String(legend_x + 16, legend_y, name, fontSize=6.2, fillColor=MUTED))
    return drawing


story = []
cover = Table([[Paragraph("SMART HONEY AI", ParagraphStyle("brand", fontName="Helvetica-Bold", fontSize=10, textColor=CYAN, leading=12))], [Spacer(1, 35 * mm)], [Paragraph("Production-Level Real-Time Honeypot Simulation", styles["ReportTitle"])], [Paragraph("Executive and technical validation report for WordPress bot detection, firewall enforcement, signed agents, stress capacity, telemetry, and fault recovery.", styles["CoverSub"])], [Spacer(1, 16 * mm)], [Table([[Paragraph(verdict, ParagraphStyle("verdict", fontName="Helvetica-Bold", fontSize=22, textColor=WHITE, alignment=TA_CENTER)), Paragraph(f"Highest passing stage<br/><b>{recomputed_highest_passing} RPS</b>", styles["CoverSub"]), Paragraph(f"Mandatory non-passes<br/><b>{len(mandatory_failures)}</b>", styles["CoverSub"]) ]], colWidths=[45 * mm, 55 * mm, 55 * mm], style=TableStyle([("BACKGROUND", (0, 0), (0, 0), status_color(verdict)), ("BACKGROUND", (1, 0), (-1, -1), colors.HexColor("#132641")), ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#2D486C")), ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#2D486C")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]))], [Spacer(1, 25 * mm)], [Paragraph(f"Run ID: {esc(RUN_ID)}<br/>Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}<br/>Environment: isolated Docker Desktop project honeypot-ai-perf", styles["CoverSub"]) ]], colWidths=[174 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 12 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 12 * mm), ("TOPPADDING", (0, 0), (-1, -1), 5 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm)]))
story.extend([cover, PageBreak()])

story.extend([section("Executive outcome"), body("The verdict is evidence-driven: every mandatory availability, correctness, security, durability, recovery, and final-safety row must pass. Expected 401, 403, 404, 429, and scheduled fault-window failures are evaluated by scenario rather than counted as ordinary application errors."), Spacer(1, 2 * mm)])
kpi = Table([
    [Paragraph(verdict, styles["KPI"]), Paragraph(str(recomputed_highest_passing), styles["KPI"]), Paragraph(f"{readiness_ratio:.2%}", styles["KPI"]), Paragraph(str(max_drops), styles["KPI"])],
    [Paragraph("OVERALL VERDICT", styles["KPILabel"]), Paragraph("HIGHEST PASSING RPS", styles["KPILabel"]), Paragraph("NON-FAULT READINESS", styles["KPILabel"]), Paragraph("DROPPED EVENTS", styles["KPILabel"])],
], colWidths=[43.5 * mm] * 4, style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), LIGHT), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DFEA")), ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DFEA")), ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
story.extend([kpi, Spacer(1, 5 * mm), Paragraph("Decision summary", styles["H2x"])])
if mandatory_failures:
    story.append(body("Production-like local validation did not earn a full PASS. Measured failures are release blockers or explicit capacity limits; BLOCKED rows identify evidence that was not completed or could not be verified."))
else:
    story.append(body("All mandatory local production-like acceptance rows passed. The result remains bounded to the topology and host described in this report."))
completed_phase_names = ", ".join(item["phase"] for item in phase_metrics) or "none"
story.extend([Paragraph("Test topology", styles["H2x"]), body("One real WordPress 7.0 / PHP 8.3 plugin instance plus 49 separately enrolled, per-site signed synthetic agents. The control plane includes Nginx, web, API, worker, PostgreSQL, Redis, Prometheus, Grafana, Alertmanager, WordPress, and MariaDB in an isolated Compose project."), Paragraph("Run continuity", styles["H2x"]), body(f"Recorded load phases: {completed_phase_names}. The active soak reached {soak_observed_seconds // 60}m{soak_observed_seconds % 60:02d}s of {soak_planned_seconds // 60}m{soak_planned_seconds % 60:02d}s. {run_integrity.get('reason', 'No continuity record was available.')}"), PageBreak()])

story.append(section("Acceptance matrix"))
matrix_data = [[Paragraph("Check", styles["Smallx"]), Paragraph("Status", styles["Smallx"]), Paragraph("Evidence", styles["Smallx"])]]
for row in sorted(rows, key=lambda item: (not item["mandatory"], item["status"] == "PASS", item["name"])):
    matrix_data.append([Paragraph(esc(row["name"]), styles["Smallx"]), Paragraph(f"<b>{esc(row['status'])}</b>", styles["Smallx"]), Paragraph(esc(short(row["evidence"])), styles["Smallx"])])
matrix = Table(matrix_data, colWidths=[43 * mm, 28 * mm, 103 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E1EA")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), *[("TEXTCOLOR", (1, index + 1), (1, index + 1), status_color(row["status"])) for index, row in enumerate(sorted(rows, key=lambda item: (not item["mandatory"], item["status"] == "PASS", item["name"])))] ]))
story.extend([matrix, PageBreak()])

story.append(section("Traffic and latency"))
chart_phases = [item for item in phase_metrics if item["phase"] != "harness-smoke"]
story.extend([
    body(f"Traffic methodology targets 60% ordinary WordPress, 15% four-route honeypot, 10% firewall, 10% rate-limit, and 5% platform traffic. Observed mix: {observed_mix_text}. The schedule covers baseline, ramp, sustained load, a 100 RPS spike, 75-200 RPS breakpoint stages, and a 25 RPS chaos soak."),
    chart("Achieved request rate by phase", [item["phase"] for item in chart_phases], [item["achievedRps"] for item in chart_phases], CYAN, " RPS"),
    Spacer(1, 4 * mm),
    chart("Normal traffic p95 latency by phase", [item["phase"] for item in chart_phases], [item["normalP95Ms"] for item in chart_phases], BLUE, "ms"),
    PageBreak(),
    section("Traffic error and phase matrix"),
    Spacer(1, 4 * mm),
    chart("Normal response error rate by phase", [item["phase"] for item in chart_phases], [100 * item["normalErrorRate"] for item in chart_phases], RED, "%"),
    Spacer(1, 4 * mm),
])
phase_table = [["Phase", "Status", "RPS", "Requests", "Normal p95", "Normal p99", "Errors"]]
for item in phase_metrics:
    phase_table.append([item["phase"], item["status"], f"{item['rate']:.0f}", f"{item['requests']:.0f}", f"{item['normalP95Ms']:.1f} ms", f"{item['normalP99Ms']:.1f} ms", f"{item['normalErrorRate']:.2%}"])
story.append(Table(phase_table, colWidths=[37 * mm, 18 * mm, 16 * mm, 22 * mm, 27 * mm, 27 * mm, 27 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 7), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D9E1EA")), ("ALIGN", (2, 1), (-1, -1), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])))
story.append(PageBreak())

sample_step = max(1, len(telemetry) // 18)
sample_indexes = list(range(0, len(telemetry), sample_step))
sample_labels = [str(index) for index in sample_indexes]
charted_services = ("wordpress", "wordpress-db", "api", "worker", "postgres")
container_cpu = {
    service: [float(next((container.get("cpuPercent") or 0 for container in telemetry[index].get("containers", []) if container.get("service") == service), 0)) for index in sample_indexes]
    for service in charted_services
}
container_memory = {
    service: [float(next((container.get("memoryPercent") or 0 for container in telemetry[index].get("containers", []) if container.get("service") == service), 0)) for index in sample_indexes]
    for service in charted_services
}
breakpoint_metrics = [item for item in phase_metrics if item["phase"].startswith("breakpoint-")]
fault_events = [item for item in faults if item.get("action") in {"outage_started", "recovered"}]
fault_origin = min((datetime.fromisoformat(item["at"].replace("Z", "+00:00")) for item in fault_events), default=datetime.now(timezone.utc))
fault_labels = [f"{item.get('service')}-{'down' if item.get('action') == 'outage_started' else 'up'}" for item in fault_events]
fault_seconds = [(datetime.fromisoformat(item["at"].replace("Z", "+00:00")) - fault_origin).total_seconds() for item in fault_events]

story.append(section("Resource and capacity telemetry"))
story.extend([
    multi_chart("Per-container CPU during sampled run", sample_labels, container_cpu, "%"),
    Spacer(1, 4 * mm),
    multi_chart("Per-container memory-limit usage", sample_labels, container_memory, "%"),
    PageBreak(),
    section("Queue, event, and breakpoint telemetry"),
    chart("WordPress local queue depth", sample_labels, [queue_series[index] for index in sample_indexes], AMBER, ""),
    Spacer(1, 4 * mm),
    chart("Central event ingestion throughput", sample_labels, [event_throughput_series[index] for index in sample_indexes], GREEN, "/s"),
    PageBreak(),
    section("Breakpoint and fault timeline"),
    chart("Breakpoint p95 latency curve", [item["phase"] for item in breakpoint_metrics], [item["normalP95Ms"] for item in breakpoint_metrics], RED, "ms"),
    Spacer(1, 4 * mm),
    chart("Fault and recovery timeline", fault_labels, fault_seconds, AMBER, "s"),
    PageBreak(),
])

story.append(section("Honeypot, firewall, and evidence integrity"))
story.append(body(f"The mixed workload generated {generated_honeypot} honeypot captures, {generated_firewall} application-firewall 403 responses, and {generated_rate} database-backed 429 responses. The reconciliation gate compares those counters with centrally stored events carrying the same run-specific user-agent prefixes."))
event_table = [
    ["Signal", "Generated", "Stored", "Result"],
    ["HONEYPOT", generated_honeypot, reconciliation.get("honeypot", "missing"), "MATCH" if reconciliation.get("honeypot") == generated_honeypot else ("BLOCKED" if "honeypot" not in reconciliation else "MISMATCH")],
    ["FIREWALL", generated_firewall, reconciliation.get("firewall", "missing"), "MATCH" if reconciliation.get("firewall") == generated_firewall else ("BLOCKED" if "firewall" not in reconciliation else "MISMATCH")],
    ["RATE_LIMIT", generated_rate, reconciliation.get("rateLimit", "missing"), "MATCH" if reconciliation.get("rateLimit") == generated_rate else ("BLOCKED" if "rateLimit" not in reconciliation else "MISMATCH")],
    ["RATE_ATOMIC", 10, reconciliation.get("rateAtomic", "missing"), "MATCH" if reconciliation.get("rateAtomic") == 10 else ("BLOCKED" if "rateAtomic" not in reconciliation else "MISMATCH")],
    ["SYNTHETIC_AGENT", (agent_runtime or {}).get("eventsSubmitted", "missing"), reconciliation.get("syntheticAgent", "missing"), "MATCH" if reconciliation.get("syntheticAgent") == (agent_runtime or {}).get("eventsSubmitted") else ("BLOCKED" if "syntheticAgent" not in reconciliation else "MISMATCH")],
    ["Duplicate keys", 0, reconciliation.get("duplicateKeys", "missing"), "PASS" if reconciliation.get("duplicateKeys") == 0 else ("BLOCKED" if "duplicateKeys" not in reconciliation else "FAIL")],
]
story.append(Table(event_table, colWidths=[50 * mm, 37 * mm, 37 * mm, 50 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9E1EA")), ("ALIGN", (1, 1), (-2, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))
story.extend([Spacer(1, 5 * mm), Paragraph("Security controls exercised", styles["H2x"]), body("The functional campaign covers all four inert decoys, observation-gate rejection, OBSERVE fail-open behavior, temporary ENFORCE, exact and CIDR IP rules, route and user-agent rules, allow precedence, expiry, protected private sources, atomic rate limiting, 403/429 event capture, and safe cleanup. Signed-agent regression tests reject malformed timestamps and sanitize credential-bearing metadata and textual evidence before persistence."), Paragraph("Spool behavior and durability", styles["H2x"]), body(f"Observed peak: {max_queue} rows and {max_queue_bytes} bytes. Cumulative drops: {max_drops}. Final spool: {final_spool}. {run_integrity.get('queueDropRootCause', 'No queue diagnosis was recorded.')} Queue telemetry was collected with read-only O(1) state-row queries, without invoking a delivery tick."), PageBreak()])

story.append(section("Fault injection and recovery"))
fault_table = [["Service", "Expected behavior", "Outage / recovery", "Status"]]
expectations = {"worker": "Ingestion durable; analysis backlog grows", "api": "WordPress remains available; local spool grows", "redis": "Replay protection fails closed with 503", "wordpress-db": "Controlled WordPress failure only in fault window"}
for item in fault_results:
    outage = f"{item['outageSeconds']:.1f}s" if item["outageSeconds"] is not None else "missing"
    recovery = f"{item['recoverySeconds']:.1f}s" if item["recoverySeconds"] is not None else "missing"
    fault_table.append([item["service"], expectations[item["service"]], f"{outage} / {recovery}", item["status"]])
story.append(Table(fault_table, colWidths=[29 * mm, 84 * mm, 35 * mm, 26 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E1EA")), ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))
fault_summary = "; ".join(f"{item['service']}={item['status']} (outage {item['outageSeconds']}, recovery {item['recoverySeconds']}s)" for item in fault_results)
story.extend([Spacer(1, 5 * mm), body(f"Non-fault API readiness was {readiness_ratio:.3%}. Fault evidence: {fault_summary}. The Redis signed probe returned {redis_replay_probe.get('status', 'missing')} {redis_replay_probe.get('code', 'missing')}. The read-only natural-drain snapshot reported queue depth {natural_wp.get('queueDepth', 'missing')}."), chart("Docker allocation usage during sampled run", [str(index) for index in range(0, len(telemetry), max(1, len(telemetry) // 12))], [(telemetry[index].get("resources", {}).get("dockerMemoryPercent") or 0) for index in range(0, len(telemetry), max(1, len(telemetry) // 12))], CYAN, "%"), PageBreak()])

story.append(section("Browser evidence"))
story.append(body(f"Playwright CLI verified authenticated routing, live connection state, run-tagged firewall-rule creation and disablement, Observe-to-Enforce mode control, event visibility, logout, and protected-route redirection. {len(trace_action_files)} action-trace files are retained; network trace files are deliberately excluded so cookies and authorization headers cannot enter evidence."))
screenshots = sorted((ARTIFACT / "screenshots").glob("*.png"))
selected = []
for preferred in ("baseline-dashboard.png", "sustained-dashboard.png", "peak-dashboard.png", "fault-worker-dashboard.png", "recovered-worker-dashboard.png", "fault-api-dashboard.png", "recovered-api-dashboard.png", "fault-redis-dashboard.png", "recovered-redis-dashboard.png", "fault-wordpress-db-dashboard.png", "recovered-wordpress-db-dashboard.png", "recovery-dashboard.png", "final-sites.png", "final-events.png", "final-firewall.png"):
    path = ARTIFACT / "screenshots" / preferred
    if path.exists():
        selected.append(path)
if not selected:
    story.append(body("No browser screenshots were available. This is a mandatory evidence gap."))
for index, path in enumerate(selected):
    with PILImage.open(path) as image:
        width, height = image.size
    display_path = path
    if path.name == "fault-api-dashboard.png":
        cropped_path = RENDER_DIR / "fault-api-dashboard-crop.png"
        with PILImage.open(path) as image:
            image.crop((140, 300, image.width - 140, 700)).save(cropped_path)
            width, height = image.width - 280, 400
        display_path = cropped_path
    display_width = 174 * mm
    display_height = display_width * height / width
    if display_height > 100 * mm:
        display_height = 100 * mm
        display_width = display_height * width / height
    story.append(KeepTogether([Paragraph(esc(path.stem.replace("-", " ").title()), styles["H2x"]), Image(str(display_path), width=display_width, height=display_height), Spacer(1, 3 * mm)]))
    if path.name == "fault-api-dashboard.png":
        story.extend([body("The control-plane application error shown here is expected while the API is intentionally stopped. Independent telemetry and the acceptance matrix determine WordPress availability, local buffering, drops, outage duration, and recovery."), Table([["Signal", "Evaluation source"], ["Control-plane readiness", "Two-second readiness telemetry"], ["WordPress availability", "Container health and real HTTP traffic"], ["Local buffering", "Read-only transactional queue-state counters"]], colWidths=[55 * mm, 119 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E1EA")), ("FONTSIZE", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))])
    if index % 2 == 1 and index != len(selected) - 1:
        story.append(PageBreak())
story.append(PageBreak())

story.append(section("Limitations and recommendations"))
for limitation in result["limitations"]:
    story.append(body(f"- {limitation}"))
story.append(Paragraph("Priority actions", styles["H2x"]))
recommendations = []
if mandatory_failures:
    recommendations.extend([f"Remediate: {row['name']} - {short(row['evidence'], 220)}" for row in mandatory_failures[:8]])
else:
    recommendations.append("Repeat the profile on production-sized Linux infrastructure with multiple real WordPress installations before setting commercial capacity commitments.")
if max_drops > 0:
    recommendations.append("Investigate every queue drop and repeat the profile after proving exact transactional counters and lease-safe delivery under the same load.")
if not continuous_profile_completed:
    recommendations.append("Repeat the complete chaos/soak with host sleep prevention active and require final reconciliation, drain, and OBSERVE/zero-rule snapshots.")
recommendations.extend([
    "Add API, WordPress, PostgreSQL, Redis, and MariaDB request/latency exporters for deeper multi-service capacity attribution.",
    "Configure a deterministic local classifier or controlled provider quota before treating AI completion throughput as a core SLO.",
    "Retain transactional spool counters, delivery leases, signal-safe cleanup, and the isolated-project model for future chaos tests.",
])
for item in recommendations:
    story.append(body(f"- {item}"))
story.extend([PageBreak(), section("Reproducibility appendix")])
appendix_values = [
    ("Item", "Value"),
    ("Run ID", RUN_ID),
    ("Project", "honeypot-ai-perf"),
    ("Profile", result.get("profile")),
    ("Time scale", result.get("timeScale")),
    ("Telemetry samples", len(telemetry)),
    ("k6 summaries", len(summaries)),
    ("Highest passing stage", recomputed_highest_passing),
    ("Source revision", reproducibility.get("source", {}).get("revision", "missing")),
    ("Source dirty", reproducibility.get("source", {}).get("dirty", "missing")),
    ("Docker", f"{reproducibility.get('docker', {}).get('serverVersion', 'missing')} / Compose {reproducibility.get('docker', {}).get('composeVersion', 'missing')} / {reproducibility.get('docker', {}).get('architecture', 'missing')}"),
    ("Docker allocation", f"{reproducibility.get('docker', {}).get('cpus', 'missing')} CPUs / {reproducibility.get('docker', {}).get('memoryBytes', 'missing')} bytes"),
    ("Host", f"{reproducibility.get('host', {}).get('operatingSystem', 'missing')} {reproducibility.get('host', {}).get('kernelRelease', '')} {reproducibility.get('host', {}).get('architecture', '')}"),
    ("Toolchain", ", ".join(f"{name}={version}" for name, version in reproducibility.get("tools", {}).items())),
    ("Resolved services", ", ".join(sorted(resolved_compose.get("services", {}).keys())) or "missing"),
    ("Service CPU/memory limits", "; ".join(f"{name}: cpu={service.get('cpus', 'default')}, memory={service.get('mem_limit', 'default')}" for name, service in sorted(resolved_compose.get("services", {}).items()) if name in {"api", "worker", "postgres", "redis", "wordpress", "wordpress-db", "k6"}) or "missing"),
    ("Observed traffic mix", ", ".join(f"{name}={traffic_mix[name]:.2%} ({traffic_counts[name]})" for name in traffic_counts)),
    ("PDF path", str(PDF_PATH)),
    ("Evidence directory", str(ARTIFACT)),
]
appendix = [[Paragraph(esc(label), styles["Smallx"]), Paragraph(esc(value), styles["Smallx"])] for label, value in appendix_values]
story.append(Table(appendix, colWidths=[52 * mm, 122 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E1EA")), ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)])))
story.append(Paragraph("Resolved image versions and digests", styles["H2x"]))
image_rows = [[Paragraph("Reference", styles["Smallx"]), Paragraph("Resolved digest", styles["Smallx"])]]
for item in image_inventory.get("images", []):
    reference = (item.get("repoTags") or ["untagged"])[0]
    digest = (item.get("repoDigests") or ["missing"])[0]
    image_rows.append([Paragraph(esc(reference), styles["Smallx"]), Paragraph(esc(digest), styles["Smallx"])])
story.append(Table(image_rows, colWidths=[62 * mm, 112 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E1EA")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])))
story.extend([Spacer(1, 5 * mm), body("Every evidence file is permission-restricted. The SHA-256 manifest beside the machine-readable result records the final artifact set. Credentials, enrollment tokens, signing secrets, cookies, and submitted password canaries are excluded from the report."), KeepTogether([Paragraph("Pinned-image references", styles["H2x"]), Paragraph('<link href="https://hub.docker.com/_/wordpress" color="#1D63ED">Official WordPress image repository</link><br/><link href="https://hub.docker.com/_/mariadb" color="#1D63ED">Official MariaDB image repository</link><br/><link href="https://github.com/grafana/k6/releases/tag/v2.0.0" color="#1D63ED">Grafana k6 v2.0.0 release</link>', styles["Bodyx"])])])

doc = ReportDoc(str(PDF_PATH))
doc.build(story)
os.chmod(PDF_PATH, 0o600)

report_lines = [
    "# Production-Level Real-Time Honeypot Simulation",
    "",
    f"Run: `{RUN_ID}`  ",
    f"Verdict: **{verdict}**  ",
    f"PDF: `{PDF_PATH}`",
    "",
    "## Acceptance matrix",
    "",
    "| Check | Status | Evidence |",
    "|---|---|---|",
]
for row in rows:
    report_lines.append(f"| {row['name']} | {row['status']} | {str(row['evidence']).replace('|', '/')} |")
report_lines.extend(["", "## Limitations", ""] + [f"- {item}" for item in result["limitations"]])
(ARTIFACT / "report.md").write_text("\n".join(report_lines) + "\n")
os.chmod(ARTIFACT / "report.md", 0o600)

for old in RENDER_DIR.glob("page-*.png"):
    old.unlink()
subprocess.run(["pdftoppm", "-png", "-r", "120", str(PDF_PATH), str(RENDER_DIR / "page")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
pdfinfo_raw = subprocess.run(["pdfinfo", str(PDF_PATH)], check=True, text=True, capture_output=True).stdout
pdfinfo_fields = {}
for line in pdfinfo_raw.splitlines():
    if ":" in line:
        key, value = line.split(":", 1)
        pdfinfo_fields[key.strip()] = value.strip()
reader = PdfReader(str(PDF_PATH))
page_images = sorted(RENDER_DIR.glob("page-*.png"))
with pdfplumber.open(PDF_PATH) as pdf:
    page_texts = [(page.extract_text() or "") for page in pdf.pages]
    extracted = "\n".join(page_texts)
    clipped_objects = []
    for page_number, page in enumerate(pdf.pages, start=1):
        for kind in ("chars", "images"):
            for index, item in enumerate(getattr(page, kind, [])):
                x0, x1 = float(item.get("x0", 0)), float(item.get("x1", 0))
                top, bottom = float(item.get("top", 0)), float(item.get("bottom", 0))
                if x0 < -0.5 or x1 > page.width + 0.5 or top < -0.5 or bottom > page.height + 0.5:
                    clipped_objects.append({"page": page_number, "kind": kind, "index": index, "box": [x0, top, x1, bottom]})
empty_pages = []
for index, page in enumerate(reader.pages):
    if not (page.extract_text() or "").strip():
        empty_pages.append(index + 1)
image_checks = []
for path in page_images:
    with PILImage.open(path) as image:
        image_checks.append({"file": path.name, "width": image.width, "height": image.height, "valid": image.width > 900 and image.height > 1200})
required_text = ["Executive outcome", "Acceptance matrix", "Fault injection and recovery", "Limitations and recommendations", RUN_ID]
required_chart_titles = [
    "Achieved request rate by phase",
    "Normal traffic p95 latency by phase",
    "Normal response error rate by phase",
    "Per-container CPU during sampled run",
    "Per-container memory-limit usage",
    "WordPress local queue depth",
    "Central event ingestion throughput",
    "Breakpoint p95 latency curve",
    "Fault and recovery timeline",
]
page_headers = {str(index): "SmartHoneyAI | Production-like local validation" in text for index, text in enumerate(page_texts, start=1) if index > 1}
page_numbers = {str(index): f"Page {index}" in text for index, text in enumerate(page_texts, start=1) if index > 1}
metadata = {
    "title": reader.metadata.title if reader.metadata else None,
    "author": reader.metadata.author if reader.metadata else None,
    "subject": reader.metadata.subject if reader.metadata else None,
}
page_sizes_a4 = []
for page in reader.pages:
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    page_sizes_a4.append(abs(width - A4[0]) <= 1 and abs(height - A4[1]) <= 1)
verification = {
    "pdf": str(PDF_PATH),
    "pages": len(reader.pages),
    "pdfinfo": {key: pdfinfo_fields.get(key) for key in ("Title", "Subject", "Author", "Pages", "Page size", "File size", "PDF version")},
    "renderedPages": len(page_images),
    "emptyTextPages": empty_pages,
    "requiredTextPresent": {value: value in extracted for value in required_text},
    "requiredChartTitlesPresent": {value: value in extracted for value in required_chart_titles},
    "pageHeadersPresent": page_headers,
    "pageNumbersPresent": page_numbers,
    "pageSizesA4": page_sizes_a4,
    "clippedObjects": clipped_objects,
    "renderedImages": image_checks,
    "metadata": metadata,
}
link_annotations = []
for page_number, page in enumerate(reader.pages, start=1):
    for annotation_ref in page.get("/Annots", []):
        annotation = annotation_ref.get_object()
        action = annotation.get("/A")
        if action and action.get("/URI"):
            link_annotations.append({"page": page_number, "uri": str(action.get("/URI"))})
verification["links"] = link_annotations
expected_links = {
    "https://hub.docker.com/_/wordpress",
    "https://hub.docker.com/_/mariadb",
    "https://github.com/grafana/k6/releases/tag/v2.0.0",
}
verification["expectedLinks"] = sorted(expected_links)
verification["exactLinksValid"] = {item["uri"] for item in link_annotations} == expected_links

secret_dir = Path(os.environ.get("E2E_SECRET_DIR", ""))
pdf_sensitive_values = []
for name in (
    "agent_signing_secret", "grafana_admin_password", "platform_admin_password",
    "postgres_password", "redis_password", "session_secret", "wordpress_admin_password",
    "wordpress_db_password", "wordpress_db_root_password", "wordpress_test_source_secret",
):
    path = secret_dir / name
    if path.exists():
        value = path.read_text(errors="ignore").strip()
        if len(value) >= 16:
            pdf_sensitive_values.append((f"secret:{name}", value))
for path in (secret_dir / "agents").glob("agents-shard-*.json") if (secret_dir / "agents").exists() else []:
    for agent in (read_json(path, {}) or {}).get("agents", []):
        value = str(agent.get("secret", ""))
        if len(value) >= 16:
            pdf_sensitive_values.append(("secret:synthetic-agent", value))
for canary in (
    f"PERF-PASSWORD-{RUN_ID}", f"PERF-AUTH-{RUN_ID}", f"PERF-COOKIE-{RUN_ID}",
    f"SIM-PASSWORD-bot-{RUN_ID}", f"SIM-DB-PASSWORD-bot-{RUN_ID}",
    f"SIM-AUTH-bot-{RUN_ID}", f"SIM-COOKIE-bot-{RUN_ID}",
):
    pdf_sensitive_values.append(("submitted-canary", canary))
pdf_secret_findings = sorted({rule for rule, value in pdf_sensitive_values if value in extracted})
if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", extracted):
    pdf_secret_findings.append("private-key-pem")
if re.search(r"hp_session=[A-Za-z0-9_\-]{16,}", extracted):
    pdf_secret_findings.append("session-cookie")
verification["sensitiveTextFindings"] = sorted(set(pdf_secret_findings))

metadata_valid = metadata == {"title": "SmartHoneyAI Production Simulation Report", "author": "SmartHoneyAI local validation harness", "subject": RUN_ID}
pdfinfo_pages = int(pdfinfo_fields.get("Pages", "0") or 0)
pdfinfo_a4 = "A4" in pdfinfo_fields.get("Page size", "")
verification["metadataValid"] = metadata_valid
verification["status"] = "PASS" if (
    len(reader.pages) == len(page_images) == pdfinfo_pages
    and not empty_pages
    and all(verification["requiredTextPresent"].values())
    and all(verification["requiredChartTitlesPresent"].values())
    and all(page_headers.values())
    and all(page_numbers.values())
    and all(page_sizes_a4)
    and pdfinfo_a4
    and not clipped_objects
    and all(item["valid"] for item in image_checks)
    and verification["exactLinksValid"]
    and metadata_valid
    and not pdf_secret_findings
) else "FAIL"
(ARTIFACT / "pdf-verification.json").write_text(json.dumps(json_safe(verification), indent=2, allow_nan=False) + "\n")
os.chmod(ARTIFACT / "pdf-verification.json", 0o600)
if verification["status"] != "PASS":
    result["verdict"] = "FAIL"
    result["pdfVerification"] = json_safe(verification)
    result.setdefault("checks", []).append({"name": "PDF structural and content validation", "status": "FAIL", "evidence": "See pdf-verification.json", "mandatory": True})
    (ARTIFACT / "result.json").write_text(json.dumps(json_safe(result), indent=2, allow_nan=False) + "\n")
    raise SystemExit(f"PDF structural verification failed: {verification}")

result["pdfVerification"] = {"status": "PASS", "pages": len(reader.pages), "renderedPages": len(page_images), "metadataValid": metadata_valid, "exactLinksValid": verification["exactLinksValid"], "clippedObjects": 0, "sensitiveTextFindings": []}
result.setdefault("checks", []).append({"name": "PDF structural and content validation", "status": "PASS", "evidence": f"pdfinfo, pypdf, pdfplumber, and Poppler validated {len(reader.pages)} A4 pages", "mandatory": True})
(ARTIFACT / "result.json").write_text(json.dumps(json_safe(result), indent=2, allow_nan=False) + "\n")

print(json.dumps({"verdict": verdict, "pdf": str(PDF_PATH), "result": str(ARTIFACT / "result.json"), "verification": verification["status"], "pages": len(reader.pages)}, indent=2))
