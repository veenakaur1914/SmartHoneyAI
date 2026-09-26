#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
./scripts/preflight.sh
COMPOSE_PROFILES=sensor docker compose pull opencanary
COMPOSE_PROFILES=sensor docker compose up --build -d
./scripts/health.sh
