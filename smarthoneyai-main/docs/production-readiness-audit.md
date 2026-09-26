# SmartHoneyAI Production Readiness Audit

Audit date: 17 July 2026  
Target: `https://smarthoneyai.xyz`  
Release profile: controlled production pilot, approximately 50 WordPress sites  
WordPress plugin: SmartHoneyAI Agent 1.0.0

## Executive decision

The reviewed application and plugin are release-candidate ready for a controlled production pilot after the infrastructure prerequisites in this report are supplied. The repository builds from clean containers, the integrated control plane and a real WordPress 7.0 installation pass the security workflow, and the tested runtime images have no known High or Critical vulnerabilities.

The production deployment is intentionally **blocked** at the hosting gate. The Hostinger account has an active shared/cloud hosting plan for `smarthoneyai.xyz`, but the Hostinger VPS inventory is empty. The application requires Docker Compose, PostgreSQL, Redis, a persistent worker, private service networks, and durable volumes. The existing shared Node deployment serves the website but does not provide the control-plane API: `/v1/auth/me` returns HTTP 404. Deploying only the new frontend would therefore produce a misleading and incomplete release.

No purchase, destructive hosting change, DNS cutover, or replacement of the existing public site was performed.

## Scope

The audit covered:

- Next.js web application and readiness behavior.
- Fastify API authentication, tenant authorization, CSRF defenses, enrollment, signed policies, events, invitations, password reset, rate limiting, and mail delivery.
- BullMQ worker configuration, classifier selection, alert delivery, and shutdown behavior.
- Prisma schema, migration path, production seed behavior, PostgreSQL, and Redis.
- Docker images, Compose topology, reverse proxy, TLS preflight, secret injection, monitoring, and runtime privileges.
- WordPress plugin enrollment, redaction, local queueing, signed policy validation, firewall behavior, fail-open operation, uninstall behavior, coding standards, tests, and reproducible packaging.
- Dependency, filesystem, Git history, container-image, and browser checks.
- Hostinger VPS inventory and public endpoint behavior.

The worktree contained ongoing product changes before this audit. Audit changes were applied without resetting, discarding, staging, committing, or overwriting unrelated work.

## Material findings remediated

### Critical and high-risk controls

- Replaced the frontend-only readiness response with a real API dependency check that returns HTTP 503 when the API is unavailable.
- Added production validation for HTTPS application origin, non-placeholder session and agent secrets, and a matching Ed25519 policy-signing keypair.
- Restricted trusted proxy handling to loopback and private reverse-proxy ranges so client IPs, sessions, and rate limits are not collapsed onto the Nginx address.
- Added exact Origin/Referer validation for cookie-authenticated state changes.
- Normalized enrolled site URLs and rejected credentials, query strings, fragments, non-root paths, and non-HTTPS public targets. Local addresses require explicit development authorization.
- Made password-reset and invitation tokens single-use through atomic database claims. Invitation acceptance no longer overwrites an existing user's password.
- Escaped outbound mail content and disabled file and URL access in the mail transport.
- Required immutable Hugging Face revisions and runtime-provided tokens in production. Local analysis now requires an explicit opt-in.
- Removed the Telegram bot token from database configuration; it can only be supplied as a runtime secret.
- Required safe production administrator seeding and disabled demo data unless explicitly requested.
- Enforced certificate hostname and remaining-lifetime checks in deployment preflight.
- Bounded WordPress signed-policy lifetime, timestamp skew, value formats, routes, IP/CIDR values, user-agent patterns, countries, and rate-limit syntax.
- Prevented a policy version from being reused with different signed content and required expiry for enforcing rules.
- Removed demo credentials from the ignored production web environment file. If those values were ever reused outside local development, rotate them.

### Reliability and release engineering

- Fixed the minimized migration image so migrations and seeds execute without shipping npm, pnpm, Corepack, or Yarn in the runtime image.
- Made local WordPress validation explicitly use the authorized local classifier while keeping production fail-closed requirements.
- Added Prisma client generation to installation and ordered build, lint, and type-check tasks to eliminate clean-CI races.
- Reduced dashboard polling to 15 seconds and paused it while the tab is hidden.
- Corrected server-sent event connection handling and heartbeat flushing.
- Added bounded pagination/search inputs, surfaced alert outcomes, and replaced invitation mail delivery with operator-shared one-time links.
- Updated the Node and pnpm baselines, upgraded vulnerable transitive packages, removed the duplicate npm lockfile, ignored generated artifacts, and reduced the Docker build context to approximately 614 KB.
- Promoted the WordPress plugin to 1.0.0, added a lockfile, applied WordPress coding standards, and produced a deterministic release ZIP.

## Verification evidence

| Gate | Result |
| --- | --- |
| Clean forced workspace lint, type-check, test, and build | PASS - 19/19 tasks |
| API unit tests | PASS - 16/16 |
| Worker unit tests | PASS - 3/3 |
| WordPress PHPUnit on WordPress 7.0 and PHP 8.3 | PASS - 23 tests, 158 assertions |
| WordPress PHPCS | PASS - 9/9 source files |
| WordPress PHP syntax | PASS |
| pnpm production dependency audit | PASS - no known vulnerabilities |
| Trivy filesystem scan | PASS - no High/Critical or secret findings |
| Trivy runtime image scans | PASS - API, worker, web, and migrator each reported 0 High/Critical vulnerabilities |
| Git history secret scan | PASS - no findings in the repository history |
| Production and WordPress demo Compose validation | PASS |
| Clean container build | PASS - all four application images |
| Integrated WordPress security workflow | PASS |
| Playwright desktop home, login, dashboard, and API readiness | PASS - no dashboard console errors |
| Plugin ZIP integrity and reproducibility | PASS |

Integrated evidence is stored in `output/e2e/production-audit-20260717/`. Browser evidence is stored in `output/playwright/`.

The integrated run verified database-backed login, WordPress enrollment, four inert honeypot routes, exact-once delivery, redaction, signed policies, observe-first enforcement, IP and CIDR denial, user-agent denial, atomic rate limiting, allowlist precedence, expired-policy monitor-only behavior, API outage spooling and recovery, Redis replay fail-closed behavior, and final ONLINE policy acknowledgement.

Release package:

- File: `output/releases/smarthoneyai-wordpress-1.0.0.zip`
- SHA-256: `6d373d97974ea27d128648f5f6af08e4c001d3d0fcba7df0b0607917ab01b859`

## Hostinger deployment finding

Observed through Hostinger MCP and public endpoint checks:

- Domain and shared/cloud hosting are active.
- Hostinger VPS inventory: zero virtual machines.
- `http://smarthoneyai.xyz/`: HTTP 301 to HTTPS.
- `https://smarthoneyai.xyz/`: HTTP 200.
- `https://smarthoneyai.xyz/v1/auth/me`: HTTP 404, confirming the control-plane API is not deployed.

The full release cannot run safely on the current shared deployment because it needs:

- One Linux VPS with Docker Engine and Docker Compose.
- PostgreSQL and Redis on private, non-public networks.
- Persistent volumes for PostgreSQL, Redis, Prometheus, Grafana, and Alertmanager.
- Long-running API and worker processes with health checks.
- TLS files and Docker secrets mounted at runtime.
- At least 8 GB RAM and 4 vCPU for the declared pilot topology; 8 vCPU is preferred for performance headroom.

## Required deployment inputs

Before running `scripts/deploy.sh`, an operator must provide:

1. A provisioned Hostinger VPS under this account. Purchasing a new service requires account-owner authorization.
2. DNS approval to point `smarthoneyai.xyz` and `www` to the VPS after staging verification.
3. A valid TLS certificate for `smarthoneyai.xyz` with at least seven days remaining.
4. Strong production session, agent-signing, database, Redis, Grafana, and administrator secrets.
5. A production Ed25519 signing keypair.
6. A pinned 40-character Hugging Face model commit plus token, or an explicitly approved alternative provider configuration.
7. Optional password-reset SMTP settings and, if used, a Telegram bot token.
8. Confirmed off-host backups and a completed restore drill.

After those inputs exist, deploy to the VPS, verify `/health/ready`, verify `/v1/auth/me` returns HTTP 401 rather than 404 without a session, complete the smoke tests, enroll a staging WordPress site, and only then perform DNS cutover.

## Residual launch gates

These do not block a controlled pilot on approved infrastructure, but they remain gates for broader commercial release:

- Enforce multi-factor authentication for privileged users.
- Complete an independent penetration test and remediate its findings.
- Exercise backup restoration and documented disaster recovery on the actual VPS.
- Configure external uptime monitoring and alert delivery outside the deployed stack.
- Establish a release owner, incident contact, key-rotation schedule, and maintenance window.

## Final status

**Code and plugin:** release-candidate ready for a controlled pilot.  
**Production infrastructure:** not ready because no compatible Hostinger VPS exists.  
**Public deployment:** not performed; the existing site was left unchanged to avoid an incomplete frontend-only release.
