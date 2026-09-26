#!/bin/sh
set -eu

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

command -v docker >/dev/null 2>&1 || fail "Docker is unavailable"
docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
[ -r .env ] || fail "Create .env from .env.example"

set -a
. ./.env
set +a

[ "${PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED:-NO}" = "YES" ] || fail "provider firewall allowlist is not confirmed"
[ -n "${NETWORK_SENSOR_CONTROL_PLANE_URL:-}" ] || fail "control plane URL is missing"
case "$NETWORK_SENSOR_CONTROL_PLANE_URL" in https://*) :;; *) fail "control plane must use HTTPS";; esac
[ -n "${NETWORK_SENSOR_ALLOWLIST:-}" ] || fail "source IP allowlist is empty"
[ -z "${SENSOR_DEMO_SOURCE_IP:-}" ] && [ -z "${SENSOR_DEMO_RUN_ID:-}" ] || fail "demo override variables are forbidden in the production package"

for command_name in awk df ss; do command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"; done
available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
[ "${available_kib:-0}" -ge 5242880 ] || fail "less than 5 GiB disk is available"
available_memory_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[ "${available_memory_kib:-0}" -ge 1048576 ] || fail "less than 1 GiB memory is available"

for port in "${SENSOR_SSH_PORT:-2222}" "${SENSOR_MYSQL_PORT:-13306}" "${SENSOR_REDIS_PORT:-16379}"; do
  docker ps --format '{{.Ports}}' | grep -Eq "0\\.0\\.0\\.0:${port}->|127\\.0\\.0\\.1:${port}->|\\[::\\]:${port}->" && fail "host port $port is already allocated"
  ss -H -ltn | awk '{print $4}' | grep -Eq "(^|:)$port$" && fail "host socket $port is already listening"
done

COMPOSE_PROFILES=sensor docker compose config --quiet
pass "ports, HTTPS, Docker, memory, disk and production exposure gates passed"
