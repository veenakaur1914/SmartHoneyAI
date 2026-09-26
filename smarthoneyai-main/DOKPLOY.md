# Deploy SmartHoneyAI on Dokploy

This guide deploys the complete SmartHoneyAI control plane: the Next.js dashboard, Fastify API, analysis worker, PostgreSQL, Redis, Nginx edge, Prometheus, Alertmanager, and Grafana. Dokploy terminates HTTPS with Traefik and routes the public domain to the internal Nginx service.

Optional VPS SSH/MySQL/Redis telemetry is documented in [`docs/network-sensor.md`](docs/network-sensor.md). It is disabled by default and must not be enabled until the shared-VPS firewall, port, backup, capacity, and website-health gates pass.

Use the dedicated [`docker-compose.dokploy.yml`](docker-compose.dokploy.yml). Do not deploy only the `web` service and do not use the standard `docker-compose.yml`, which expects host ports and locally mounted TLS certificates.

## Deployment shape

```text
Internet
   |
Dokploy / Traefik (HTTPS and certificate)
   |
nginx:8080
   |-- /v1/* and /health/* --> api:4000
   `-- everything else ----> web:3000

api and worker --> PostgreSQL + Redis
worker ---------> Hugging Face and optional Telegram
```

Only `nginx` receives a public Dokploy domain. PostgreSQL, Redis, the API, worker, monitoring services, and dashboard container do not publish host ports.

## 1. Prerequisites

- A Dokploy server with Docker Compose deployments enabled.
- Ubuntu 24.04 or another supported Linux host.
- At least 4 vCPU, 8 GiB RAM, and 80 GiB SSD for the controlled pilot.
- A real domain such as `security.example.com`.
- DNS `A` record pointing that domain to the Dokploy server. Add an `AAAA` record only when the server has working public IPv6.
- Inbound ports 80 and 443 allowed to Dokploy. Do not expose 3000, 4000, 4001, 5432, 6379, 9090, or 9093.
- A Git repository that Dokploy can access.
- A Hugging Face token and an immutable 40-character commit for the configured model.

Dokploy's native Compose domain management is the recommended routing method. Domain changes on a Compose deployment require a redeploy before Traefik applies them. See the official [Dokploy Compose guide](https://docs.dokploy.com/docs/core/docker-compose) and [Compose domains guide](https://docs.dokploy.com/docs/core/docker-compose/domains).

## 1A. Clean reset after exposed or lost credentials

Use this only when no deployment data must be retained. Deleting volumes permanently removes the PostgreSQL database, Redis queue, Grafana state, Prometheus history, and Alertmanager state.

1. Revoke every externally managed credential that was exposed, especially the old Hugging Face token.
2. Delete the old Compose service in Dokploy and enable **Delete volumes** in the confirmation. Dokploy's Compose deletion API models this as `deleteVolumes: true`; deleting only containers is not a clean reset.
3. Remove any old `smarthoneyai.xyz` domain entry still attached to another Dokploy application or Compose service.
4. Create a new Compose service. Do not reuse the previous environment block.
5. Generate a fresh environment as described below and store its persistent values in a password manager.

If any data must be retained, stop here and perform a credential migration instead of deleting volumes.

## 2. Generate the environment

Run this from a trusted local checkout:

```bash
printf 'Hugging Face token: '
read -s HF_TOKEN
printf '\n'
export HF_TOKEN
node scripts/generate-dokploy-env.mjs \
  --domain security.example.com \
  --admin-email admin@example.com
unset HF_TOKEN
```

Enter the newly issued Hugging Face token at the silent prompt. The command reads it only from an environment variable, never from a command-line argument that would be retained in shell history. It prints a complete environment block with unique database, Redis, session, agent-encryption, policy-signing, Grafana, platform-administrator, and Hugging Face settings, plus blank optional SMTP settings. It does not write the secrets to disk.

To enable password-reset email delivery, also read and export `SMTP_PASSWORD` and pass `--smtp-host`, `--smtp-user`, and `--smtp-from` together. Invitations use manual one-time share links instead. Use `--smtp-port 465` when the provider requires implicit TLS instead of port `587`.

Before using the output:

1. Save `PLATFORM_ADMIN_PASSWORD` in a password manager.
2. Confirm `HF_MODEL_REVISION=c2040e8a2599abd2925fdc716cf40e8052d56ec4`, which pins the configured model to the reviewed immutable revision.
3. Confirm `APP_URL` is the exact canonical public origin with no trailing slash.
4. Set `PLATFORM_ORGANIZATION_NAME` and `PLATFORM_ORGANIZATION_SLUG` to the real initial workspace identity.
5. If password-reset email is enabled, confirm the emitted SMTP host, user, sender, and port match the identity verified with your provider. Telegram remains optional.

Paste the generated block without adding manual connection URLs. In particular, do not add `API_URL`, `DATABASE_URL`, `REDIS_URL`, or `NEXT_PUBLIC_API_URL`. The Compose file fixes the browser API path at `/v1` and constructs PostgreSQL and Redis URLs from private Docker service names. `APP_URL` must be exactly the public HTTPS origin, for example `https://smarthoneyai.xyz`, with no `:3000`, `:4000`, path, or trailing slash. `TRAEFIK_HOST` must be the same hostname without `https://` or a path.

An annotated template is available at [`.env.dokploy.example`](.env.dokploy.example). Never commit a completed environment file or paste the secrets into deployment logs, tickets, or chat.

Important persistent secrets:

- `AGENT_SIGNING_SECRET` encrypts stored WordPress-agent credentials. Changing it without a credential migration breaks enrolled agents.
- The Ed25519 policy key pair is pinned by enrolled plugins. Changing it requires an explicit key-rotation and plugin re-enrollment procedure.
- Changing `POSTGRES_PASSWORD` in Dokploy does not automatically change the password inside an existing PostgreSQL volume.

`PLATFORM_ADMIN_EMAIL` and `PLATFORM_ORGANIZATION_SLUG` are also persistent deployment identities. Keep both values unchanged after the first successful bootstrap. Changing either value in Dokploy does not rename an existing record: it creates an additional platform administrator or workspace. Perform identity changes through an explicit, audited database migration instead of editing these environment values.

## 3. Create the Dokploy Compose service

In Dokploy:

1. Create a project and production environment.
2. Add a service of type **Compose**.
3. Select **Docker Compose**, not Docker Stack.
4. Select the Git provider, repository, and production branch.
5. Set **Compose Path** to:

   ```text
   ./docker-compose.dokploy.yml
   ```

6. Open **Environment** and paste the completed environment block.
7. In **Advanced**, leave **Isolated Deployments** off. This Compose file explicitly attaches only Nginx to the shared `dokploy-network` and tells Traefik to use that network.
8. Do not configure a custom Compose command, published ports, mounts, or raw `DATABASE_URL`/`REDIS_URL` values.
9. Save the service.

The Compose file references every required environment variable explicitly. Dokploy writes the UI values to its deployment `.env` file, and Compose injects only the variables assigned to each container.

## 4. Configure the public domain

Open the Compose service's **Domains** tab and add:

| Setting | Value |
| --- | --- |
| Host | `security.example.com` |
| Service | `nginx` |
| Container port | `8080` |
| Path | `/` |
| Internal path | `/` |
| Strip path | Off |
| HTTPS | On |
| Certificate | Let's Encrypt |

Do not route the domain directly to `web:3000`. That would bypass the Nginx `/v1/*` routing and recreate the frontend-only deployment problem.

Use one canonical hostname matching `APP_URL`. If `www` or another hostname is required, redirect it to the canonical hostname instead of serving authenticated requests on two origins.

Click **Preview Compose** and verify:

- The domain labels are on service `nginx`, never `web`.
- Nginx is attached to both `app` and `dokploy-network`.
- `traefik.docker.network` resolves to `dokploy-network`.
- The load-balancer port is `8080`.
- No database, Redis, API, worker, or monitoring port is published on the host.

Redeploy after adding or changing a Compose domain.

## 5. Deploy

Click **Deploy**. A first deployment builds three application images and starts services in this order:

1. PostgreSQL and Redis become healthy.
2. `migrate` applies committed Prisma migrations.
3. `bootstrap` creates the production platform administrator without demo events.
4. API, worker, and web become healthy.
5. Nginx starts accepting Traefik traffic.
6. Prometheus, Alertmanager, and Grafana start internally.

Both `migrate` and `bootstrap` are one-shot services. An `Exited (0)` state for those two services is correct. All other services should be running and healthy.

The first image build may take several minutes. If deployment fails, inspect the first unhealthy or failed service rather than repeatedly redeploying the whole stack.

## 6. Verify the control plane

Replace the hostname in these commands:

```bash
curl --fail --silent --show-error \
  https://security.example.com/health/live

curl --fail --silent --show-error \
  https://security.example.com/health/ready

curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://security.example.com/v1/auth/me
```

Expected results:

- `/health/live`: HTTP 200 with API service status.
- `/health/ready`: HTTP 200 with PostgreSQL and Redis ready.
- `/v1/auth/me`: HTTP 401 while logged out. A 404 means the domain is routed to the wrong service or port.

Open `https://security.example.com/login` and sign in with `PLATFORM_ADMIN_EMAIL` and the generated `PLATFORM_ADMIN_PASSWORD`.

The bootstrap password creates a new administrator only on the first clean database initialization. To deliberately reset an existing administrator to `PLATFORM_ADMIN_PASSWORD`, set `RESET_PLATFORM_ADMIN_PASSWORD=1`, redeploy once, confirm login, then immediately return it to `0` and redeploy. Leaving the flag enabled would reset the password on every deployment.

Also verify that the response certificate matches the domain and that HTTP redirects to HTTPS:

```bash
curl --head http://security.example.com/
curl --head https://security.example.com/
```

## 7. Connect the WordPress plugin

Package the plugin from a trusted checkout:

```bash
sh scripts/package-wordpress-plugin.sh
```

Then:

1. Install the generated ZIP in WordPress.
2. In SmartHoneyAI, create a site using the exact public WordPress URL.
3. Copy the one-hour enrollment token.
4. In WordPress, open **Settings → SmartHoneyAI**.
5. Set the control-plane URL to `https://security.example.com`.
6. Paste the enrollment token and enroll.
7. Click **Sync now** if the first heartbeat has not appeared after five minutes.

The platform should show:

- Site connection: `ONLINE`
- Four synchronized inert honeypots
- Policy state: `SYNCHRONIZED`
- Policy acknowledgement: `APPLIED`

New sites remain in `OBSERVE` for seven days. Firewall rules are distributed during policy polling, but they produce real 403/429 responses only after the site is deliberately moved to `ENFORCE`.

## 8. Integration configuration

### Hugging Face

The production worker requires:

- `HF_TOKEN`
- `HF_MODEL_ID`
- `HF_MODEL_REVISION` pinned to an immutable 40-character commit

Provider failure leaves assessments pending or unavailable and never creates an automatic firewall block.
The read-only dashboard analyst falls back to a clearly labeled deterministic evidence summary when chat inference is missing, times out, or fails. This fallback does not replace the worker provider used for queued threat classification.

### SMTP

SMTP is optional and is used only for password-reset email. Invitations return a one-time fragment URL and ready-to-share text directly to the authorized operator. Leave `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` blank to disable password-reset delivery; the API remains healthy. To enable SMTP, configure all four values together. Public production rejects partial or placeholder SMTP configuration, verifies the connection at startup, and enforces TLS 1.2 or newer.

### Telegram

`TELEGRAM_BOT_TOKEN` is optional. Leave it empty unless an approved Telegram alert channel is configured.

### Monitoring

Prometheus, Alertmanager, and Grafana are internal-only. Do not add a public Dokploy domain to them. The committed Alertmanager receiver logs alerts but does not notify an external operator until a receiver is configured.

## 9. Persistence and backups

The Dokploy Compose deployment uses named volumes:

- `postgres_data`
- `redis_data`
- `prometheus_data`
- `alertmanager_data`
- `grafana_data`

Configure Dokploy Volume Backups for the named volumes and maintain a separate database-consistent PostgreSQL dump. Store backups off-host and encrypt them. Keep a separately encrypted copy of these environment secrets, especially the agent-encryption and policy-signing keys.

Before enabling automatic updates:

1. Complete a PostgreSQL restore drill.
2. Confirm the restored deployment has the same persistent signing keys.
3. Confirm an existing plugin accepts a newly issued policy.

## 10. Updating and rollback

For a normal update:

1. Back up PostgreSQL and the Dokploy environment.
2. Deploy a reviewed Git commit or tag.
3. Wait for `migrate` and `bootstrap` to exit successfully.
4. Repeat the readiness and unauthenticated API checks.
5. Confirm an enrolled staging WordPress site remains online and acknowledges a policy.

For rollback, select the previous known-good commit in Dokploy and redeploy only when its migrations are backward compatible. If a release requires an incompatible schema change, restore the matching database backup rather than manually reversing migrations.

## Troubleshooting

### The domain shows `404 page not found`

- Confirm the domain targets service `nginx`.
- Confirm the container port is `8080`.
- Redeploy after changing the domain.
- Confirm the DNS record points to the Dokploy server.
- Check for another Dokploy service claiming the same host and path.

### The homepage works but `/v1/auth/me` is 404

The domain is probably routed directly to `web:3000`. Change it to `nginx:8080` and redeploy.

### Traefik returns 502 or 503

- Confirm the domain entry's **Service** is `nginx`; changing only the port while leaving service `web` produces a 502 on port 8080.
- Confirm the domain's **Container port** is `8080`.
- In Preview Compose, confirm Nginx has `traefik.docker.network: dokploy-network` and is attached to that network.
- Check the `nginx`, `web`, and `api` health states.
- Inspect the `migrate` and `bootstrap` logs first.
- Confirm all required environment values are present.
- Confirm the Hugging Face revision is exactly 40 hexadecimal characters.

From the running API container, these internal checks must both return HTTP 200:

```bash
node -e 'fetch("http://127.0.0.1:4000/health/ready").then(r=>console.log(r.status))'
node -e 'fetch("http://nginx:8080/nginx-health").then(r=>console.log(r.status))'
```

If both are 200 but the public domain is 502, the fault is exclusively the Dokploy domain service/port/network selection.

### API fails with policy-key validation

Regenerate a matching Ed25519 pair with the environment generator. Never combine a private key from one generator run with a public key from another.

### The plugin cannot enroll

- Confirm `/v1/auth/me` returns 401 rather than 404 while logged out.
- Confirm the WordPress URL exactly matches the site registered in SmartHoneyAI.
- Confirm WordPress trusts the public certificate.
- Confirm server clocks are synchronized with NTP.
- Enrollment tokens expire after one hour and are single-use.

### Firewall rules appear but do not block

- Confirm the site has completed the observation period.
- Confirm its mode is `ENFORCE`.
- Confirm the plugin reports an unexpired `APPLIED` policy.
- Private, loopback, link-local, reserved, invalid, cron, WordPress-admin, and logged-in administrator requests intentionally remain protected from blocking.
