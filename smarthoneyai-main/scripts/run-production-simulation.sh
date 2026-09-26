#!/bin/sh
set -eu

umask 077
root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
timestamp="${PERF_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
run_id="${PERF_RUN_ID:-perf-$(printf '%s' "$timestamp" | tr '[:upper:]' '[:lower:]')}"
artifact_dir="${PERF_ARTIFACT_DIR:-$root_dir/output/performance/$run_id}"
secret_dir="${E2E_SECRET_DIR:-$root_dir/secrets/perf/$run_id}"
agent_dir="${PERF_AGENT_DIR:-$secret_dir/agents}"
project="${COMPOSE_PROJECT_NAME:-honeypot-ai-perf}"
scale="${PERF_TIME_SCALE:-1}"
profile="${PERF_PROFILE:-full}"
phase_file="$artifact_dir/phase.json"
abort_file="$artifact_dir/abort.json"
fault_log="$artifact_dir/faults.jsonl"
original_services_file="$artifact_dir/original-e2e-services.txt"
overlay_files="$root_dir/docker-compose.wordpress-demo.yml:$root_dir/docker-compose.performance.yml"
playwright_tmp="$root_dir/output/playwright/$run_id"

case "$run_id" in *[!a-z0-9_-]*|'') printf 'Unsafe PERF_RUN_ID: %s\n' "$run_id" >&2; exit 2;; esac
ALLOW_REMOTE_SYNTHETIC_DATA=1 REMOTE_SYNTHETIC_HOSTS=wordpress,host.docker.internal \
  node "$root_dir/scripts/synthetic-target-guard.mjs" \
    https://localhost http://localhost:8080 http://wordpress https://host.docker.internal:8443
rm -rf "$playwright_tmp"

if [ -d "$artifact_dir" ] && [ -n "$(find "$artifact_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  printf 'Refusing non-empty performance evidence directory: %s\n' "$artifact_dir" >&2
  exit 2
fi
if docker ps -aq --filter "label=com.docker.compose.project=$project" | grep -q . || \
   docker network ls -q --filter "label=com.docker.compose.project=$project" | grep -q . || \
   docker volume ls -q --filter "label=com.docker.compose.project=$project" | grep -q .; then
  printf 'Refusing pre-existing resources for isolated project %s. Remove the stale project explicitly before a new run.\n' "$project" >&2
  exit 2
fi

mkdir -p "$artifact_dir/k6" "$artifact_dir/logs" "$artifact_dir/screenshots" "$artifact_dir/snapshots" "$artifact_dir/traces" "$artifact_dir/versions" "$agent_dir" "$root_dir/output/pdf" "$root_dir/tmp/pdfs/$run_id"
chmod 700 "$artifact_dir" "$artifact_dir/k6" "$artifact_dir/logs" "$artifact_dir/screenshots" "$artifact_dir/snapshots" "$artifact_dir/traces" "$artifact_dir/versions" "$secret_dir" "$agent_dir" "$root_dir/tmp/pdfs/$run_id"

export PERF_RUN_ID="$run_id"
export PERF_TIME_SCALE="$scale"
export PERF_ARTIFACT_DIR="$artifact_dir"
export PERF_AGENT_DIR="$agent_dir"
export PERF_AGENT_STATE_PATH="$agent_dir/runtime-state.json"
export PERF_AGENT_CYCLE_LOG="$artifact_dir/agent-cycles.jsonl"
export PERF_PHASE_FILE="$phase_file"
export PERF_ABORT_FILE="$abort_file"
export PERF_CONTROL_STATE="$secret_dir/performance-control.json"
export PERF_UID="$(id -u)"
export PERF_GID="$(id -g)"
export E2E_SECRET_DIR="$secret_dir"
export COMPOSE_PROJECT_NAME="$project"
export COMPOSE_OVERLAY_FILES="$overlay_files"
export BASE_URL=https://localhost
export APP_ORIGIN=https://localhost
export WORDPRESS_URL=http://localhost:8080
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@smarthoneyai.local}"
export PLATFORM_ADMIN_EMAIL="$ADMIN_EMAIL"
export PLATFORM_ORGANIZATION_NAME="${PLATFORM_ORGANIZATION_NAME:-SmartHoneyAI Local Acceptance}"
export PLATFORM_ORGANIZATION_SLUG="${PLATFORM_ORGANIZATION_SLUG:-smarthoneyai-local-acceptance}"
export HF_MODEL_REVISION="${HF_MODEL_REVISION:-0000000000000000000000000000000000000000}"
export SMTP_HOST="${SMTP_HOST:-smtp.local.invalid}"
export SMTP_USER="${SMTP_USER:-local-demo}"
export SMTP_FROM="${SMTP_FROM:-SmartHoneyAI <security@localhost.invalid>}"
export NODE_EXTRA_CA_CERTS="$secret_dir/tls/fullchain.pem"

compose() {
  docker compose -p "$project" -f "$root_dir/docker-compose.yml" -f "$root_dir/docker-compose.wordpress-demo.yml" -f "$root_dir/docker-compose.performance.yml" "$@"
}

e2e_compose() {
  E2E_SECRET_DIR="$root_dir/secrets/e2e" APP_URL=https://localhost PLATFORM_ADMIN_EMAIL=admin@smarthoneyai.local HF_MODEL_REVISION="$HF_MODEL_REVISION" \
    docker compose -p honeypot-ai-e2e -f "$root_dir/docker-compose.yml" -f "$root_dir/docker-compose.wordpress-demo.yml" "$@"
}

scaled() {
  node -e 'const value=Math.max(1,Math.round(Number(process.argv[1])*Number(process.argv[2])));process.stdout.write(String(value))' "$1" "$scale"
}

set_phase() {
  phase="$1"
  fault="${2:-}"
  PHASE_NAME="$phase" PHASE_FAULT="$fault" PHASE_FILE="$phase_file" node -e '
    const fs=require("fs");
    fs.writeFileSync(process.env.PHASE_FILE,JSON.stringify({phase:process.env.PHASE_NAME,scheduledFault:process.env.PHASE_FAULT||null,at:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  printf '%s %-18s %s\n' "$(date -u +%FT%TZ)" "$phase" "${fault:+fault=$fault}"
}

record_fault() {
  action="$1"
  service="$2"
  FAULT_ACTION="$action" FAULT_SERVICE="$service" FAULT_LOG="$fault_log" node -e '
    const fs=require("fs");
    fs.appendFileSync(process.env.FAULT_LOG,JSON.stringify({faultId:`${process.env.PERF_RUN_ID}-${process.env.FAULT_SERVICE}`,at:new Date().toISOString(),action:process.env.FAULT_ACTION,service:process.env.FAULT_SERVICE,expectedOutageSeconds:Math.max(1,Math.round(120*Number(process.env.PERF_TIME_SCALE||1)))})+"\n",{mode:0o600});
  '
}

record_wordpress_probe() {
  service="$1"
  moment="$2"
  probe_file="$artifact_dir/fault-probe-$service-$moment.json"
  status_code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://localhost:8080/ 2>/dev/null || printf '000')"
  PROBE_SERVICE="$service" PROBE_MOMENT="$moment" PROBE_STATUS="$status_code" PROBE_FILE="$probe_file" node -e '
    const fs=require("fs");const status=Number(process.env.PROBE_STATUS);fs.writeFileSync(process.env.PROBE_FILE,JSON.stringify({service:process.env.PROBE_SERVICE,moment:process.env.PROBE_MOMENT,status:Number.isFinite(status)?status:0,at:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
}

write_abort() {
  reason="$1"
  details="${2:-}"
  [ ! -f "$abort_file" ] || return 0
  ABORT_REASON="$reason" ABORT_DETAILS="$details" ABORT_FILE="$abort_file" node -e '
    const fs=require("fs");
    fs.writeFileSync(process.env.ABORT_FILE,JSON.stringify({at:new Date().toISOString(),reason:process.env.ABORT_REASON,details:process.env.ABORT_DETAILS},null,2)+"\n",{mode:0o600});
  '
}

wait_seconds() {
  remaining="$1"
  while [ "$remaining" -gt 0 ]; do
    [ ! -f "$abort_file" ] || return 1
    if [ -n "$observer_pid" ] && ! kill -0 "$observer_pid" >/dev/null 2>&1; then
      write_abort OBSERVER_EXIT "telemetry observer stopped unexpectedly"
      return 1
    fi
    if [ -n "$agent_pid" ] && ! kill -0 "$agent_pid" >/dev/null 2>&1; then
      write_abort AGENT_RUNTIME_EXIT "synthetic agent runtime stopped unexpectedly"
      return 1
    fi
    if [ "$k6_background_active" -eq 1 ] && ! kill -0 "$k6_pid" >/dev/null 2>&1; then
      wait "$k6_pid" || k6_status=$?
      write_abort K6_BACKGROUND_EXIT "soak k6 exited before the scheduled end with status ${k6_status:-0}"
      return 1
    fi
    step=5
    [ "$remaining" -ge 5 ] || step="$remaining"
    sleep "$step"
    remaining=$((remaining - step))
  done
}

capture() {
  label="$1"
  action="${2:-capture}"
  sh "$root_dir/scripts/capture-performance-dashboard.sh" "$label" "$action" > "$artifact_dir/logs/playwright-$label.log" 2>&1
}

run_k6() {
  phase="$1"
  rate="$2"
  duration="$3"
  set_phase "$phase"
  compose --profile perf run --rm --no-deps \
    -e "PERF_PHASE=$phase" -e "PERF_RATE=$rate" -e "PERF_DURATION=${duration}s" \
    k6 run --out "json=/evidence/k6/$phase.jsonl" /scripts/production-simulation.js \
    > "$artifact_dir/logs/k6-$phase.log" 2>&1 &
  phase_k6_pid=$!
  while kill -0 "$phase_k6_pid" >/dev/null 2>&1; do
    if [ -f "$abort_file" ]; then
      kill "$phase_k6_pid" >/dev/null 2>&1 || true
      docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=k6' | xargs -r docker stop -t 5 >/dev/null 2>&1 || true
      wait "$phase_k6_pid" >/dev/null 2>&1 || true
      return 1
    fi
    if [ -n "$observer_pid" ] && ! kill -0 "$observer_pid" >/dev/null 2>&1; then
      write_abort OBSERVER_EXIT "telemetry observer stopped unexpectedly during $phase"
    fi
    if [ -n "$agent_pid" ] && ! kill -0 "$agent_pid" >/dev/null 2>&1; then
      write_abort AGENT_RUNTIME_EXIT "synthetic agent runtime stopped unexpectedly during $phase"
    fi
    sleep 2
  done
  if wait "$phase_k6_pid"; then
    :
  else
    phase_status=$?
    write_abort K6_PHASE_FAILED "$phase exited non-zero with status $phase_status"
    return 1
  fi
  [ ! -f "$abort_file" ]
}

run_k6_background() {
  phase="$1"
  rate="$2"
  duration="$3"
  set_phase "$phase"
  compose --profile perf run --rm --no-deps \
    -e "PERF_PHASE=$phase" -e "PERF_RATE=$rate" -e "PERF_DURATION=${duration}s" \
    k6 run --out "json=/evidence/k6/$phase.jsonl" /scripts/production-simulation.js \
    > "$artifact_dir/logs/k6-$phase.log" 2>&1 &
  k6_pid=$!
}

wait_ready() {
  service="$1"
  deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ ! -f "$abort_file" ] || return 1
    case "$service" in
      worker) compose exec -T worker wget -q -O - http://127.0.0.1:4001/health/ready >/dev/null 2>&1 && return 0 ;;
      redis) compose ps --format json redis | grep -q '"Health":"healthy"' && curl --cacert "$secret_dir/tls/fullchain.pem" -fsS --max-time 3 https://localhost/health/ready >/dev/null 2>&1 && compose exec -T worker wget -q -O /dev/null http://127.0.0.1:4001/health/ready >/dev/null 2>&1 && return 0 ;;
      wordpress-db)
        if compose ps --format json wordpress-db | grep -q '"Health":"healthy"' && curl -fsS --max-time 3 http://localhost:8080/ >/dev/null 2>&1 && compose exec -T wordpress-db sh -lc '
          password="$(cat /run/secrets/wordpress_db_password)"
          mariadb-check --silent -uwordpress -p"$password" wordpress >/dev/null
          test "$(mariadb -N -uwordpress -p"$password" wordpress -e "SELECT IF(s.row_count=a.actual_rows AND s.payload_bytes=a.actual_bytes AND s.row_count>=0 AND s.payload_bytes>=0 AND s.dropped_events>=0,1,0) FROM wp_honeypot_ai_queue_state s CROSS JOIN (SELECT COUNT(*) actual_rows,COALESCE(SUM(payload_bytes),0) actual_bytes FROM wp_honeypot_ai_events) a WHERE s.singleton_id=1")" = 1
        ' >/dev/null 2>&1; then return 0; fi
        ;;
      *) curl --cacert "$secret_dir/tls/fullchain.pem" -fsS --max-time 3 https://localhost/health/ready >/dev/null 2>&1 && return 0 ;;
    esac
    sleep 2
  done
  return 1
}

wait_analysis_drained() {
  output="$artifact_dir/final-analysis-queue.json"
  deadline=$(( $(date +%s) + 300 ))
  consecutive=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    queue_state="$(compose exec -T worker wget -q -O - http://127.0.0.1:4001/health/queue 2>/dev/null || true)"
    if QUEUE_STATE="$queue_state" node -e 'try{const value=JSON.parse(process.env.QUEUE_STATE);process.exit(value.drained===true?0:1)}catch{process.exit(1)}'; then
      consecutive=$((consecutive + 1))
      if [ "$consecutive" -ge 3 ]; then
        printf '%s\n' "$queue_state" > "$output"
        chmod 600 "$output"
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 2
  done
  printf '%s\n' "${queue_state:-{\"status\":\"unavailable\",\"drained\":false}}" > "$output"
  chmod 600 "$output"
  return 1
}

stop_fault() {
  service="$1"
  set_phase soak-chaos "$service"
  record_fault stop "$service"
  compose stop -t 30 "$service" >> "$artifact_dir/logs/fault-$service.log" 2>&1
  record_fault outage_started "$service"
  record_wordpress_probe "$service" outage
  capture "fault-$service"
}

start_fault() {
  service="$1"
  record_fault start "$service"
  compose start "$service" >> "$artifact_dir/logs/fault-$service.log" 2>&1
  if wait_ready "$service"; then
    record_fault recovered "$service"
    record_wordpress_probe "$service" recovered
    capture "recovered-$service"
  else
    record_fault recovery_timeout "$service"
    write_abort FAULT_RECOVERY_TIMEOUT "$service did not recover within the allowed window"
    return 1
  fi
  set_phase soak-chaos
}

wait_until_offset() {
  started="$1"
  base_offset="$2"
  target=$((started + $(scaled "$base_offset")))
  now="$(date +%s)"
  [ "$now" -ge "$target" ] || wait_seconds $((target - now))
}

wait_for_background_k6() {
  while kill -0 "$k6_pid" >/dev/null 2>&1; do
    [ ! -f "$abort_file" ] || return 1
    if [ -n "$observer_pid" ] && ! kill -0 "$observer_pid" >/dev/null 2>&1; then
      write_abort OBSERVER_EXIT "telemetry observer stopped unexpectedly during soak"
      return 1
    fi
    if [ -n "$agent_pid" ] && ! kill -0 "$agent_pid" >/dev/null 2>&1; then
      write_abort AGENT_RUNTIME_EXIT "synthetic agent runtime stopped unexpectedly during soak"
      return 1
    fi
    sleep 2
  done
  if wait "$k6_pid"; then return 0; fi
  write_abort K6_SOAK_FAILED "soak k6 exited non-zero"
  return 1
}

snapshot() {
  label="$1"
  node "$root_dir/scripts/performance-control.mjs" snapshot > "$artifact_dir/snapshots/$label.json" 2> "$artifact_dir/logs/snapshot-$label.log"
  chmod 600 "$artifact_dir/snapshots/$label.json"
}

agent_pid=""
observer_pid=""
k6_pid=""
k6_background_active=0
caffeinate_pid=""
cleanup_complete=0
original_stopped=0
original_restored=0
teardown_complete=0

run_gate() {
  name="$1"
  shift
  if "$@" > "$artifact_dir/logs/gate-$name.log" 2>&1; then
    status=PASS
  else
    status=FAIL
    printf '%s\t%s\n' "$name" "$status" >> "$artifact_dir/quality-gates.tsv"
    return 1
  fi
  printf '%s\t%s\n' "$name" "$status" >> "$artifact_dir/quality-gates.tsv"
}

package_reproducibility() {
  first="$artifact_dir/honeypot-ai-0.1.0-a.zip"
  second="$artifact_dir/honeypot-ai-0.1.0-b.zip"
  SOURCE_DATE_TIMESTAMP=202401010000.00 sh "$root_dir/scripts/package-wordpress-plugin.sh" "$first" >/dev/null
  SOURCE_DATE_TIMESTAMP=202401010000.00 sh "$root_dir/scripts/package-wordpress-plugin.sh" "$second" >/dev/null
  cmp -s "$first" "$second"
  shasum -a 256 "$first" "$second"
}

record_image_inventory() {
  docker image inspect grafana/k6:2.0.0 wordpress:7.0.0-php8.3-apache wordpress:cli-2.12.0-php8.3 mariadb:11.4.12 > "$artifact_dir/versions/image-inventory.json"
  node - "$artifact_dir/versions/image-inventory.json" <<'NODE'
const fs=require("fs");
const images=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const required=["grafana/k6:2.0.0","wordpress:7.0.0-php8.3-apache","wordpress:cli-2.12.0-php8.3","mariadb:11.4.12"];
const inventory=images.map((item)=>({id:item.Id,repoTags:item.RepoTags??[],repoDigests:item.RepoDigests??[],created:item.Created,architecture:item.Architecture,os:item.Os}));
for(const reference of required){const found=inventory.find((item)=>item.repoTags.includes(reference));if(!found||found.repoDigests.length===0)throw new Error(`Missing resolved digest for ${reference}`);}
fs.writeFileSync(process.argv[2],JSON.stringify({status:"PASS",required,images:inventory},null,2)+"\n",{mode:0o600});
NODE
}

verify_runtime_exposure() {
  PROJECT="$project" OUTPUT="$artifact_dir/exposure-scan.json" node - <<'NODE'
const {execFileSync}=require("child_process");const fs=require("fs");
const project=process.env.PROJECT;
const ids=execFileSync("docker",["ps","-q","--filter",`label=com.docker.compose.project=${project}`],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
const inspected=ids.length?JSON.parse(execFileSync("docker",["inspect",...ids],{encoding:"utf8"})):[];
const bindings=[];
for(const item of inspected){const service=item.Config.Labels?.["com.docker.compose.service"]??item.Name.replace(/^\//,"");for(const [containerPort,values] of Object.entries(item.NetworkSettings.Ports??{})){for(const binding of values??[])bindings.push({service,containerPort,hostIp:binding.HostIp,hostPort:binding.HostPort});}}
const expected=[
  {service:"nginx",containerPort:"8080/tcp",hostIp:"127.0.0.1",hostPort:"80"},
  {service:"nginx",containerPort:"8443/tcp",hostIp:"127.0.0.1",hostPort:"443"},
  {service:"wordpress",containerPort:"80/tcp",hostIp:"127.0.0.1",hostPort:"8080"}
];
const key=(value)=>`${value.service}|${value.containerPort}|${value.hostIp}|${value.hostPort}`;
const actualKeys=bindings.map(key).sort();const expectedKeys=expected.map(key).sort();
const pass=JSON.stringify(actualKeys)===JSON.stringify(expectedKeys);
const output={status:pass?"PASS":"FAIL",loopbackOnly:bindings.every((item)=>item.hostIp==="127.0.0.1"),bindings,expected,checkedAt:new Date().toISOString()};
fs.writeFileSync(process.env.OUTPUT,JSON.stringify(output,null,2)+"\n",{mode:0o600});if(!pass)process.exit(1);
NODE
}

restore_original() {
  if [ "$original_stopped" -eq 1 ] && [ -s "$original_services_file" ]; then
    services="$(tr '\n' ' ' < "$original_services_file")"
    if [ -n "$services" ]; then
      e2e_compose start $services > "$artifact_dir/logs/original-e2e-restore.log" 2>&1 || true
      deadline=$(( $(date +%s) + 180 ))
      wordpress_recreated=0
      while [ "$(date +%s)" -lt "$deadline" ]; do
        if curl --cacert "$root_dir/secrets/e2e/tls/fullchain.pem" -fsS --max-time 3 https://localhost/health/ready >/dev/null 2>&1 && curl -fsS --max-time 3 http://localhost:8080/ >/dev/null 2>&1; then
          original_restored=1
          break
        fi
        if [ "$wordpress_recreated" -eq 0 ] && curl --cacert "$root_dir/secrets/e2e/tls/fullchain.pem" -fsS --max-time 3 https://localhost/health/ready >/dev/null 2>&1 && ! curl -fsS --max-time 3 http://localhost:8080/ >/dev/null 2>&1; then
          e2e_compose up -d --no-deps --force-recreate wordpress >> "$artifact_dir/logs/original-e2e-restore.log" 2>&1 || true
          wordpress_recreated=1
        fi
        sleep 3
      done
    fi
  elif curl --cacert "$root_dir/secrets/e2e/tls/fullchain.pem" -fsS --max-time 3 https://localhost/health/ready >/dev/null 2>&1 && curl -fsS --max-time 3 http://localhost:8080/ >/dev/null 2>&1; then
    original_restored=1
  fi
  original_stopped=0
  original_wordpress=""
  original_platform=""
  if [ "$original_restored" -eq 1 ]; then
    # The first successful post-outage heartbeat resolves the stored transport
    # error after reporting it once. Run a second deterministic cycle so the
    # restored demo is verified in its healthy steady state.
    original_wordpress="$(e2e_compose exec -T wordpress-cron wp eval-file /demo/sync-wordpress.php --path=/var/www/html 2>/dev/null || true)"
    original_wordpress="$(e2e_compose exec -T wordpress-cron wp eval-file /demo/sync-wordpress.php --path=/var/www/html 2>/dev/null || true)"
    original_platform="$(e2e_compose exec -T postgres psql -tA -F '|' -U honeypot -d honeypot_ai -c "SELECT s.status,s.\"enforcementMode\",(SELECT COUNT(*) FROM \"FirewallRule\" r WHERE r.\"organizationId\"=s.\"organizationId\" AND r.enabled=true AND (r.\"expiresAt\" IS NULL OR r.\"expiresAt\">NOW())) FROM \"Site\" s WHERE s.domain='localhost' ORDER BY s.\"createdAt\" DESC LIMIT 1;" 2>/dev/null || true)"
  fi
  if ! ORIGINAL_READY="$original_restored" ORIGINAL_WORDPRESS="$original_wordpress" ORIGINAL_PLATFORM="$original_platform" ORIGINAL_FILE="$artifact_dir/original-demo-verification.json" node - <<'NODE'
const fs=require("fs");
let wordpress=null;
try{wordpress=JSON.parse(process.env.ORIGINAL_WORDPRESS||"");}catch{}
const [storedStatus,enforcementMode,activeRulesRaw]=String(process.env.ORIGINAL_PLATFORM||"").trim().split("|");
const activeRules=Number(activeRulesRaw);
const ready=process.env.ORIGINAL_READY==="1";
const ok=ready&&wordpress?.enrolled===true&&wordpress?.connectionStatus==="ONLINE"&&wordpress?.queueDepth===0&&wordpress?.queueBytes===0&&wordpress?.droppedEvents===0&&wordpress?.effectiveMode==="OBSERVE"&&storedStatus==="ONLINE"&&enforcementMode==="OBSERVE"&&activeRules===0;
fs.writeFileSync(process.env.ORIGINAL_FILE,JSON.stringify({status:ok?"PASS":"FAIL",ready,checkedAt:new Date().toISOString(),platformUrl:"https://localhost",wordpressUrl:"http://localhost:8080",wordpress,platform:{storedStatus:storedStatus||null,enforcementMode:enforcementMode||null,activeRules:Number.isFinite(activeRules)?activeRules:null}},null,2)+"\n",{mode:0o600});
if(!ok)process.exit(1);
NODE
  then original_restored=0; fi
}

finalize() {
  status=$?
  trap - EXIT INT TERM HUP
  [ -z "$k6_pid" ] || kill "$k6_pid" >/dev/null 2>&1 || true
  docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=k6' | xargs -r docker stop -t 10 >/dev/null 2>&1 || true
  [ -z "$agent_pid" ] || { kill -TERM "$agent_pid" >/dev/null 2>&1 || true; wait "$agent_pid" >/dev/null 2>&1 || true; }
  [ -z "$observer_pid" ] || { kill -TERM "$observer_pid" >/dev/null 2>&1 || true; wait "$observer_pid" >/dev/null 2>&1 || true; }
  if compose ps -aq api 2>/dev/null | grep -q .; then
    compose start postgres wordpress-db redis api worker wordpress wordpress-cron web nginx >> "$artifact_dir/logs/finalizer-service-recovery.log" 2>&1 || status=1
    wait_ready api >> "$artifact_dir/logs/finalizer-service-recovery.log" 2>&1 || status=1
    wait_ready worker >> "$artifact_dir/logs/finalizer-service-recovery.log" 2>&1 || status=1
    wait_ready wordpress-db >> "$artifact_dir/logs/finalizer-service-recovery.log" 2>&1 || status=1
    cleanup_tmp="$artifact_dir/snapshots/final-cleanup.tmp.json"
    PERF_CONTROL_FINAL=1 node "$root_dir/scripts/performance-control.mjs" cleanup > "$cleanup_tmp" 2> "$artifact_dir/logs/finalizer-cleanup.log" || status=1
    if [ -s "$cleanup_tmp" ]; then mv "$cleanup_tmp" "$artifact_dir/snapshots/final-cleanup.json"; else status=1; fi
    wait_analysis_drained >> "$artifact_dir/logs/finalizer-analysis-drain.log" 2>&1 || status=1
    node "$root_dir/scripts/revoke-playwright-session.mjs" "$secret_dir/playwright-auth-state.json" > "$artifact_dir/browser-session-revocation.json" 2> "$artifact_dir/logs/browser-session-revocation.log" || status=1
    compose ps --format json > "$artifact_dir/compose-ps-final.json" 2>/dev/null || true
    compose images --format json > "$artifact_dir/images.json" 2>/dev/null || true
    compose logs --no-color --timestamps > "$artifact_dir/logs/compose.log" 2>&1 || true
  fi
  if [ "${PERF_KEEP_STACK:-0}" != 1 ]; then compose --profile perf --profile perf-seed --profile perf-test down --volumes --remove-orphans > "$artifact_dir/logs/perf-teardown.log" 2>&1 || status=1; fi
  rm -f "$secret_dir/playwright-auth-state.json"
  rm -rf "$playwright_tmp"
  if [ ! -e "$playwright_tmp" ]; then playwright_tmp_removed=1; else playwright_tmp_removed=0; status=1; fi
  PLAYWRIGHT_TMP_REMOVED="$playwright_tmp_removed" PLAYWRIGHT_TMP_FILE="$artifact_dir/playwright-temp-verification.json" node -e '
    const fs=require("fs");fs.writeFileSync(process.env.PLAYWRIGHT_TMP_FILE,JSON.stringify({status:process.env.PLAYWRIGHT_TMP_REMOVED==="1"?"PASS":"FAIL",removed:process.env.PLAYWRIGHT_TMP_REMOVED==="1",networkTracesRemaining:0,checkedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  remaining_containers="$(docker ps -aq --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
  remaining_networks="$(docker network ls -q --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
  remaining_volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
  if [ "$remaining_containers" -eq 0 ] && [ "$remaining_networks" -eq 0 ] && [ "$remaining_volumes" -eq 0 ]; then teardown_complete=1; else status=1; fi
  TEARDOWN_COMPLETE="$teardown_complete" TEARDOWN_CONTAINERS="$remaining_containers" TEARDOWN_NETWORKS="$remaining_networks" TEARDOWN_VOLUMES="$remaining_volumes" TEARDOWN_FILE="$artifact_dir/teardown-verification.json" node -e '
    const fs=require("fs");fs.writeFileSync(process.env.TEARDOWN_FILE,JSON.stringify({complete:process.env.TEARDOWN_COMPLETE==="1",remainingContainers:Number(process.env.TEARDOWN_CONTAINERS),remainingNetworks:Number(process.env.TEARDOWN_NETWORKS),remainingVolumes:Number(process.env.TEARDOWN_VOLUMES),checkedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  restore_original
  [ "$original_restored" -eq 1 ] || status=1
  node "$root_dir/scripts/finalize-performance-evidence.mjs" integrity > "$artifact_dir/logs/run-integrity.log" 2>&1 || status=1
  PERF_EVIDENCE_SCAN_STAGE=pre-report PERF_EVIDENCE_SCAN_OUTPUT="$artifact_dir/evidence-redaction-pre.json" node "$root_dir/scripts/scan-performance-evidence.mjs" > "$artifact_dir/logs/evidence-redaction-pre.log" 2>&1 || status=1
  find "$artifact_dir" -type f -exec chmod 600 {} \; 2>/dev/null || true
  find "$artifact_dir" -type d -exec chmod 700 {} \; 2>/dev/null || true
  report_log="$root_dir/tmp/pdfs/$run_id/report-generation.log"
  FINALIZATION_STATUS=PENDING FINALIZATION_DRAFT_REDACTION=false FINALIZATION_DRAFT_MANIFEST=false FINALIZATION_REASON="Awaiting two-pass PDF redaction and manifest verification" FINALIZATION_FILE="$artifact_dir/finalization-status.json" node -e '
    const fs=require("fs");fs.writeFileSync(process.env.FINALIZATION_FILE,JSON.stringify({status:process.env.FINALIZATION_STATUS,draftRedactionVerified:process.env.FINALIZATION_DRAFT_REDACTION==="true",draftManifestVerified:process.env.FINALIZATION_DRAFT_MANIFEST==="true",reason:process.env.FINALIZATION_REASON,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  if [ -f "$root_dir/scripts/generate-performance-report.py" ]; then
    python3 "$root_dir/scripts/generate-performance-report.py" "$artifact_dir" > "$report_log" 2>&1 || status=1
  fi
  manifest_check="$root_dir/tmp/pdfs/$run_id/manifest-check.txt"
  if PERF_EVIDENCE_SCAN_STAGE=draft-report PERF_EVIDENCE_SCAN_OUTPUT="$artifact_dir/evidence-redaction-draft.json" node "$root_dir/scripts/scan-performance-evidence.mjs" > "$artifact_dir/logs/evidence-redaction-draft.log" 2>&1; then draft_redaction=1; else draft_redaction=0; status=1; fi
  if node "$root_dir/scripts/finalize-performance-evidence.mjs" manifest >/dev/null 2>&1 && (cd "$artifact_dir" && shasum -a 256 -c manifest.sha256) > "$manifest_check" 2>&1; then draft_manifest=1; else draft_manifest=0; status=1; fi
  if [ "$draft_redaction" -eq 1 ] && [ "$draft_manifest" -eq 1 ]; then finalization_state=PASS; finalization_reason="Draft PDF and evidence passed recursive redaction and SHA-256 manifest verification"; else finalization_state=FAIL; finalization_reason="Draft verification failed: redaction=$draft_redaction manifest=$draft_manifest"; fi
  FINALIZATION_STATUS="$finalization_state" FINALIZATION_DRAFT_REDACTION="$([ "$draft_redaction" -eq 1 ] && echo true || echo false)" FINALIZATION_DRAFT_MANIFEST="$([ "$draft_manifest" -eq 1 ] && echo true || echo false)" FINALIZATION_REASON="$finalization_reason" FINALIZATION_FILE="$artifact_dir/finalization-status.json" node -e '
    const fs=require("fs");fs.writeFileSync(process.env.FINALIZATION_FILE,JSON.stringify({status:process.env.FINALIZATION_STATUS,draftRedactionVerified:process.env.FINALIZATION_DRAFT_REDACTION==="true",draftManifestVerified:process.env.FINALIZATION_DRAFT_MANIFEST==="true",reason:process.env.FINALIZATION_REASON,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  if [ -f "$root_dir/scripts/generate-performance-report.py" ]; then
    python3 "$root_dir/scripts/generate-performance-report.py" "$artifact_dir" > "$report_log" 2>&1 || status=1
  fi
  mv "$report_log" "$artifact_dir/logs/report-generation.log" 2>/dev/null || true
  if PERF_EVIDENCE_SCAN_STAGE=post-report PERF_EVIDENCE_SCAN_OUTPUT="$artifact_dir/evidence-redaction-post.json" node "$root_dir/scripts/scan-performance-evidence.mjs" > "$artifact_dir/logs/evidence-redaction-post.log" 2>&1; then final_redaction=1; else final_redaction=0; status=1; fi
  if node "$root_dir/scripts/finalize-performance-evidence.mjs" manifest >/dev/null 2>&1 && (cd "$artifact_dir" && shasum -a 256 -c manifest.sha256) > "$manifest_check" 2>&1; then manifest_verified=1; else manifest_verified=0; status=1; fi
  if [ "$final_redaction" -ne 1 ] || [ "$manifest_verified" -ne 1 ]; then
    FINALIZATION_STATUS=FAIL FINALIZATION_DRAFT_REDACTION="$([ "$draft_redaction" -eq 1 ] && echo true || echo false)" FINALIZATION_DRAFT_MANIFEST="$([ "$draft_manifest" -eq 1 ] && echo true || echo false)" FINALIZATION_REASON="Final artifact verification failed: redaction=$final_redaction manifest=$manifest_verified" FINALIZATION_FILE="$artifact_dir/finalization-status.json" node -e '
      const fs=require("fs");fs.writeFileSync(process.env.FINALIZATION_FILE,JSON.stringify({status:process.env.FINALIZATION_STATUS,draftRedactionVerified:process.env.FINALIZATION_DRAFT_REDACTION==="true",draftManifestVerified:process.env.FINALIZATION_DRAFT_MANIFEST==="true",reason:process.env.FINALIZATION_REASON,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
    '
    python3 "$root_dir/scripts/generate-performance-report.py" "$artifact_dir" > "$report_log" 2>&1 || true
    mv "$report_log" "$artifact_dir/logs/report-generation.log" 2>/dev/null || true
    PERF_EVIDENCE_SCAN_STAGE=post-report-failure PERF_EVIDENCE_SCAN_OUTPUT="$artifact_dir/evidence-redaction-post.json" node "$root_dir/scripts/scan-performance-evidence.mjs" > "$artifact_dir/logs/evidence-redaction-post.log" 2>&1 || true
    node "$root_dir/scripts/finalize-performance-evidence.mjs" manifest >/dev/null 2>&1 || true
    if (cd "$artifact_dir" && shasum -a 256 -c manifest.sha256) > "$manifest_check" 2>&1; then manifest_verified=1; else manifest_verified=0; fi
  fi
  if [ "$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).verdict)}catch{process.stdout.write("FAIL")}' "$artifact_dir/result.json")" != PASS ]; then status=1; fi
  MANIFEST_VERIFIED="$manifest_verified" MANIFEST_COUNT="$(wc -l < "$artifact_dir/manifest.sha256" | tr -d ' ')" MANIFEST_FILE="$artifact_dir/manifest-verification.json" node -e '
    const fs=require("fs");fs.writeFileSync(process.env.MANIFEST_FILE,JSON.stringify({status:process.env.MANIFEST_VERIFIED==="1"?"PASS":"FAIL",verified:process.env.MANIFEST_VERIFIED==="1",entries:Number(process.env.MANIFEST_COUNT),checkedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600});
  '
  rm -f "$manifest_check"
  [ -z "$caffeinate_pid" ] || kill "$caffeinate_pid" >/dev/null 2>&1 || true
  cleanup_complete=1
  printf 'Performance evidence: %s\n' "$artifact_dir"
  [ "$status" -eq 0 ] || exit "$status"
}
trap finalize EXIT
trap 'trap - INT; exit 130' INT
trap 'trap - TERM; exit 143' TERM
trap 'trap - HUP; exit 129' HUP

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -ims -w $$ >/dev/null 2>&1 &
  caffeinate_pid=$!
fi

printf '%s\n' "$run_id" > "$artifact_dir/run-id.txt"
printf '%s\n' "$profile" > "$artifact_dir/profile.txt"
printf '%s\n' "$scale" > "$artifact_dir/time-scale.txt"
node "$root_dir/scripts/collect-reproducibility.mjs" "$artifact_dir/versions/reproducibility.json"
e2e_compose ps --status running --services > "$original_services_file" 2>/dev/null || true
if [ -s "$original_services_file" ]; then
  e2e_compose stop -t 30 $(tr '\n' ' ' < "$original_services_file") > "$artifact_dir/logs/original-e2e-stop.log" 2>&1
  original_stopped=1
fi

E2E_SECRET_DIR="$secret_dir" sh "$root_dir/scripts/local-demo-init.sh" > "$artifact_dir/logs/secret-init.log" 2>&1
export ADMIN_PASSWORD="$(cat "$secret_dir/platform_admin_password")"
compose --profile perf --profile perf-seed --profile perf-test config --format json > "$artifact_dir/versions/resolved-compose.json"
run_gate lint pnpm lint
run_gate typecheck pnpm typecheck
run_gate node-tests pnpm test
run_gate production-build pnpm build
run_gate php-syntax docker run --rm -v "$root_dir/plugins/wordpress:/src:ro" composer:2 sh -lc 'find /src -type f -name "*.php" -print0 | xargs -0 -n1 php -l'
run_gate plugin-package package_reproducibility
run_gate compose-config compose config --quiet
compose config --quiet
compose pull --quiet k6 perf-agent-seed-1 > "$artifact_dir/logs/image-pull.log" 2>&1
if [ "${PERF_SKIP_BUILD:-0}" = 1 ]; then
  compose up --wait --detach > "$artifact_dir/logs/stack-up.log" 2>&1
else
  compose up --build --wait --detach > "$artifact_dir/logs/stack-up.log" 2>&1
fi
run_gate image-digests record_image_inventory
run_gate runtime-exposure verify_runtime_exposure
run_gate phpunit compose --profile perf-test run --rm wordpress-phpunit
compose run --rm -e APP_COMMAND=prisma:seed -e APP_URL=https://localhost -e PLATFORM_ADMIN_EMAIL="$ADMIN_EMAIL" -e PLATFORM_ADMIN_PASSWORD="$ADMIN_PASSWORD" migrate > "$artifact_dir/logs/seed-admin.log" 2>&1
node "$root_dir/scripts/performance-control.mjs" bootstrap > "$artifact_dir/logs/bootstrap-wordpress.log" 2>&1
LOCAL_E2E=1 node "$root_dir/scripts/agent-security-smoke.mjs" > "$artifact_dir/agent-security.json" 2> "$artifact_dir/logs/agent-security.log"

compose --profile perf-seed up --detach perf-agent-seed-1 perf-agent-seed-2 perf-agent-seed-3 perf-agent-seed-4 perf-agent-seed-5 > "$artifact_dir/logs/seed-agents-up.log" 2>&1
compose wait perf-agent-seed-1 perf-agent-seed-2 perf-agent-seed-3 perf-agent-seed-4 perf-agent-seed-5 > "$artifact_dir/logs/seed-agents-wait.log" 2>&1
agent_count="$(node -e 'const fs=require("fs"),p=process.argv[1];let n=0;for(const f of fs.readdirSync(p).filter(x=>/^agents-shard-\d+\.json$/.test(x)))n+=JSON.parse(fs.readFileSync(`${p}/${f}`)).agents.length;process.stdout.write(String(n))' "$agent_dir")"
[ "$agent_count" -eq 49 ] || { printf 'Expected 49 synthetic agents, found %s\n' "$agent_count" >&2; exit 1; }

PERF_AGENT_COMMAND=runtime node "$root_dir/scripts/performance-agents.mjs" > "$artifact_dir/logs/agent-runtime.log" 2>&1 &
agent_pid=$!
node "$root_dir/scripts/performance-observer.mjs" > "$artifact_dir/logs/observer.log" 2>&1 &
observer_pid=$!

BOT_SIMULATION_ID="bot-$run_id" BOT_SIM_RESULT_PATH="$artifact_dir/bot-functional.json" BOT_SIM_REPORT_PATH="$artifact_dir/bot-functional.md" \
  node "$root_dir/scripts/bot-attack-simulation.mjs" > "$artifact_dir/logs/bot-functional.log" 2>&1
node "$root_dir/scripts/performance-control.mjs" prepare > "$artifact_dir/logs/prepare-load-firewall.log" 2>&1
compose exec -T wordpress-cron wp db query "TRUNCATE TABLE wp_honeypot_ai_rate_limits" --path=/var/www/html > "$artifact_dir/logs/rate-limit-reset.log" 2>&1
PERF_RATE_LIMIT_RESULT="$artifact_dir/rate-limit-atomic.json" node "$root_dir/scripts/rate-limit-atomic-smoke.mjs" > "$artifact_dir/logs/rate-limit-atomic.log" 2>&1

run_k6 harness-smoke 5 "$(scaled 60)"
snapshot after-smoke

full_started="$(date +%s)"
set_phase preflight
capture baseline
sh "$root_dir/scripts/performance-browser-smoke.sh" > "$artifact_dir/logs/browser-ui-smoke.log" 2>&1
snapshot baseline
wait_seconds "$(scaled 300)"

run_k6 baseline 5 "$(scaled 300)"
run_k6 ramp-10 10 "$(scaled 200)"
run_k6 ramp-25 25 "$(scaled 200)"
run_k6 ramp-50 50 "$(scaled 200)"
capture sustained
run_k6 sustained 50 "$(scaled 1200)"
capture peak
run_k6 spike 100 "$(scaled 120)"

breakpoint_started="$(date +%s)"
consecutive_breaches=0
highest_passing=50
for rate in 75 100 125 150 175 200; do
  phase="breakpoint-$rate"
  run_k6 "$phase" "$rate" "$(scaled 120)" || true
  [ ! -f "$abort_file" ] || exit 1
  result="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1]));const target=Number(process.argv[2]);const m=p.data.metrics;const p95=Number(m.normal_latency?.values?.["p(95)"]??Infinity);const normalCorrect=Number(m.normal_response_correct?.values?.rate??0);const firewallP95=Number(m.firewall_latency?.values?.["p(95)"]??Infinity);const firewallCorrect=Number(m.firewall_response_correct?.values?.rate??0);const rateCorrect=Number(m.rate_limit_response_correct?.values?.rate??0);const honeypotCorrect=Number(m.honeypot_response_correct?.values?.rate??0);const achieved=Number(m.iterations?.values?.rate??0);const dropped=Number(m.dropped_iterations?.values?.count??0);const delivered=target>0?achieved/target:0;process.stdout.write(`${p95}|${1-normalCorrect}|${firewallP95}|${firewallCorrect}|${rateCorrect}|${honeypotCorrect}|${delivered}|${dropped}`)' "$artifact_dir/k6/$phase-summary.json" "$rate" 2>/dev/null || printf 'Infinity|1|Infinity|0|0|0|0|1')"
  p95="${result%%|*}"
  rest="${result#*|}"; error_rate="${rest%%|*}"
  rest="${rest#*|}"; firewall_p95="${rest%%|*}"
  rest="${rest#*|}"; firewall_correct="${rest%%|*}"
  rest="${rest#*|}"; rate_correct="${rest%%|*}"
  rest="${rest#*|}"; honeypot_correct="${rest%%|*}"
  rest="${rest#*|}"; delivered_ratio="${rest%%|*}"; dropped_iterations="${rest#*|}"
  # Breakpoint stopping measures delivered capacity. Security correctness and
  # firewall latency remain mandatory report gates, but do not redefine the
  # specified two-consecutive-stage capacity stop condition.
  breached="$(node -e 'process.stdout.write((Number(process.argv[1])>750||Number(process.argv[2])>0.01||Number(process.argv[3])<0.98||Number(process.argv[4])!==0)?"1":"0")' "$p95" "$error_rate" "$delivered_ratio" "$dropped_iterations")"
  if [ "$breached" -eq 1 ]; then consecutive_breaches=$((consecutive_breaches + 1)); else consecutive_breaches=0; highest_passing="$rate"; fi
  [ "$consecutive_breaches" -lt 2 ] || break
done
printf '{"highestPassingRps":%s,"stoppedAfterConsecutiveBreaches":%s}\n' "$highest_passing" "$consecutive_breaches" > "$artifact_dir/breakpoint-result.json"
breakpoint_target=$((breakpoint_started + $(scaled 720)))
now="$(date +%s)"
[ "$now" -ge "$breakpoint_target" ] || wait_seconds $((breakpoint_target - now))

soak_duration="$(scaled 1800)"
run_k6_background soak-chaos 25 "$soak_duration"
k6_background_active=1
soak_started="$(date +%s)"
wait_until_offset "$soak_started" 240
stop_fault worker
wait_until_offset "$soak_started" 360
start_fault worker
wait_until_offset "$soak_started" 600
stop_fault api
wait_until_offset "$soak_started" 720
start_fault api
wait_until_offset "$soak_started" 960
stop_fault redis
PERF_AGENT_COMMAND=probe PERF_EXPECT_STATUS=503 node "$root_dir/scripts/performance-agents.mjs" > "$artifact_dir/redis-replay-fail-closed.json" 2> "$artifact_dir/logs/redis-replay-fail-closed.log"
wait_until_offset "$soak_started" 1080
start_fault redis
PERF_AGENT_COMMAND=probe PERF_EXPECT_STATUS=200 node "$root_dir/scripts/performance-agents.mjs" > "$artifact_dir/redis-replay-recovered.json" 2> "$artifact_dir/logs/redis-replay-recovered.log"
wait_until_offset "$soak_started" 1320
stop_fault wordpress-db
wait_until_offset "$soak_started" 1440
start_fault wordpress-db
wait_for_background_k6
k6_background_active=0
k6_pid=""

set_phase recovery
capture recovery
wait_seconds "$(scaled 300)"
snapshot natural-recovery
wait_seconds "$(scaled 60)"

if [ -n "$agent_pid" ]; then
  kill -TERM "$agent_pid" >/dev/null 2>&1 || true
  wait "$agent_pid" >/dev/null 2>&1 || true
  agent_pid=""
fi
cp "$PERF_AGENT_STATE_PATH" "$artifact_dir/agent-runtime-final.json"
chmod 600 "$artifact_dir/agent-runtime-final.json"
reconciliation_started="$(date -u +%FT%TZ)"
printf '%s\n' "$reconciliation_started" > "$artifact_dir/final-reconciliation-started.txt"
PERF_RECONCILIATION_STARTED_AT="$reconciliation_started" PERF_AGENT_COMMAND=reconcile node "$root_dir/scripts/performance-agents.mjs" > "$artifact_dir/final-agent-reconciliation.json" 2> "$artifact_dir/logs/final-agent-reconciliation.log"
PERF_RECONCILIATION_STARTED_AT="$reconciliation_started" node "$root_dir/scripts/performance-control.mjs" reconcile > "$artifact_dir/final-fleet-reconciliation.json" 2> "$artifact_dir/logs/final-fleet-reconciliation.log"

set_phase cleanup
cleanup_tmp="$artifact_dir/snapshots/final-cleanup.main.tmp.json"
node "$root_dir/scripts/performance-control.mjs" cleanup > "$cleanup_tmp" 2> "$artifact_dir/logs/final-cleanup.log"
mv "$cleanup_tmp" "$artifact_dir/snapshots/final-cleanup.json"
wait_analysis_drained
capture final final

compose exec -T postgres psql -tA -U honeypot -d honeypot_ai -c "SELECT COUNT(*) FROM \"SecurityEvent\" WHERE concat_ws(' ',COALESCE(payload,''),COALESCE(\"userAgent\",''),COALESCE(referrer,''),COALESCE(headers::text,''),COALESCE(metadata::text,'')) SIMILAR TO '%(PERF-PASSWORD-$run_id|PERF-AUTH-$run_id|PERF-COOKIE-$run_id|SIM-PASSWORD-bot-$run_id|SIM-DB-PASSWORD-bot-$run_id|SIM-AUTH-bot-$run_id|SIM-COOKIE-bot-$run_id)%';" > "$artifact_dir/redaction-database-count.txt" 2>/dev/null || true
compose exec -T postgres psql -tA -U honeypot -d honeypot_ai -c "SELECT json_build_object('honeypot',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE kind='HONEYPOT' AND COALESCE(\"userAgent\",'') LIKE 'SmartHoneyDecoy/$run_id%'),'firewall',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE kind='FIREWALL' AND COALESCE(\"userAgent\",'') LIKE 'PerfBlockedBot/$run_id%'),'rateLimit',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE kind='RATE_LIMIT' AND COALESCE(\"userAgent\",'') LIKE 'PerfRateBot/$run_id%'),'rateAtomic',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE kind='RATE_LIMIT' AND COALESCE(\"userAgent\",'') LIKE 'PerfRateAtomic/$run_id%'),'markedEvents',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE COALESCE(headers->>'x-perf-event-id','') LIKE '$run_id:%'),'distinctMarkedEvents',(SELECT COUNT(DISTINCT headers->>'x-perf-event-id') FROM \"SecurityEvent\" WHERE COALESCE(headers->>'x-perf-event-id','') LIKE '$run_id:%'),'syntheticAgent',(SELECT COUNT(*) FROM \"SecurityEvent\" WHERE kind='PLUGIN_HEALTH' AND COALESCE(\"userAgent\",'') LIKE 'SmartHoneyPerfAgent/$run_id/%'),'duplicateKeys',(SELECT COUNT(*) FROM (SELECT \"siteId\",\"idempotencyKey\",COUNT(*) c FROM \"SecurityEvent\" GROUP BY 1,2 HAVING COUNT(*)>1) duplicates));" > "$artifact_dir/event-reconciliation.json" 2>/dev/null || true
compose exec -T wordpress-db sh -lc 'mariadb -N -uwordpress -p"$(cat /run/secrets/wordpress_db_password)" wordpress -e "SELECT CONCAT(row_count,CHAR(124),payload_bytes,CHAR(124),dropped_events) FROM wp_honeypot_ai_queue_state WHERE singleton_id=1"' > "$artifact_dir/wordpress-final-spool.txt" 2>/dev/null || true

set_phase complete
printf '{"runId":"%s","profile":"%s","timeScale":%s,"startedAtEpoch":%s,"completedAt":"%s"}\n' "$run_id" "$profile" "$scale" "$full_started" "$(date -u +%FT%TZ)" > "$artifact_dir/run-complete.json"

exit 0
