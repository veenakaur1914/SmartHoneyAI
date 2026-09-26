#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=$(sed -n "s/^define[[:space:]]*( *'HONEYPOT_AI_VERSION',[[:space:]]*'\([^']*\)' *);/\1/p" "$root/honeypot-ai.php")
header_version=$(sed -n 's/^ \* Version: \(.*\)$/\1/p' "$root/honeypot-ai.php")
stable_tag=$(sed -n 's/^Stable tag: \(.*\)$/\1/p' "$root/readme.txt")

if [ -z "$version" ] || [ "$version" != "$header_version" ] || [ "$version" != "$stable_tag" ]; then
    echo 'Plugin version, header version, and stable tag must match.' >&2
    exit 1
fi

output=${1:-"$root/../../output/releases/smarthoneyai-wordpress-$version.zip"}
output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
output="$output_dir/$(basename -- "$output")"

stage=$(mktemp -d "${TMPDIR:-/tmp}/honeypot-ai-package.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/honeypot-ai"
cp "$root/honeypot-ai.php" "$root/readme.txt" "$root/README.md" "$root/uninstall.php" "$stage/honeypot-ai/"
cp -R "$root/includes" "$stage/honeypot-ai/includes"
cp -R "$root/assets" "$stage/honeypot-ai/assets"

find "$stage/honeypot-ai" -type d -exec chmod 0755 {} +
find "$stage/honeypot-ai" -type f -exec chmod 0644 {} +
find "$stage/honeypot-ai" -exec touch -t 202001010000 {} +
rm -f "$output"
(
    cd "$stage"
    find honeypot-ai -type f | LC_ALL=C sort | zip -X -q "$output" -@
)

echo "$output"
