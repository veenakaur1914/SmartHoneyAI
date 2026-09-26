#!/usr/bin/env bash
set -euo pipefail

db_name="${1:-wordpress_test}"
db_user="${2:-root}"
db_password="${3:-}"
db_host="${4:-127.0.0.1:3306}"
wp_version="${5:-7.0.0}"
tests_dir="${WP_TESTS_DIR:-/tmp/wordpress-tests-lib}"
core_dir="${WP_CORE_DIR:-/tmp/wordpress}"
fixture_version="$wp_version"

[[ "$db_name" =~ ^[A-Za-z0-9_]+$ ]] || { echo 'Database name contains unsupported characters.' >&2; exit 2; }

for command in curl svn mysql sed; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required" >&2; exit 1; }
done

rm -rf "$tests_dir" "$core_dir"
mkdir -p "$tests_dir" "$core_dir"

archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT
if ! curl --fail --location --silent --show-error \
  "https://wordpress.org/wordpress-${fixture_version}.tar.gz" \
  --output "$archive"; then
  case "$fixture_version" in
    *.0.0) fixture_version="${fixture_version%.0}" ;;
    *) echo "WordPress $fixture_version release archive was not found." >&2; exit 1 ;;
  esac
  curl --fail --location --silent --show-error \
    "https://wordpress.org/wordpress-${fixture_version}.tar.gz" \
    --output "$archive"
fi
tar --extract --gzip --strip-components=1 --directory="$core_dir" --file="$archive"

svn export --quiet --force \
  "https://develop.svn.wordpress.org/tags/${fixture_version}/tests/phpunit/includes/" \
  "$tests_dir/includes"
svn export --quiet --force \
  "https://develop.svn.wordpress.org/tags/${fixture_version}/tests/phpunit/data/" \
  "$tests_dir/data"
curl --fail --location --silent --show-error \
  "https://develop.svn.wordpress.org/tags/${fixture_version}/wp-tests-config-sample.php" \
  --output "$tests_dir/wp-tests-config.php"

escape_sed() { printf '%s' "$1" | sed 's/[\\&|]/\\&/g'; }
sed -i \
  -e "s|youremptytestdbnamehere|$(escape_sed "$db_name")|" \
  -e "s|yourusernamehere|$(escape_sed "$db_user")|" \
  -e "s|yourpasswordhere|$(escape_sed "$db_password")|" \
  -e "s|localhost|$(escape_sed "$db_host")|" \
  -e "s|dirname( __FILE__ ) . '/src/'|'$(escape_sed "$core_dir")/'|" \
  "$tests_dir/wp-tests-config.php"

mysql_args=(
  --protocol=tcp
  --host="${db_host%%:*}"
  --port="${db_host##*:}"
  --user="$db_user"
)
if [[ -n "$db_password" ]]; then
  mysql_args+=(--password="$db_password")
fi
mysql "${mysql_args[@]}" \
  -e "DROP DATABASE IF EXISTS \`$db_name\`; CREATE DATABASE \`$db_name\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

printf 'WordPress %s PHPUnit fixture installed in %s\n' "$fixture_version" "$tests_dir"
