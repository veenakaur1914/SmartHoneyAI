#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
plugin_dir="$root_dir/plugins/wordpress"
version="$(sed -n 's/^ \* Version: \([0-9][0-9.]*\)$/\1/p' "$plugin_dir/honeypot-ai.php")"
constant_version="$(sed -n "s/^define[[:space:]]*( *'HONEYPOT_AI_VERSION',[[:space:]]*'\([^']*\)' *);/\1/p" "$plugin_dir/honeypot-ai.php")"

[ -n "$version" ] || { echo 'Could not read plugin version.' >&2; exit 1; }
[ "$version" = "$constant_version" ] || { echo 'Plugin header and constant versions differ.' >&2; exit 1; }

output="${1:-$root_dir/output/artifacts/honeypot-ai-$version.zip}"
output_dir="$(dirname "$output")"
mkdir -p "$output_dir"
output_dir="$(CDPATH= cd -- "$output_dir" && pwd)"
output="$output_dir/$(basename "$output")"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/honeypot-ai/includes"
mkdir -p "$stage/honeypot-ai/assets"

for file in honeypot-ai.php uninstall.php readme.txt README.md; do
  cp "$plugin_dir/$file" "$stage/honeypot-ai/$file"
done
for file in "$plugin_dir"/includes/*.php; do
  cp "$file" "$stage/honeypot-ai/includes/$(basename "$file")"
done
for file in "$plugin_dir"/assets/*; do
  cp "$file" "$stage/honeypot-ai/assets/$(basename "$file")"
done

timestamp="${SOURCE_DATE_TIMESTAMP:-202401010000.00}"
find "$stage/honeypot-ai" -exec env TZ=UTC touch -h -t "$timestamp" {} +
rm -f "$output"
(
  cd "$stage"
  find honeypot-ai -type f -print | LC_ALL=C TZ=UTC sort | TZ=UTC zip -X -q "$output" -@
)

printf '%s\n' "$output"
