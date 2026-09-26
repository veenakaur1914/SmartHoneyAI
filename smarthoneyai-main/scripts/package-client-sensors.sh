#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=1.1.0
release_dir="$root/output/releases"
public_dir="$root/apps/web/public/downloads"
plugin_zip="$release_dir/smarthoneyai-wordpress-$version.zip"
docker_bundle="$release_dir/smarthoneyai-wordpress-docker-$version.tar.gz"
stage=$(mktemp -d "${TMPDIR:-/tmp}/smarthoneyai-client-release.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir -p "$release_dir"
"$root/plugins/wordpress/package.sh" "$plugin_zip"
CI=true pnpm --dir "$root" --filter @honeypot/network-sensor-agent build

mkdir -p "$stage/smarthoneyai-wordpress-docker-$version/agent" "$stage/smarthoneyai-wordpress-docker-$version/scripts"
cp "$plugin_zip" "$stage/smarthoneyai-wordpress-docker-$version/"
cp "$root/client-sensor/docker-compose.yml" "$root/client-sensor/opencanary.conf" "$root/client-sensor/.env.example" "$root/client-sensor/README.md" "$stage/smarthoneyai-wordpress-docker-$version/"
cp "$root/client-sensor/agent/Dockerfile" "$root/apps/network-sensor-agent/dist/index.js" "$stage/smarthoneyai-wordpress-docker-$version/agent/"
cp "$root/client-sensor/scripts/"*.sh "$stage/smarthoneyai-wordpress-docker-$version/scripts/"

find "$stage" -type d -exec chmod 0755 {} +
find "$stage" -type f -exec chmod 0644 {} +
find "$stage" -path '*/scripts/*.sh' -exec chmod 0755 {} +
find "$stage" -exec env TZ=UTC touch -h -t 202001010000 {} +
rm -f "$docker_bundle"
(
  cd "$stage"
  COPYFILE_DISABLE=1 find "smarthoneyai-wordpress-docker-$version" -type f -print | LC_ALL=C sort | COPYFILE_DISABLE=1 tar -cf - -T - | gzip -n > "$docker_bundle"
)

(cd "$release_dir" && shasum -a 256 "$(basename "$plugin_zip")" "$(basename "$docker_bundle")" > SHA256SUMS)
mkdir -p "$public_dir"
cp "$plugin_zip" "$docker_bundle" "$release_dir/SHA256SUMS" "$public_dir/"
printf '%s\n%s\n%s\n' "$plugin_zip" "$docker_bundle" "$release_dir/SHA256SUMS"
