#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
if [ "${1:-}" = "--purge" ]; then
  [ "${PURGE_SENSOR_DATA_CONFIRMED:-NO}" = "YES" ] || { printf 'Set PURGE_SENSOR_DATA_CONFIRMED=YES to delete credentials and spool data.\n' >&2; exit 1; }
  COMPOSE_PROFILES=sensor docker compose down --volumes
  printf 'Sensor containers, networks and persistent data removed.\n'
else
  COMPOSE_PROFILES=sensor docker compose down
  printf 'Sensor stopped; persistent credentials and spool data preserved.\n'
fi
