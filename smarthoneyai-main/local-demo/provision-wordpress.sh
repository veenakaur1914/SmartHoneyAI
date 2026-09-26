#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$script_dir/isolated-target-guard.sh"
wp_path=/var/www/html
admin_password="$(cat /run/secrets/wordpress_admin_password)"
wordpress_url="${WORDPRESS_URL:-http://localhost:8080}"
assert_isolated_wordpress_site_url "$wordpress_url"

if [ ! -f "$wp_path/wp-load.php" ]; then
  echo "WordPress files are not ready." >&2
  exit 1
fi

if ! wp core is-installed --path="$wp_path" >/dev/null 2>&1; then
  wp core install \
    --path="$wp_path" \
    --url="$wordpress_url" \
    --title="${WORDPRESS_TITLE:-SmartHoneyAI Local WordPress}" \
    --admin_user="${WORDPRESS_ADMIN_USER:-honeypot-admin}" \
    --admin_password="$admin_password" \
    --admin_email="${WORDPRESS_ADMIN_EMAIL:-wordpress-admin@localhost.invalid}" \
    --skip-email
fi

mkdir -p "$wp_path/wp-content/mu-plugins"
cp /demo/mu-plugins/honeypot-ai-local-control-plane.php "$wp_path/wp-content/mu-plugins/"
cp /demo/mu-plugins/honeypot-ai-test-source.php "$wp_path/wp-content/mu-plugins/"

wp option update permalink_structure '/%postname%/' --path="$wp_path" --quiet
if [ -z "$(wp post list --post_type=page --name=blocked-test --field=ID --path="$wp_path")" ]; then
  wp post create \
    --post_type=page \
    --post_status=publish \
    --post_title='Firewall test' \
    --post_name=blocked-test \
    --post_content='This harmless local page is used to verify observe and enforce behavior.' \
    --path="$wp_path" >/dev/null
fi
wp rewrite flush --hard --path="$wp_path" --quiet
wp plugin activate honeypot-ai --path="$wp_path" --quiet
wp eval 'if (!extension_loaded("sodium") || !function_exists("sodium_crypto_sign_verify_detached")) { fwrite(STDERR, "PHP Sodium is required.\n"); exit(1); }' --path="$wp_path"

wp cron event schedule honeypot_ai_agent_tick now honeypot_ai_five_minutes --path="$wp_path" >/dev/null 2>&1 || true

printf 'WordPress is provisioned at %s with SmartHoneyAI %s active.\n' \
  "$wordpress_url" \
  "$(wp plugin get honeypot-ai --field=version --path="$wp_path")"
