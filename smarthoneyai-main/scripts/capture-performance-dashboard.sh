#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
label="${1:?Usage: capture-performance-dashboard.sh LABEL [final|capture]}"
action="${2:-capture}"
run_id="${PERF_RUN_ID:?Set PERF_RUN_ID}"
artifact_dir="${PERF_ARTIFACT_DIR:?Set PERF_ARTIFACT_DIR}"
secret_dir="${E2E_SECRET_DIR:?Set E2E_SECRET_DIR}"
expected_site_count="${PERF_EXPECTED_SITE_COUNT:-50}"

case "$run_id" in *[!a-z0-9_-]*|'') printf 'Unsafe PERF_RUN_ID: %s\n' "$run_id" >&2; exit 2;; esac
case "$label" in *[!a-z0-9_-]*|'') printf 'Unsafe capture label: %s\n' "$label" >&2; exit 2;; esac
case "$action" in capture|final) :;; *) printf 'Unsupported capture action: %s\n' "$action" >&2; exit 2;; esac
case "$expected_site_count" in *[!0-9]*|'') printf 'Unsafe expected site count: %s\n' "$expected_site_count" >&2; exit 2;; esac
[ "$expected_site_count" -ge 1 ] && [ "$expected_site_count" -le 500 ] || { printf 'Expected site count must be between 1 and 500.\n' >&2; exit 2; }

work_dir="$root_dir/output/playwright/$run_id/$label"
screens_dir="$artifact_dir/screenshots"
traces_dir="$artifact_dir/traces"
pwcli="${PWCLI:-/Users/nurmuhammadhashim/.codex/skills/playwright/scripts/playwright_cli.sh}"
state_file="$secret_dir/playwright-auth-state.json"

mkdir -p "$work_dir" "$screens_dir" "$traces_dir"
chmod 700 "$work_dir" "$screens_dir" "$traces_dir"
export PLAYWRIGHT_CLI_SESSION="perf-$run_id-$label"
admin_email="${ADMIN_EMAIL:-admin@smarthoneyai.local}"
admin_password="$(cat "$secret_dir/platform_admin_password")"

pw() {
  command="$1"
  shift
  (cd "$work_dir" && "$pwcli" "$command" "$@")
}

cleanup_browser() {
  pw close >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  admin_password=""
}
trap cleanup_browser EXIT INT TERM

(cd "$work_dir" && "$pwcli" open https://localhost/ --config "$root_dir/performance/playwright-cli.json") >/dev/null
if [ -f "$state_file" ]; then
  pw state-load "$state_file" >/dev/null
fi
pw goto https://localhost/dashboard >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw snapshot > "$artifact_dir/screenshots/$label-login-snapshot.txt"
chmod 600 "$artifact_dir/screenshots/$label-login-snapshot.txt"
email_ref="$(sed -n 's/.*textbox "Email address" \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p' "$artifact_dir/screenshots/$label-login-snapshot.txt" | head -1)"
password_ref="$(sed -n 's/.*textbox "Password" \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p' "$artifact_dir/screenshots/$label-login-snapshot.txt" | head -1)"
login_ref="$(sed -n 's/.*button "Log in securely" \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p' "$artifact_dir/screenshots/$label-login-snapshot.txt" | head -1)"
if [ -n "$email_ref" ] || [ -n "$password_ref" ] || [ -n "$login_ref" ]; then
  [ ! -f "$state_file" ] || { echo "Stored browser session was rejected for $label; refusing a repeated login" >&2; exit 1; }
  [ -n "$email_ref" ] && [ -n "$password_ref" ] && [ -n "$login_ref" ] || { echo "Incomplete login form references for $label" >&2; exit 1; }
  pw fill "$email_ref" "$admin_email" >/dev/null
  pw fill "$password_ref" "$admin_password" >/dev/null
  pw click "$login_ref" >/dev/null
  pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
  pw snapshot > "$artifact_dir/screenshots/$label-authenticated-snapshot.txt"
  rg -q 'Page Title: Dashboard \| SmartHoneyAI' "$artifact_dir/screenshots/$label-authenticated-snapshot.txt"
  pw state-save "$state_file" >/dev/null
  chmod 600 "$state_file"
fi
admin_password=""

# Authentication is deliberately completed before tracing so the administrator
# password never enters trace actions. Network trace files are not retained,
# preventing session cookies and response headers from entering evidence.
rm -rf "$work_dir/.playwright-cli/traces" "$traces_dir/$label"
pw tracing-start >/dev/null
pw goto https://localhost/dashboard >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
case "$label" in
  fault-*) : ;;
  *)
  pw run-code "async (page)=>{await page.getByText('${expected_site_count} currently online',{exact:false}).waitFor({state:'visible',timeout:15000})}" >/dev/null
  ;;
esac
pw snapshot > "$artifact_dir/screenshots/$label-dashboard-snapshot.txt"
pw screenshot --filename "$screens_dir/$label-dashboard.png" --hires >/dev/null

if [ "$action" = final ]; then
  for page in sites events firewall; do
    pw run-code "async (page)=>{await page.goto('https://localhost/dashboard/$page');await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
    pw snapshot > "$artifact_dir/screenshots/$label-$page-snapshot.txt"
    pw screenshot --filename "$screens_dir/$label-$page.png" --hires >/dev/null
  done
  pw snapshot > "$artifact_dir/screenshots/$label-logout-snapshot.txt"
  logout_ref="$(sed -n 's/.*button "Log out" \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p' "$artifact_dir/screenshots/$label-logout-snapshot.txt" | head -1)"
  [ -n "$logout_ref" ] || { echo "Logout control was not found for $label" >&2; exit 1; }
  pw click "$logout_ref" >/dev/null
  pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
  pw snapshot > "$artifact_dir/screenshots/$label-logged-out-snapshot.txt"
  pw goto https://localhost/dashboard >/dev/null
  pw snapshot > "$artifact_dir/screenshots/$label-protected-route-snapshot.txt"
fi

pw console > "$artifact_dir/screenshots/$label-console.txt" 2>&1
pw tracing-stop > "$artifact_dir/screenshots/$label-trace-stop.txt"
mkdir -p "$traces_dir/$label"
if [ -d "$work_dir/.playwright-cli/traces" ]; then
  find "$work_dir/.playwright-cli/traces" -type f ! -name '*.network' | while IFS= read -r trace_file; do
    relative_trace="${trace_file#"$work_dir/.playwright-cli/traces/"}"
    mkdir -p "$traces_dir/$label/$(dirname "$relative_trace")"
    cp "$trace_file" "$traces_dir/$label/$relative_trace"
  done
fi
node "$root_dir/scripts/sanitize-playwright-evidence.mjs" "$traces_dir/$label" "$secret_dir" > "$artifact_dir/screenshots/$label-trace-sanitization.json"
node "$root_dir/scripts/validate-playwright-evidence.mjs" "$traces_dir/$label" > "$artifact_dir/screenshots/$label-trace-validation.json"

LABEL="$label" ACTION="$action" EXPECTED_SITES="$expected_site_count" SNAPSHOT="$artifact_dir/screenshots/$label-dashboard-snapshot.txt" CONSOLE_FILE="$artifact_dir/screenshots/$label-console.txt" SCREENS_DIR="$screens_dir" TRACES_DIR="$traces_dir" node - <<'NODE'
const fs = require("fs");
const path = require("path");
const label = process.env.LABEL;
const action = process.env.ACTION;
const expectedSites = Number(process.env.EXPECTED_SITES);
const snapshot = fs.readFileSync(process.env.SNAPSHOT, "utf8");
const consoleText = fs.readFileSync(process.env.CONSOLE_FILE, "utf8");
const sanitization = JSON.parse(fs.readFileSync(path.join(process.env.SCREENS_DIR, `${label}-trace-sanitization.json`), "utf8"));
const traceValidation = JSON.parse(fs.readFileSync(path.join(process.env.SCREENS_DIR, `${label}-trace-validation.json`), "utf8"));
const isApiFault = label === "fault-api";
const isServiceFault = label.startsWith("fault-") && !isApiFault;
const onlineRows = (snapshot.match(/generic \[ref=[^\]]+\]: ONLINE/g) ?? []).length;
const degradedRows = (snapshot.match(/generic \[ref=[^\]]+\]: DEGRADED/g) ?? []).length;
const offlineRows = (snapshot.match(/generic \[ref=[^\]]+\]: OFFLINE/g) ?? []).length;
const dashboardLoaded = snapshot.includes("Page Title: Dashboard | SmartHoneyAI") && snapshot.includes("Authenticated control plane") && snapshot.includes(`${expectedSites} connected ${expectedSites === 1 ? "site" : "sites"}`);
const dashboardLive = dashboardLoaded && (isServiceFault ? onlineRows + degradedRows === expectedSites && offlineRows === 0 : snapshot.includes(`${expectedSites} currently online`) && onlineRows === expectedSites && degradedRows === 0 && offlineRows === 0);
const expectedApiFault = snapshot.includes("HTTP status: 500") && snapshot.includes("Application error:");
const consoleMatch = /Errors:\s*(\d+)/.exec(consoleText);
const consoleCaptureValid = Boolean(consoleMatch);
const consoleErrors = consoleMatch ? Number(consoleMatch[1]) : null;
const pageChecks = {};
if (action === "final") {
  const load = (name) => fs.readFileSync(path.join(process.env.SCREENS_DIR, `${label}-${name}-snapshot.txt`), "utf8");
  const sites = load("sites");
  const events = load("events");
  const firewall = load("firewall");
  const loggedOut = fs.readFileSync(path.join(process.env.SCREENS_DIR, `${label}-logged-out-snapshot.txt`), "utf8");
  const protectedRoute = fs.readFileSync(path.join(process.env.SCREENS_DIR, `${label}-protected-route-snapshot.txt`), "utf8");
  const sitesOnline = (sites.match(/generic \[ref=[^\]]+\]: ONLINE/g) ?? []).length;
  const sitesObserve = (sites.match(/generic \[ref=[^\]]+\]: OBSERVE/g) ?? []).length;
  pageChecks.sites = sites.includes("Page Title: Sites | SmartHoneyAI") && sitesOnline === expectedSites && sitesObserve === expectedSites && !sites.includes(": DEGRADED") && !sites.includes(": OFFLINE") && !sites.includes(": ENFORCE");
  pageChecks.events = events.includes("Page Title: Live events | SmartHoneyAI") && (events.includes("HONEYPOT") || events.includes("PLUGIN_HEALTH"));
  pageChecks.firewall = firewall.includes('heading "Firewall policy"') && firewall.includes("No firewall rules are configured.");
  pageChecks.logout = loggedOut.includes("Page Title: Log in | SmartHoneyAI");
  pageChecks.protectedRedirect = protectedRoute.includes("Page URL: https://localhost/login?next=/dashboard") && protectedRoute.includes("Page Title: Log in | SmartHoneyAI");
}
const traceFiles = [];
const walk = (dir) => { for (const name of fs.readdirSync(dir)) { const item = path.join(dir, name); if (fs.statSync(item).isDirectory()) walk(item); else traceFiles.push(item); } };
const traceDir = path.join(process.env.TRACES_DIR, label);
if (fs.existsSync(traceDir)) walk(traceDir);
const png = path.join(process.env.SCREENS_DIR, `${label}-dashboard.png`);
const traceValidated = traceValidation.status === "PASS" && sanitization.status === "PASS";
const pass = consoleCaptureValid && (isApiFault ? expectedApiFault : dashboardLive && consoleErrors === 0) && Object.values(pageChecks).every(Boolean) && fs.statSync(png).size > 0 && traceValidated && traceFiles.some((item) => item.endsWith(".trace") && fs.statSync(item).size > 0) && !traceFiles.some((item) => item.endsWith(".network"));
const result = { label, action, status: pass ? "PASS" : "FAIL", dashboardLive, onlineRows, degradedRows, offlineRows, expectedApiFault, consoleCaptureValid, consoleErrors, consoleErrorsAllowed: isApiFault, pageChecks, screenshotBytes: fs.statSync(png).size, traceValidated, traceSanitization: sanitization, traceFiles: traceFiles.map((item) => path.relative(process.env.TRACES_DIR, item)), networkTraceRetained: traceFiles.some((item) => item.endsWith(".network")) };
fs.writeFileSync(path.join(process.env.SCREENS_DIR, `${label}-assertions.json`), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
if (!pass) { console.error(JSON.stringify(result)); process.exit(1); }
NODE

find "$screens_dir" "$traces_dir" -type f -exec chmod 600 {} \;
