# SmartHoneyAI Client Sensor Demonstration Guide

This runbook covers both supported client packages and the two safe attack demonstrations. SmartHoneyAI remains the control plane. OpenCanary runs only beside a Docker WordPress client, detects network decoy activity, and never blocks traffic. All blocking shown here is performed by the linked WordPress plugin.

## Package A: normal WordPress hosting

Use `smarthoneyai-wordpress-1.1.0.zip` for Hostinger, cPanel, shared hosting, managed WordPress, or any installation that can install a normal plugin and make outbound HTTPS requests.

1. In **Sites**, choose **Normal WordPress Hosting**, enter the owned WordPress URL, and create the site.
2. Download `smarthoneyai-wordpress-1.1.0.zip` and verify it against `SHA256SUMS`.
3. In WordPress, open **Plugins → Add New → Upload Plugin**, upload the ZIP, and activate **SmartHoneyAI**.
4. Confirm the plugin readiness checklist: PHP Sodium, outbound HTTPS, WP-Cron or an explicitly configured external runner, pretty permalinks, and the database queue.
5. Paste the SmartHoneyAI HTTPS control-plane URL and one-time enrollment token into **Settings → SmartHoneyAI**. Enroll once, then use **Sync now**.
6. In SmartHoneyAI **Settings → Telegram alerts**, generate the one-time command, send it to the intended Telegram group, verify the connection, and confirm the channel is **Active**. Press **Send test notification** and confirm the Telegram chat receives the delivery before running an attack demonstration.

Expected protection: WordPress decoy detection, signed telemetry, Telegram notifications, and WordPress application-layer blocking. It does not block another domain or the hosting server itself.

## Package B: Docker WordPress plus network sensor

Use `smarthoneyai-wordpress-docker-1.1.0.tar.gz` only when the client controls a Docker host. The archive includes the same plugin ZIP plus a standalone sensor Compose project.

1. Create the WordPress site as **Docker WordPress + Network Sensor** and install/enroll the included plugin ZIP as above.
2. Create a paired sensor module for that WordPress site. Copy the enrollment token once.
3. On the client Docker host, extract the archive and copy `.env.example` to `.env`.
4. Set the sensor name, one-time token, SmartHoneyAI HTTPS URL, exact authorized source-IP allowlist, and high ports `2222`, `13306`, and `16379`.
5. Configure the VPS/provider firewall to allow those ports only from the same authorized IP addresses. Keep `PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED=NO` until this is verified.
6. Change the confirmation to `YES`, then run:

   ```bash
   ./scripts/preflight.sh
   ./scripts/install.sh
   ./scripts/health.sh
   ```

7. Confirm **Sensor modules** shows `ONLINE`, agent `1.1.0`, services `SSH, MYSQL, REDIS`, queue `0`, dropped `0`, and a fresh heartbeat. Remove the enrollment token from `.env` after first boot.

The sensor Compose project uses separate ingress, internal, and egress networks. It never joins WordPress, database, Traefik, or Dokploy networks. The production archive contains no `DEMO_OVERRIDE` code.

## One-time local demonstration setup

Requirements: Docker Desktop/Engine with Compose v2, Node.js 22+, pnpm, and OpenSSL. Run from the repository root:

```bash
RESET_E2E=1 CI=true pnpm demo:local:e2e
```

Expected result: all 19 baseline E2E gates pass. The local targets are fixed to:

- control plane: `https://localhost:9443`
- WordPress: `http://localhost:8080`
- Telegram test API: `http://localhost:18099`

The local certificate is trusted explicitly by the test containers. The synthetic source header and `DEMO_OVERRIDE` attribution exist only in local test code and are excluded from both release packages.

## Attack script 1: normal hosting behavior

Preview the safety scope without changing state:

```bash
CI=true pnpm demo:attack:wordpress
```

Run the authorized loopback-only demonstration:

```bash
CI=true pnpm demo:attack:wordpress -- --execute
```

The script first requires a `SENT` Telegram provider test for the Normal WordPress Hosting scenario. It then sends harmless requests to `/phpmyadmin`, `/secure-admin-login`, and `/wp-content/backups/site-backup.zip`. The fourth decoy request must return `403`. It verifies exact-once queue drain, a separate `SENT` attack delivery from the worker, sanitized notification content, clears only its local demo buckets, and verifies `/` returns `200`.

Successful console markers:

- `PASS WordPress probes and local block ... fourth request: HTTP 403`
- `PASS Signed telemetry sync ... queue drained exactly once`
- `PASS Telegram provider test ... SENT`
- `PASS Telegram alert delivered ... SENT`
- `PASS Owned local cleanup ... HTTP 200`

Evidence is written to `output/demo/normal-hosting-demo.json` and `.md`.

## Attack script 2: Docker WordPress plus sensor

Preview:

```bash
CI=true pnpm demo:attack:docker
```

Run:

```bash
CI=true pnpm demo:attack:docker -- --execute
```

The script first requires a `SENT` Telegram provider test for the Docker WordPress + Network Sensor scenario. It then creates a 15-minute scoped self-test, starts an isolated loopback-only OpenCanary module, waits for real protocol responses, sends SSH banner, MySQL handshake, and Redis `PING` probes, and triggers one inert WordPress `/env` decoy. It requires a `CRITICAL` incident containing two assets and four protocols, verifies a separate critical Telegram alert from the worker, applies a self-test-owned 24-hour WordPress rule, verifies `403`, verifies a Telegram blocked-access message, removes only that rule, verifies `200`, stops the sensor, and restores the site's original enforcement mode.

Successful console markers:

- `PASS Telegram provider test ... SENT`
- `PASS Harmless network probes ... accepted 6 sanitized signals`
- `PASS Critical correlation ... CRITICAL severity`
- `PASS Incident Telegram delivered`
- `PASS 24-hour application containment ... HTTP 403`
- `PASS Blocked-access Telegram delivered`
- `PASS Scoped cleanup ... HTTP 200`

Evidence is written to `output/demo/docker-sensor-demo.json` and `.md`.

## Telegram interpretation

The local demo uses a loopback-bound mock of the Telegram Bot API so repeatable tests do not notify real people. It verifies the same API methods and sanitized message templates used in production. Production startup rejects a custom Telegram API origin and sends through `https://api.telegram.org` only.

Expected messages include:

- an explicit delivery test identifying the selected package scenario;
- connection confirmation;
- a high-risk or critical incident notification with site, threat, severity, masked source hash, and review URL;
- a blocked-access notification with request path, action, event ID, and review URL.

Passwords, submitted credentials, authorization tokens, cookies, Redis arguments, and raw OpenCanary login data must never appear in the spool, database, logs, AI requests, Telegram, or reports.

## Cleanup and rollback

Both attack scripts perform owned cleanup automatically, including on failure. To stop only the local acceptance stack:

```bash
docker compose -p honeypot-ai-e2e -f "$PWD/docker-compose.yml" -f "$PWD/docker-compose.wordpress-demo.yml" down
```

For a client Docker sensor, `./scripts/uninstall.sh` stops containers while preserving credentials and spool data. Purging the volume requires the separate `PURGE_SENSOR_DATA_CONFIRMED=YES` gate.

## Production verification — 4 September 2026 (MYT)

The full demonstration was repeated against the deployed control plane at `https://smarthoneyai.xyz` and the authorized Hostinger site `https://demo.finalyearproject.my`.

### Normal hosting result

- WordPress plugin 1.1.0 reported `ONLINE`, PHP Sodium/HTTPS/WP-Cron/permalinks/database queue all ready, queue `0`, dropped `0`.
- One inert `/database/query` request produced a `CRITICAL` SQL injection incident and a real Telegram delivery with status `SENT`.
- A test-owned 24-hour rule was synchronized as signed policy v171; the same source received HTTP `403`.
- Only that rule was disabled, the site returned to `OBSERVE`, policy v172 was acknowledged, and HTTP `200` returned.
- Evidence: `output/live-production/normal-hosting-live.json` and `normal-block-live.json`.

### Docker sensor result

- Local Docker agent 1.1.0 enrolled to production and showed `ONLINE`, services `SSH, MYSQL, REDIS`, queue `0`, dropped `0`.
- The live runner bound ports `2222`, `13306`, and `16379` to `127.0.0.1` only and sent one harmless probe to each.
- One inert Hostinger `/database/query` decoy and the three network signals shared the same hashed source. SmartHoneyAI produced one `CRITICAL` multi-sensor incident: `2 assets`, `4 protocols` (`SSH`, `MYSQL`, `REDIS`, `HTTP`).
- The scoped rule produced WordPress HTTP `403`, the policy acknowledgement was recorded, and blocked-access Telegram deliveries reached `SENT` through the official Telegram API.
- Cleanup disabled only the run-owned rule, restored HTTP `200`, removed every local sensor container/network/port binding, and preserved the enrolled credential volume.
- Evidence: `output/live-production/docker-hybrid-live.json`, `docker-telegram-live.json`, and `docker-telegram-provider-test.json`.

The production runner is intentionally fixed to the two authorized URLs, requires `--execute`, the exact `AUTHORIZED-HYBRID-TEST` phrase, and a 15-minute token file:

```bash
corepack pnpm self-test:sensors -- hybrid --execute \
  --target https://demo.finalyearproject.my \
  --control-plane https://smarthoneyai.xyz \
  --confirm AUTHORIZED-HYBRID-TEST \
  --token-file ./smarthoneyai-self-test-token.json \
  --evidence output/live-production/docker-hybrid-live.json
```

Production screenshots are under `output/playwright/live-production/`. They show plugin readiness, normal-hosting enforcement and cleanup, the paired sensor module, the four-protocol incident timeline, live telemetry, and Telegram `Active` state. The JSON evidence is authoritative for the automated `403 → cleanup → 200` and Telegram `SENT` assertions.
