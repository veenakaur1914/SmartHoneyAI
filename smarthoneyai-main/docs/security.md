# Security model

## Identity and authorization

- Browser authentication uses database-backed opaque sessions in `Secure`, `HttpOnly`, `SameSite=Lax` cookies. Tokens are stored hashed and can be revoked remotely.
- Passwords require at least 15 characters and use Argon2id. Production release requires common/breached-password rejection, progressive throttling, reset-token expiry, and session visibility tests.
- State-changing browser requests reject foreign origins. Sensitive flows must also use an explicit CSRF token if cross-origin integrations are introduced.
- Roles are Platform administrator, Owner, Admin, Analyst, and Viewer. Authorization is enforced server-side on every resource; hiding a UI control is not authorization.
- Tenant queries are scoped from the session. Cross-tenant identifiers return 404 where practical and all denied privileged operations are auditable.

Password-only authentication is a deliberate pilot limitation. MFA and an independent penetration test are release gates before broader commercial use.

## Agent authentication and policy integrity

- Enrollment tokens are one-time, short-lived, and domain-bound.
- Each WordPress site receives a distinct key ID and 256-bit-or-stronger secret. Rotate or revoke one site without affecting others.
- Agent requests include site ID, key ID, timestamp, random nonce, body SHA-256, and HMAC signature. Reject timestamps outside five minutes and duplicate nonces.
- Event idempotency keys prevent retries from duplicating stored evidence.
- Policies are versioned, expire within one hour, and are signed with a separately protected Ed25519 key. The plugin verifies signature, site ID, expiry, monotonic version, supported schema, and bounded rule count before atomic replacement.
- Failures preserve the last verified policy. Expired policy forces monitor-only behavior; WordPress remains available.

## Evidence minimization

Capture only suspicious honeypot/firewall events. Before storage and inference:

- Drop Cookie, Authorization, proxy-authorization, API-key, and authentication headers.
- Remove password, token, secret, credential, nonce, and session fields recursively.
- Limit headers to 16 KiB, payload excerpts to 32 KiB, paths to 2 KiB, and user agents to 1 KiB.
- Never store entered passwords, execute submitted code, or reproduce attacker-controlled HTML without escaping.
- Render evidence as text, never trusted markup, to prevent stored XSS in analyst browsers.

## Blocking safeguards

New sites observe for seven days. Allowlist and protected/private ranges win over all block rules. Auto-blocking is opt-in and requires three correlated critical detections within five minutes, confidence at least 0.95, a completed shadow evaluation, and no protected-range match. First blocks last 15 minutes; repeat blocks may extend to 24 hours. AI cannot create permanent rules.

Every policy change needs preview, audit entry, propagation state, expiry, rollback, and an emergency site-level monitor-only switch.

## Platform hardening checklist

- Exact CORS origin, HSTS, CSP, `nosniff`, frame denial, permissions policy, and TLS 1.2+.
- Input schemas, prepared Prisma queries, output encoding, 1 MiB request cap, and resource-specific rate limits.
- SSRF protection for URLs/webhooks: HTTPS only, DNS resolution checks, public-address allow policy, redirect revalidation, and connection timeouts.
- Non-root application containers, read-only filesystems, dropped capabilities, resource limits, private networks, pinned images, and log rotation.
- Secrets mounted from ignored files; never commit them or expose them to browser bundles/logs.
- OWASP ASVS Level 2, OWASP API Top 10, Semgrep, Trivy, dependency audit, secret scanning, ZAP, and cross-tenant tests before release.

## Vulnerability response

Privately record reporter contact, affected version, reproduction, impact, and evidence. Triage within one business day for critical issues. Revoke exposed agent/session keys, disable unsafe automation, preserve audit logs, patch, test tenant boundaries, deploy, and notify affected organizations under the incident and PDPA process. Do not publish exploit details before remediation.

