#!/bin/sh
set -eu

base_url="${APP_URL:?Set APP_URL to the public HTTPS origin}"
attempts="${HEALTH_ATTEMPTS:-30}"
delay="${HEALTH_DELAY_SECONDS:-2}"

case "$base_url" in
  https://*) ;;
  *) echo "APP_URL must use HTTPS: $base_url" >&2; exit 1 ;;
esac

i=1
while [ "$i" -le "$attempts" ]; do
  if curl --fail --silent --show-error --max-time 5 "$base_url/health/ready" >/dev/null; then
    echo "SmartHoneyAI is ready at $base_url"
    exit 0
  fi
  echo "Readiness attempt $i/$attempts failed; retrying in ${delay}s..."
  sleep "$delay"
  i=$((i + 1))
done

echo "SmartHoneyAI did not become ready. Inspect: docker compose ps && docker compose logs api web nginx" >&2
exit 1

