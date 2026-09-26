#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
export NETWORK_SENSOR_NAME=local-package-test
export NETWORK_SENSOR_ENROLLMENT_TOKEN=local-package-test-token-00000000000000000000
export NETWORK_SENSOR_CONTROL_PLANE_URL=http://mock-control-plane:4088
export NETWORK_SENSOR_ALLOWLIST=127.0.0.1
export PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED=LOCAL_ONLY
compose="docker compose -p smarthoneyai-sensor-package-test -f client-sensor/docker-compose.yml -f client-sensor/docker-compose.package-test.yml --profile sensor"
cleanup() { $compose down --volumes >/dev/null 2>&1 || true; rm -f client-sensor/agent/index.js; }
trap cleanup EXIT HUP INT TERM
$compose down --volumes >/dev/null 2>&1 || true
CI=true corepack pnpm --filter @honeypot/network-sensor-agent build:demo >/dev/null
cp apps/network-sensor-agent/dist/index.js client-sensor/agent/index.js
$compose up --build -d

attempt=0
until curl -fsS http://127.0.0.1:14010/health/live >/dev/null 2>&1; do
  attempt=$((attempt+1)); [ "$attempt" -lt 40 ] || { $compose logs; exit 1; }; sleep 1
done

node --input-type=module -e 'import{connect}from"node:net";const payload={logtype:4002,local_time:new Date().toISOString(),src_host:"198.51.100.25",src_port:51234,dst_port:2222,logdata:{USERNAME:"admin-sensitive",PASSWORD:"password-sensitive",TOKEN:"token-sensitive"}};const socket=connect(11514,"127.0.0.1",()=>socket.end(JSON.stringify(payload)+"\n"));socket.on("error",error=>{throw error});'

attempt=0
while :; do
  evidence=$(curl -fsS http://127.0.0.1:14088/evidence)
  count=$(printf '%s' "$evidence" | node --input-type=module -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(b).events.length)))')
  [ "$count" -eq 1 ] && break
  attempt=$((attempt+1)); [ "$attempt" -lt 20 ] || { printf 'Retry evidence did not arrive: %s\n' "$evidence" >&2; exit 1; }; sleep 1
done

printf '%s' "$evidence" | rg -q 'admin-sensitive|password-sensitive|token-sensitive' && { printf 'Credential redaction failed\n' >&2; exit 1; }
printf '%s' "$evidence" | node --input-type=module -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{const j=JSON.parse(b);if(j.ingestAttempts<2||j.events.length!==1)throw new Error("outage retry or exact-once assertion failed");const e=j.events[0];if(e.protocol!=="SSH"||e.activity!=="AUTH_ATTEMPT")throw new Error("normalization assertion failed");console.log(JSON.stringify({status:"PASS",ingestAttempts:j.ingestAttempts,acceptedEvents:j.events.length,redaction:"PASS",protocol:e.protocol,activity:e.activity},null,2));})'
