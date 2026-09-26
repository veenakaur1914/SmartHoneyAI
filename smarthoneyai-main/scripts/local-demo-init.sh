#!/bin/sh
set -eu

umask 077
root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
secret_dir="${E2E_SECRET_DIR:-$root_dir/secrets/e2e}"
tls_dir="$secret_dir/tls"

mkdir -p "$secret_dir" "$tls_dir"
SECRET_DIR="$secret_dir" sh "$root_dir/scripts/init-secrets.sh"

create_secret() {
  path="$1"
  bytes="$2"
  if [ ! -s "$path" ]; then
    openssl rand -hex "$bytes" > "$path"
    chmod 600 "$path"
  fi
}

create_secret "$secret_dir/wordpress_db_password" 32
create_secret "$secret_dir/wordpress_db_root_password" 32
create_secret "$secret_dir/wordpress_admin_password" 24
create_secret "$secret_dir/wordpress_test_source_secret" 32
create_secret "$secret_dir/telegram_bot_token" 32
if [ ! -s "$secret_dir/platform_admin_password" ]; then
  if [ -n "${E2E_PLATFORM_ADMIN_PASSWORD:-}" ]; then
    printf '%s\n' "$E2E_PLATFORM_ADMIN_PASSWORD" > "$secret_dir/platform_admin_password"
  else
    openssl rand -base64 36 | tr -d '\n' > "$secret_dir/platform_admin_password"
    printf '\n' >> "$secret_dir/platform_admin_password"
  fi
  chmod 600 "$secret_dir/platform_admin_password"
fi

if [ ! -s "$tls_dir/fullchain.pem" ] \
  || ! openssl x509 -in "$tls_dir/fullchain.pem" -checkend 0 -noout >/dev/null 2>&1 \
  || ! openssl x509 -in "$tls_dir/fullchain.pem" -noout -text 2>/dev/null | grep -q 'DNS:host.docker.internal'; then
  rm -f "$tls_dir/fullchain.pem" "$tls_dir/privkey.pem"
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
    -subj '/CN=localhost' \
    -addext 'subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign' \
    -addext 'extendedKeyUsage=serverAuth' \
    -keyout "$tls_dir/privkey.pem" \
    -out "$tls_dir/fullchain.pem" >/dev/null 2>&1
  chmod 600 "$tls_dir/privkey.pem"
fi
chmod 644 "$tls_dir/fullchain.pem"

credentials="$secret_dir/credentials.txt"
{
  printf 'Platform URL: https://localhost\n'
  printf 'Platform email: %s\n' "${E2E_PLATFORM_ADMIN_EMAIL:-admin@smarthoneyai.local}"
  printf 'Platform password: %s\n' "$(cat "$secret_dir/platform_admin_password")"
  printf 'WordPress URL: http://localhost:%s\n' "${WORDPRESS_PORT:-8080}"
  printf 'WordPress user: honeypot-admin\n'
  printf 'WordPress password: %s\n' "$(cat "$secret_dir/wordpress_admin_password")"
  printf 'Synthetic-IP header: X-Honeypot-Test-Remote-Addr\n'
  printf 'Synthetic-IP secret header: X-Honeypot-Test-Secret\n'
  printf 'Synthetic-IP secret: %s\n' "$(cat "$secret_dir/wordpress_test_source_secret")"
} > "$credentials"
chmod 600 "$credentials"

printf 'Local demo secrets and TLS certificate are ready in %s\n' "$secret_dir"
printf 'Local credentials: %s\n' "$credentials"
