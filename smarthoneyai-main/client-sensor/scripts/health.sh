#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
COMPOSE_PROFILES=sensor docker compose ps
agent_id=$(COMPOSE_PROFILES=sensor docker compose ps -q network-sensor-agent)
canary_id=$(COMPOSE_PROFILES=sensor docker compose ps -q opencanary)
[ -n "$agent_id" ] && [ -n "$canary_id" ] || { printf 'Sensor containers are missing\n' >&2; exit 1; }
[ "$(docker inspect -f '{{.State.Health.Status}}' "$agent_id")" = "healthy" ] || { printf 'Sensor agent is not healthy\n' >&2; exit 1; }
[ "$(docker inspect -f '{{.State.Running}}' "$canary_id")" = "true" ] || { printf 'OpenCanary is not running\n' >&2; exit 1; }
printf 'Client sensor is healthy.\n'
