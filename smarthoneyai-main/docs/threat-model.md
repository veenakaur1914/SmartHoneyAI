# Threat model

## Assets and security objectives

Critical assets are tenant telemetry, full source IPs, account sessions, password hashes, site-agent secrets, the policy-signing private key, firewall policies, audit integrity, SMTP/Telegram credentials, backups, and platform availability. The main objectives are strict tenant isolation, trustworthy policy delivery, minimized evidence, fail-open WordPress availability, and attributable administrative changes.

## Actors

- Internet attackers probing connected WordPress sites or the public SaaS.
- A malicious or compromised tenant user attempting cross-tenant access.
- A compromised WordPress administrator/plugin installation.
- A compromised dependency, image, AI/alert provider, or operator workstation.
- An honest user making a dangerous policy mistake.

## Key threats and controls

| Threat | Primary controls | Required verification |
|---|---|---|
| Cross-tenant IDOR | Server-derived organization scope, role checks, tenant foreign keys, audited platform-admin path | Attempt every resource ID from another tenant for each role |
| Session theft/fixation | Opaque hashed tokens, Secure/HttpOnly/SameSite cookies, rotation/revocation, CSP/HSTS | Cookie and session lifecycle tests; no browser storage token |
| Password attack | Argon2id, 15-character minimum, breached-password screening, progressive throttle | Credential stuffing and reset-token tests |
| CSRF | Exact-origin checks, SameSite cookie, explicit token when needed | Cross-origin form/fetch tests for all mutations |
| Stored XSS from evidence | Sanitization, length caps, text-only rendering, CSP | Store polyglot payloads in every captured field and open all views/exports |
| Forged/replayed plugin traffic | Per-site HMAC key, timestamp, nonce, body hash, idempotency, rotation/revocation | Modified body, old timestamp, repeated nonce/key, wrong site, revoked key |
| Forged or rollback policy | Ed25519 signature, pinned key, site/version/expiry validation, atomic cache | Tamper, wrong site/key, expired and lower-version policy tests |
| Central outage breaks WordPress | No synchronous control-plane calls, bounded spool, cached policy, monitor-only expiry | Block API/DNS/Redis and load-test WordPress |
| Malicious payload reaches AI/Telegram/logs | Recursive redaction, strict allowlist, caps, safe alert template, logger redaction | Canary secrets in headers/body never leave local boundary |
| AI false positive blocks users | Seven-day observe mode, correlation, 0.95 confidence, shadow evaluation, allowlist precedence, short TTL, kill switch | Benign corpus precision gate and rollback drill |
| SSRF through site/webhook URLs | HTTPS policy, DNS/IP validation, redirect recheck, timeouts, no metadata/private ranges | DNS rebinding, redirects, IPv4/IPv6 private/metadata tests |
| Resource exhaustion | 1 MiB/500-event caps, rate/connection limits, quotas, queue backpressure, container limits | 25/s sustained, 100/s burst, oversized/slow request tests |
| Database/backup exposure | Private network, file secrets, encryption with off-host key, least-privilege host access | External port scan, backup decrypt/restore authorization test |
| Supply-chain compromise | Lockfile, pinned images, review, dependency/secret/Trivy scans, SBOM/release provenance | CI gate and scheduled rebuild/scans |
| Destructive operator error | Preview, RBAC, expiry, audit, backups, versioned releases and rollback | Restore drill and policy kill-switch exercise |

## Abuse boundaries

Honeypots are inert HTTP decoys only. The system must not provide real SSH/database services, malware execution, remote shells, arbitrary PHP/shell/rules, unrestricted regular expressions, credential collection, active counterattack, source deanonymization, or public shaming. Decoy pages must not clone third-party brands.

## Residual risks

- Password-only login remains susceptible to phishing; MFA is required before general launch.
- One-host deployment can fail as a unit and does not satisfy high-availability requirements.
- A fully compromised WordPress administrator can read plugin configuration and falsify local observations until its credential is revoked.
- Source IP attribution may be wrong behind untrusted proxies; only honor forwarding headers from configured trusted proxies.
- AI classification is probabilistic and provider availability is external.
- PostgreSQL row-level security must be enabled and exercised if declared as a defense; application scoping alone remains a single-control risk.

Review this model for every new data source, rule type, provider, CMS integration, or authentication method.

