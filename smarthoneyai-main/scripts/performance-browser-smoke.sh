#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
run_id="${PERF_RUN_ID:?Set PERF_RUN_ID}"
artifact_dir="${PERF_ARTIFACT_DIR:?Set PERF_ARTIFACT_DIR}"
secret_dir="${E2E_SECRET_DIR:?Set E2E_SECRET_DIR}"

case "$run_id" in *[!a-z0-9_-]*|'') printf 'Unsafe PERF_RUN_ID: %s\n' "$run_id" >&2; exit 2;; esac
node "$root_dir/scripts/synthetic-target-guard.mjs" https://localhost

work_dir="$root_dir/output/playwright/$run_id/browser-smoke"
screens_dir="$artifact_dir/screenshots"
trace_dir="$artifact_dir/traces/browser-smoke"
pwcli="${PWCLI:-/Users/nurmuhammadhashim/.codex/skills/playwright/scripts/playwright_cli.sh}"
state_file="$secret_dir/playwright-auth-state.json"
route="/browser-test-$run_id"
reason="Browser control verification $run_id"
expiry="$(node -e 'const d=new Date(Date.now()+3600000);process.stdout.write(d.toISOString().slice(0,16))')"

mkdir -p "$work_dir" "$screens_dir" "$trace_dir"
rm -rf "$work_dir/.playwright-cli/traces" "$trace_dir"
mkdir -p "$trace_dir"
export PLAYWRIGHT_CLI_SESSION="perf-$run_id-browser-smoke"

pw() {
  command="$1"
  shift
  (cd "$work_dir" && "$pwcli" "$command" "$@")
}

cleanup_browser() {
  pw close >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup_browser EXIT INT TERM

ref_for() {
  pattern="$1"
  file="$2"
  sed -n "s/.*$pattern \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p" "$file" | head -1
}

mode_ref() {
  mode="$1"
  file="$2"
  sed -n '/strong .*Performance WordPress/,$p' "$file" | sed -n "s/.*button \"$mode\" \[ref=\([a-zA-Z0-9][a-zA-Z0-9]*\)\].*/\1/p" | head -1
}

(cd "$work_dir" && "$pwcli" open https://localhost/ --config "$root_dir/performance/playwright-cli.json") >/dev/null
[ -s "$state_file" ] || { echo "Restricted browser authentication state is missing" >&2; exit 1; }
pw state-load "$state_file" >/dev/null
pw goto https://localhost/dashboard/firewall >/dev/null
pw snapshot > "$screens_dir/browser-smoke-firewall-start.txt"
rg -q 'Page Title: Dashboard \| SmartHoneyAI' "$screens_dir/browser-smoke-firewall-start.txt"
rg -q 'heading "Firewall policy"' "$screens_dir/browser-smoke-firewall-start.txt"
pw tracing-start >/dev/null

new_rule_ref="$(ref_for 'button "New rule"' "$screens_dir/browser-smoke-firewall-start.txt")"
[ -n "$new_rule_ref" ]
pw click "$new_rule_ref" >/dev/null
pw snapshot > "$screens_dir/browser-smoke-rule-form.txt"
value_ref="$(ref_for 'textbox "Value"' "$screens_dir/browser-smoke-rule-form.txt")"
priority_ref="$(ref_for 'spinbutton "Priority"' "$screens_dir/browser-smoke-rule-form.txt")"
expiry_ref="$(ref_for 'textbox "Expiry"' "$screens_dir/browser-smoke-rule-form.txt")"
reason_ref="$(ref_for 'textbox "Reason"' "$screens_dir/browser-smoke-rule-form.txt")"
create_ref="$(ref_for 'button "Create temporary rule"' "$screens_dir/browser-smoke-rule-form.txt")"
[ -n "$value_ref" ] && [ -n "$priority_ref" ] && [ -n "$expiry_ref" ] && [ -n "$reason_ref" ] && [ -n "$create_ref" ]
pw fill "$value_ref" "$route" >/dev/null
pw fill "$priority_ref" 7 >/dev/null
pw fill "$expiry_ref" "$expiry" >/dev/null
pw fill "$reason_ref" "$reason" >/dev/null
pw click "$create_ref" >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw snapshot > "$screens_dir/browser-smoke-rule-created.txt"
rg -Fq "$route" "$screens_dir/browser-smoke-rule-created.txt"

# Priority 7 puts this run-tagged rule before the performance rules, making the
# first matching toggle deterministic without bypassing the snapshot/ref flow.
disable_ref="$(ref_for 'button "Disable BLOCK_ROUTE"' "$screens_dir/browser-smoke-rule-created.txt")"
[ -n "$disable_ref" ]
pw click "$disable_ref" >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw snapshot > "$screens_dir/browser-smoke-rule-disabled.txt"
rg -Fq "$route" "$screens_dir/browser-smoke-rule-disabled.txt"
rg -q 'Disabled' "$screens_dir/browser-smoke-rule-disabled.txt"

observe_ref="$(mode_ref Observe "$screens_dir/browser-smoke-rule-disabled.txt")"
[ -n "$observe_ref" ]
pw click "$observe_ref" >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw goto https://localhost/dashboard/sites >/dev/null
pw snapshot > "$screens_dir/browser-smoke-observe.txt"
sed -n '/heading "Performance WordPress"/,$p' "$screens_dir/browser-smoke-observe.txt" | head -40 | rg -q 'OBSERVE'

pw goto https://localhost/dashboard/firewall >/dev/null
pw snapshot > "$screens_dir/browser-smoke-before-enforce.txt"
enforce_ref="$(mode_ref Enforce "$screens_dir/browser-smoke-before-enforce.txt")"
[ -n "$enforce_ref" ]
pw click "$enforce_ref" >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw snapshot > "$screens_dir/browser-smoke-observation-gate.txt"
rg -q 'complete its seven-day observation period' "$screens_dir/browser-smoke-observation-gate.txt"

# The rejection above is the real safety behavior. Only after proving it do we
# age this isolated local site, then use the UI again for temporary ENFORCE.
docker compose -p "${COMPOSE_PROJECT_NAME:-honeypot-ai-perf}" -f "$root_dir/docker-compose.yml" -f "$root_dir/docker-compose.wordpress-demo.yml" -f "$root_dir/docker-compose.performance.yml" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U honeypot -d honeypot_ai -c 'UPDATE "Site" SET "observeUntil"=NOW()-INTERVAL '\''1 minute'\'' WHERE domain='\''localhost'\'';' >/dev/null
pw goto https://localhost/dashboard/firewall >/dev/null
pw snapshot > "$screens_dir/browser-smoke-aged-enforce.txt"
enforce_ref="$(mode_ref Enforce "$screens_dir/browser-smoke-aged-enforce.txt")"
[ -n "$enforce_ref" ]
pw click "$enforce_ref" >/dev/null
pw run-code "async (page)=>{await page.waitForLoadState('networkidle')}" >/dev/null 2>&1 || true
pw goto https://localhost/dashboard/sites >/dev/null
pw snapshot > "$screens_dir/browser-smoke-enforce.txt"
sed -n '/heading "Performance WordPress"/,$p' "$screens_dir/browser-smoke-enforce.txt" | head -40 | rg -q 'ENFORCE'
pw screenshot --filename "$screens_dir/browser-smoke-controls.png" --hires >/dev/null
pw console > "$screens_dir/browser-smoke-console.txt"
rg -q 'Errors: 0' "$screens_dir/browser-smoke-console.txt"
pw tracing-stop > "$screens_dir/browser-smoke-trace-stop.txt"

if [ -d "$work_dir/.playwright-cli/traces" ]; then
  find "$work_dir/.playwright-cli/traces" -type f ! -name '*.network' | while IFS= read -r trace_file; do
    relative_trace="${trace_file#"$work_dir/.playwright-cli/traces/"}"
    mkdir -p "$trace_dir/$(dirname "$relative_trace")"
    cp "$trace_file" "$trace_dir/$relative_trace"
  done
fi
node "$root_dir/scripts/sanitize-playwright-evidence.mjs" "$trace_dir" "$secret_dir" > "$screens_dir/browser-smoke-trace-sanitization.json"
node "$root_dir/scripts/validate-playwright-evidence.mjs" "$trace_dir" > "$screens_dir/browser-smoke-trace-validation.json"
[ -z "$(find "$trace_dir" -type f -name '*.network' -print -quit)" ]
trace_count="$(find "$trace_dir" -type f -name '*.trace' | wc -l | tr -d ' ')"
[ "$trace_count" -ge 1 ]

ROUTE="$route" TRACE_COUNT="$trace_count" OUTPUT="$artifact_dir/browser-ui-smoke.json" SANITIZATION="$screens_dir/browser-smoke-trace-sanitization.json" VALIDATION="$screens_dir/browser-smoke-trace-validation.json" node - <<'NODE'
const fs=require("fs");
const sanitization=JSON.parse(fs.readFileSync(process.env.SANITIZATION,"utf8"));const validation=JSON.parse(fs.readFileSync(process.env.VALIDATION,"utf8"));
if(sanitization.status!=="PASS"||validation.status!=="PASS")throw new Error("Playwright action trace did not pass sanitization and structural validation");
const output={status:"PASS",runId:process.env.PERF_RUN_ID,route:process.env.ROUTE,checks:{authenticatedFirewall:true,ruleCreated:true,ruleDisabled:true,observeSelected:true,observationGateRejected:true,enforceRestoredAfterLocalAging:true,consoleErrorsZero:true,traceNetworkExcluded:true,traceSanitized:true,traceStructurallyValid:true},traceActionFiles:Number(process.env.TRACE_COUNT),completedAt:new Date().toISOString()};
fs.writeFileSync(process.env.OUTPUT,JSON.stringify(output,null,2)+"\n",{mode:0o600});
NODE
find "$screens_dir" "$trace_dir" -type f -exec chmod 600 {} \;
