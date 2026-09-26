#!/bin/sh
set -eu

urls_file=${EXISTING_WEBSITE_URLS_FILE:?Set EXISTING_WEBSITE_URLS_FILE to a newline-separated HTTPS URL inventory}
output=${NETWORK_SENSOR_SMOKE_OUTPUT:-./output/network-sensor-smoke.tsv}
mkdir -p "$(dirname "$output")"
: > "$output"

failed=0
while IFS= read -r url; do
  case "$url" in ''|'#'*) continue;; esac
  case "$url" in https://*) :;; *) printf '%s\tINVALID_NOT_HTTPS\n' "$url" >> "$output"; failed=1; continue;; esac
  status=$(curl --silent --show-error --location --max-time 20 --output /dev/null --write-out '%{http_code}' "$url" || printf '000')
  printf '%s\t%s\n' "$url" "$status" >> "$output"
  case "$status" in 2??|3??|401|403) :;; *) failed=1;; esac
done < "$urls_file"

[ "$failed" -eq 0 ] || { printf 'One or more shared-VPS websites failed. See %s\n' "$output" >&2; exit 1; }
printf 'All inventoried HTTPS websites passed. Evidence: %s\n' "$output"
