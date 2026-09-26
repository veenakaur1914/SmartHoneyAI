#!/bin/sh
set -eu

umask 077
secret_dir="${SECRET_DIR:-./secrets}"
tls_dir="${TLS_CERT_DIR:-$secret_dir/tls}"
mkdir -p "$secret_dir" "$tls_dir"

create_random_secret() {
  path="$1"
  bytes="$2"
  if [ ! -s "$path" ]; then
    openssl rand -hex "$bytes" | tr -d '\n' > "$path"
    printf '\n' >> "$path"
    echo "created $path"
  fi
}

create_random_secret "$secret_dir/postgres_password" 32
create_random_secret "$secret_dir/redis_password" 32
create_random_secret "$secret_dir/session_secret" 48
create_random_secret "$secret_dir/agent_signing_secret" 48
create_random_secret "$secret_dir/grafana_admin_password" 32

for optional_secret in telegram_bot_token smtp_password
do
  if [ ! -e "$secret_dir/$optional_secret" ]; then
    : > "$secret_dir/$optional_secret"
    echo "created empty $secret_dir/$optional_secret; fill it when enabling that integration"
  fi
done

for required_provider_secret in hf_token
do
  if [ ! -e "$secret_dir/$required_provider_secret" ]; then
    : > "$secret_dir/$required_provider_secret"
    chmod 600 "$secret_dir/$required_provider_secret"
    echo "created $secret_dir/$required_provider_secret"
  fi
  if [ ! -s "$secret_dir/$required_provider_secret" ]; then
    echo "required provider credential is still empty: $secret_dir/$required_provider_secret (production deployment will refuse it)" >&2
  fi
done

if [ ! -s "$secret_dir/policy_signing_private_key" ]; then
  command -v node >/dev/null 2>&1 || { echo "Node.js is required to create Ed25519 policy keys" >&2; exit 1; }
  node - "$secret_dir/policy_signing_private_key" "$secret_dir/policy_signing_public_key" <<'NODE'
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(process.argv[2], Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64") + "\n", { mode: 0o600 });
writeFileSync(process.argv[3], Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64") + "\n", { mode: 0o600 });
NODE
  echo "created Ed25519 policy signing key pair"
fi

if [ "${GENERATE_SELF_SIGNED_TLS:-0}" = "1" ] && [ ! -s "$tls_dir/fullchain.pem" ]; then
  domain="${DOMAIN:-localhost}"
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
    -subj "/CN=$domain" \
    -addext "subjectAltName=DNS:$domain,DNS:localhost,IP:127.0.0.1" \
    -keyout "$tls_dir/privkey.pem" \
    -out "$tls_dir/fullchain.pem"
  echo "created 30-day development certificate for $domain"
fi

echo "Secrets are initialized in $secret_dir; populate the Hugging Face credential and any enabled optional provider files before deployment, then back them up separately from the database."
