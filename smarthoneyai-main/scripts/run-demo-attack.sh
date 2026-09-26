#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
mode="${1:?Pass wordpress or docker}"
shift

case "$mode" in
  wordpress) script="$root_dir/scripts/attack-wordpress-demo.mjs" ;;
  docker) script="$root_dir/scripts/attack-docker-sensor-demo.mjs" ;;
  *) printf 'Unknown demo mode: %s\n' "$mode" >&2; exit 2 ;;
esac

case " $* " in
  *" --execute "*)
    export E2E_SECRET_DIR="${E2E_SECRET_DIR:-$root_dir/secrets/e2e}"
    sh "$root_dir/scripts/local-demo-init.sh" >/dev/null
    export NODE_EXTRA_CA_CERTS="$E2E_SECRET_DIR/tls/fullchain.pem"
    ;;
esac

exec node "$script" "$@"
