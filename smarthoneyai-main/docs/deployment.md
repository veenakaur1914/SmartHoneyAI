# Production deployment

## Host requirements

- Ubuntu 24.04 LTS with current security updates.
- Docker Engine with Compose v2.
- At least 4 vCPU, 8 GiB RAM, 80 GiB SSD, and separate off-host backup storage for the 50-site pilot.
- DNS `A`/`AAAA` record for the platform hostname.
- Host firewall allowing inbound 80/443 and SSH only from an operator allowlist.
- `age`, `rclone` (when used), `curl`, and `openssl` installed on the host.

Customers receive HTTPS access only. Do not provide Docker socket, shell, database, Redis, Grafana, Prometheus, or host credentials.

## Prepare configuration

1. Clone the release into a versioned directory such as `/opt/honeypot-ai/releases/2026-07-12` and point `/opt/honeypot-ai/current` to it.
2. Copy `.env.example` to `.env`. Set `NODE_ENV=production`, `APP_URL=https://security.example.com`, the persistent administrator and organization identities, and an immutable 40-character Hugging Face model commit in `HF_MODEL_REVISION`. Invitations use manual one-time share links. SMTP is optional and only supports password-reset email: leave `SMTP_HOST`, `SMTP_USER`, and `SMTP_FROM` blank to disable it, or configure all of them together. Do not keep service tokens or passwords in `.env`.
3. Run `sh scripts/init-secrets.sh`. Put the required Hugging Face token in `secrets/hf_token`. Leave the optional `secrets/smtp_password` blank when password-reset email is disabled, or populate it when all SMTP settings are enabled; when enabled, put the optional Telegram credential in `secrets/telegram_bot_token`. The init script intentionally leaves provider-owned credentials empty, and `scripts/deploy.sh` refuses to deploy until required secret files are populated. Store a separate encrypted copy of `secrets/`; losing the policy key or application secrets disrupts agents and sessions.
4. Obtain a trusted certificate. A simple first issuance is:

   ```bash
   sudo certbot certonly --standalone -d security.example.com
   sudo install -m 0600 /etc/letsencrypt/live/security.example.com/privkey.pem secrets/tls/privkey.pem
   sudo install -m 0644 /etc/letsencrypt/live/security.example.com/fullchain.pem secrets/tls/fullchain.pem
   ```

   Stop the Compose Nginx service briefly for standalone renewal, or use a separately managed ACME webroot. After renewal, update the mounted copies and run `docker compose exec nginx nginx -s reload`.
5. Set restrictive ownership and permissions: deployment directory accessible only to the operator group, `.env` mode `0600`, secret files mode `0600`, and TLS certificate mode `0644`.

Secret values should be URL-safe because the application entrypoint constructs internal PostgreSQL and Redis URLs from them. The provided generator creates compatible values.

## Deploy

```bash
docker compose config --quiet
sh scripts/deploy.sh
docker compose ps
```

The API container applies committed Prisma migrations before starting. Do not run development migrations in production. Confirm:

- `https://security.example.com/health/live` returns 200.
- `https://security.example.com/health/ready` returns 200.
- Login and access-request pages load over HTTPS with HSTS and no mixed content.
- No ports other than 80/443 and allowlisted SSH are reachable externally.
- API, worker, PostgreSQL, Redis, and Nginx report healthy.
- A test WordPress site enrolls and acknowledges a policy.

## Monitoring access

Grafana intentionally has no host port. Use a temporary SSH tunnel through the Docker network rather than publishing it permanently. One option is an ephemeral loopback-only forwarder:

```bash
docker run --rm --network honeypot-ai_monitoring -p 127.0.0.1:3001:3000 alpine/socat tcp-listen:3000,fork,reuseaddr tcp-connect:grafana:3000
```

Then create an SSH tunnel to host port 3001. Remove the forwarder when finished. Configure a real Alertmanager receiver before launch; the committed receiver logs alerts only.

## Rollback

Keep the previous release directory and an encrypted pre-deploy database backup. For a code-only rollback with backward-compatible migrations, repoint `current` to the previous release and run its `sh scripts/deploy.sh`. For an incompatible schema change, stop web/API/worker, restore the matching pre-deploy backup using the previous release, then start it. Never reverse a migration by hand while the application is serving traffic.

## Dokploy

Use the dedicated `docker-compose.dokploy.yml` Compose project. Dokploy/Traefik terminates TLS and routes the public domain only to service `nginx` on internal port `8080`; the deployment does not use TLS passthrough or publish host ports. Do not route directly to `web`, because that bypasses the API and agent paths.

The complete operator walkthrough, including environment generation and exact Dokploy domain settings, is in [`DOKPLOY.md`](../DOKPLOY.md).
