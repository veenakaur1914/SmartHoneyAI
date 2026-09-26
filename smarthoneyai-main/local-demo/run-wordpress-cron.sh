#!/bin/sh
set -eu

wp_path=/var/www/html
interval="${WORDPRESS_CRON_INTERVAL_SECONDS:-15}"

case "$interval" in
  ''|*[!0-9]*) echo "WORDPRESS_CRON_INTERVAL_SECONDS must be an integer." >&2; exit 2 ;;
esac

while :; do
  wp cron event run --due-now --path="$wp_path" --quiet || true
  sleep "$interval"
done
