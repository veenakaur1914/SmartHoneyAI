# SmartHoneyAI

SmartHoneyAI is an invite-only, multi-tenant control plane for WordPress honeypot monitoring and application-layer policy enforcement. A WordPress plugin captures suspicious decoy traffic, sends signed event batches to the platform, and applies signed cached policies locally. The central Node.js services provide investigation, AI-assisted classification, incident visibility, policy control, and administration.

This repository targets a hardened live pilot of up to 50 WordPress sites. It is not a network firewall, malware sandbox, SSH honeypot, or high-availability enterprise service.

## Repository map

- `apps/web`: Next.js marketing site and tenant dashboard.
- `apps/api`: Fastify control-plane and agent API.
- `apps/worker`: BullMQ asynchronous analysis and notification worker.
- `packages/contracts`: shared Zod wire contracts.
- `packages/database`: Prisma schema, migrations, and empty-workspace bootstrap.
- `plugins/wordpress`: WordPress sensor and enforcement agent.
- `monitoring`: Prometheus alerts, Alertmanager, and Grafana provisioning.
- `scripts`: deployment, health, encrypted backup, and restore helpers.
- `docs`: architecture, security, privacy, API, deployment, and operator runbooks.

## Run locally with Docker

This is the recommended way to run the complete product locally because it starts the same services used by the deployable stack: Nginx, Next.js, Fastify API, BullMQ worker, PostgreSQL, Redis, Prometheus, Grafana, and Alertmanager.

Requirements: Docker Engine with Compose v2, Node.js 22.22.3+ for secret/key generation, and `openssl`.

1. Create local configuration:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` for local HTTPS:

   ```env
   APP_URL=https://localhost
   HTTP_PORT=80
   HTTPS_PORT=443
   PLATFORM_ADMIN_EMAIL=admin@smarthoneyai.xyz
   HF_MODEL_REVISION=0000000000000000000000000000000000000000
   ```

   The all-zero model revision is acceptable only for a local demo. Use a real immutable Hugging Face commit in production.

3. Generate local secrets and a 30-day self-signed certificate:

   ```bash
   GENERATE_SELF_SIGNED_TLS=1 DOMAIN=localhost sh scripts/init-secrets.sh
   ```

4. Build and start the stack:

   ```bash
   docker compose config --quiet
   docker compose up --build -d
   ```

5. Bootstrap the local administrator and an empty workspace:

   ```bash
   docker compose run --rm \
     -e APP_COMMAND=prisma:seed \
     -e PLATFORM_ADMIN_PASSWORD='ChangeThisDemoPassword123!' \
     migrate
   ```

6. Open the app:

   - App: `https://localhost`
   - Login: `admin@smarthoneyai.xyz`
   - Password: `ChangeThisDemoPassword123!`
   - Health: `https://localhost/health/ready`

Your browser will warn about the self-signed local certificate. That is expected for local evaluation.

Useful local commands:

```bash
docker compose ps
docker compose logs -f web api worker nginx
docker compose down
docker compose down -v   # stop and delete local databases/queues/monitoring data
```

If you want Hugging Face AI classification locally, put a valid token in `secrets/hf_token` and replace `HF_MODEL_REVISION` in `.env` with the pinned model commit you evaluated. The read-only analyst remains usable without the chat provider by returning a clearly labeled deterministic evidence summary; queued event classification still requires the configured worker provider.

## Isolated local WordPress honeypot demo

The E2E overlay starts an independently named `honeypot-ai-e2e` Compose project with WordPress 6.8.2, WP-CLI 2.12.0, and MariaDB 11.4.12. It does not reuse or delete the default Compose project's volumes. Platform HTTP/HTTPS and WordPress are loopback-bound; the databases, Redis, APIs, worker, and monitoring services remain internal.

Requirements: Docker Desktop or Docker Engine with Compose v2, Node.js 22.22.3+, and `openssl`.

```bash
pnpm demo:local:up
pnpm demo:local:e2e
pnpm demo:attack:wordpress
pnpm demo:attack:docker
pnpm demo:bot-simulation
```

The setup provisions WordPress, activates the plugin, enrolls the local site, installs a local-only synthetic-source MU-plugin, and stores generated credentials in `secrets/e2e/credentials.txt` with owner-only permissions. The full E2E command records machine-readable results under `output/e2e/<timestamp>/` and leaves the enrolled site in `OBSERVE` mode.

- Platform: `https://localhost`
- WordPress: `http://localhost:8080`
- Readiness: `https://localhost/health/ready`

The generated certificate is valid only for `localhost` and `host.docker.internal`. WordPress trusts that exact mounted public certificate; TLS verification is not disabled. The synthetic source override is additionally gated by `WP_ENVIRONMENT_TYPE=local`, a loopback request, and the generated local secret, and is excluded from plugin release ZIPs.

`demo:bot-simulation` runs a harmless, timestamped credential-stuffing and reconnaissance campaign against all four decoys, demonstrates temporary OBSERVE/ENFORCE firewall behavior plus real 403/429 responses, writes JSON and Markdown evidence under `output/`, and always returns the demo to OBSERVE with no active test rules.

The two `demo:attack:*` commands are dry-run by default. Add `-- --execute` to run their fixed loopback-only targets. Each script first requires a named Telegram provider test with status `SENT`, then separately verifies attack-generated worker delivery. The normal-hosting script verifies WordPress detection, a repeat-attacker 403, signed upload, Telegram delivery, and cleanup. The Docker script additionally starts the standalone OpenCanary bundle, probes SSH/MySQL/Redis, verifies a correlated CRITICAL incident, checks Telegram incident and blocked-access messages, applies and removes its own 24-hour WordPress containment rule, and restores the previous enforcement mode. See the [client sensor demonstration guide](docs/client-sensor-demo-guide.md).

To demonstrate the live repeat-honeypot block on the authorized Bank Oyen demo, open the interactive Python CLI or run its real attack presentation directly:

```bash
pnpm demo:trigger-honeypots
pnpm demo:trigger-honeypots run --yes
pnpm demo:trigger-honeypots attack-types --yes
```

The target is intentionally hard-coded to `https://demo.finalyearproject.my` with no target override. The CLI prints a `3… 2… 1…` countdown, makes real HTTPS requests, verifies the exact inert SmartHoneyAI response rather than accepting an ordinary WordPress 404, stops only after SmartHoneyAI's exact automation 403, and confirms that plain `/` is blocked too. Running it intentionally blocks the current public source address for 24 hours. `attack-types` submits safe synthetic POST evidence to the SQL injection, XSS, and command injection decoys in that order, allowing all three classified incidents and Telegram alerts to be queued before the fourth request proves containment. It then waits for the plugin's scheduled spool job and wakes WordPress cron so those events are sent to the control plane without depending on later visitor traffic. Presentation-only paths can be managed with `list`, `add`, `remove`, and `reset`; the normal run follows all 15 built-ins in dashboard order but the mandatory three-route threshold intentionally prevents one source from reaching every route in one run. Adding a path changes the crawler list and does not create a WordPress honeypot deployment, so add and synchronize the same custom route in the SmartHoneyAI dashboard and pass `run --custom-first` when you want custom paths exercised before the block threshold. Use `run --help` for delay, endpoint-limit, timeout, delivery-wait, and dry-run options.

For the isolated 90-minute production-style campaign (one real WordPress agent, 49 signed synthetic agents, k6 load, fault recovery, Playwright evidence, and a verified PDF report), run:

```bash
pnpm demo:production-simulation
```

This stops the E2E project without deleting its volumes, runs the separate `honeypot-ai-perf` project, returns the tested site to `OBSERVE` with no active rules, deletes the performance volumes, and restores the original E2E services. Timestamped evidence is written under `output/performance/`; the executive and technical PDF is written under `output/pdf/`. The orchestration enforces host-memory, Docker-memory, OOM, restart, readiness, and sustained-error abort guards.

Teardown removes only the isolated demo containers and volumes:

```bash
docker compose -p honeypot-ai-e2e \
  -f "$PWD/docker-compose.yml" \
  -f "$PWD/docker-compose.wordpress-demo.yml" \
  down --volumes --remove-orphans
```

## Local Node development

Requirements: Node.js 22.22.3+, pnpm 10.34.4, PostgreSQL 17, and Redis 8.

```bash
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Use this path when you are actively editing code and want hot reload. You must provide your own PostgreSQL and Redis instances matching `DATABASE_URL` and `REDIS_URL` in `.env`. Replace every example secret before using real data. The web app defaults to `http://localhost:3000` and the API to `http://localhost:4000`.

## Docker deployment

The production Compose deployment exposes only Nginx on ports 80 and 443. Application, data, queue, and monitoring containers have no host port bindings.

On a server:

```bash
cp .env.example .env
sh scripts/init-secrets.sh
docker compose config --quiet
sh scripts/deploy.sh
```

Before production deploy, set `APP_URL` to the real HTTPS origin; set the persistent `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ORGANIZATION_NAME`, and `PLATFORM_ORGANIZATION_SLUG` identities; pin `HF_MODEL_REVISION` to an immutable Hugging Face commit; copy trusted TLS files to `secrets/tls/fullchain.pem` and `secrets/tls/privkey.pem`; fill `secrets/hf_token`; and remove every placeholder or example value from `.env`. SMTP and Telegram are optional. Invitations are generated as one-time links with ready-to-share text and do not use SMTP. When SMTP is disabled, leave all SMTP environment values and `secrets/smtp_password` blank; password-reset email delivery is unavailable without preventing API startup. When SMTP is enabled, all four SMTP values are required and verified at startup with TLS. `scripts/deploy.sh` refuses to run when required values or obvious example values remain.

After deployment, create the first administrator with a strong one-time password:

```bash
docker compose run --rm \
  -e APP_COMMAND=prisma:seed \
  -e PLATFORM_ADMIN_PASSWORD='replace-with-a-long-random-password' \
  migrate
```

This bootstrap creates the platform administrator and an empty workspace configured by `PLATFORM_ORGANIZATION_NAME` / `PLATFORM_ORGANIZATION_SLUG`. It has no runtime fixture mode and never creates sites, events, incidents, alerts, reports, or metrics. Do not reuse the local test password in production. Full host hardening, TLS, monitoring, backup, rollback, and Dokploy guidance is in the [deployment guide](docs/deployment.md).

Treat `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ORGANIZATION_SLUG` as immutable bootstrap identities after the first successful deployment. Rename or rotate them only through an explicit, audited data migration; changing either environment value creates a separate administrator or workspace.

### Dokploy deployment

Dokploy must deploy the complete Compose application, not only the Next.js web service. Use [`docker-compose.dokploy.yml`](docker-compose.dokploy.yml), let Dokploy/Traefik terminate TLS, and route the public domain to service `nginx` on container port `8080`.

Follow the complete [Dokploy deployment guide](DOKPLOY.md) for environment generation, domain settings, first deployment, WordPress enrollment, verification, backups, updates, and troubleshooting.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm guard:production-fixtures
docker compose config --quiet
```

After bootstrapping the local administrator, the control-plane smoke test exercises login, site creation, agent enrollment, HMAC ingestion, redaction, signed policy verification, heartbeat, and dashboard aggregation:

```bash
NODE_EXTRA_CA_CERTS=secrets/tls/fullchain.pem BASE_URL=https://localhost \
  APP_ORIGIN=https://localhost pnpm smoke:control-plane
```

The smoke client trusts only the generated local certificate; TLS verification remains enabled.

CI also validates PHP syntax/tests, Nginx, Prometheus, Alertmanager, Grafana JSON, container builds, secrets, dependencies, and infrastructure misconfiguration.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Security model](docs/security.md)
- [Operations and disaster recovery](docs/operations.md)
- [API and WordPress plugin guide](docs/api-and-plugin.md)
- [Privacy and Malaysia PDPA notes](docs/privacy-pdpa.md)
- [Threat model](docs/threat-model.md)
- [FYP demonstration runbook](docs/demo-runbook.md)
- [Client sensor demonstration guide](docs/client-sensor-demo-guide.md)

## Responsible use

Deploy inert decoys only on sites you own or are explicitly authorized to administer. Do not expose real shells or databases, execute submitted content, collect credentials, or use captured traffic for retaliation. AI output is advisory and can be unavailable or wrong; permanent blocks always require human judgment.
