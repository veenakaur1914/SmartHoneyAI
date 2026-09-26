# API and WordPress plugin guide

The OpenAPI UI is served by the API at `/docs` on the internal service. Do not expose it publicly in production unless authenticated. All JSON limits and response shapes are defined in `packages/contracts`.

## Browser API

Browser calls use the `hp_session` Secure, HttpOnly cookie and exact-origin CSRF checks.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/access-requests` | Submit an invite-only access request. |
| POST | `/v1/auth/login` | Create a seven-day server session. |
| POST | `/v1/auth/logout` | Revoke the current session. |
| GET | `/v1/auth/me` | Return user and memberships. |
| GET | `/v1/dashboard/summary` | Tenant security summary. |
| GET/POST | `/v1/sites` | List sites or create a site and one-time enrollment token. |
| GET | `/v1/events` | Paginated tenant event search. |
| GET | `/v1/events/:id` | Event evidence, assessments, and linked incidents. |
| GET | `/v1/events/stream` | Authenticated server-sent event stream. |
| GET | `/v1/incidents` | Tenant incident list. |
| GET/POST | `/v1/firewall/rules` | List or create declarative rules. |
| GET | `/v1/team` | Tenant membership list. |
| GET | `/v1/platform/access-requests` | Platform-admin access queue. |
| GET | `/v1/platform/organizations` | Platform-admin organization overview. |

Standard errors include `statusCode`, stable `code`, safe `message`, and `requestId`. Never return stack traces or secrets.

## Agent enrollment

An administrator creates a site in the dashboard and copies the enrollment token into WordPress under **Settings → SmartHoneyAI**. The plugin sends:

```json
{
  "token": "single-use-token",
  "siteUrl": "https://customer.example",
  "siteName": "Customer site",
  "pluginVersion": "1.0.0",
  "proof": "domain-bound-installation-proof"
}
```

`POST /v1/agent/enroll` validates token expiry/use and exact hostname. The response returns `siteId`, `keyId`, agent `secret` once, base64 policy public key, and enforcement mode. Do not show or log the secret again. Delete the enrollment token from WordPress after success.

## Signed agent requests

For each authenticated request, send:

- `X-Honeypot-Site-Id`
- `X-Honeypot-Key-Id`
- `X-Honeypot-Timestamp` as Unix seconds
- `X-Honeypot-Nonce` as a fresh cryptographically random value
- `X-Honeypot-Content-SHA256` as lowercase hexadecimal SHA-256 of the exact transmitted body
- `X-Honeypot-Signature` as HMAC-SHA256 over the canonical request string defined by the plugin/API implementation
- `Idempotency-Key` as a stable key for this signed request attempt

The timestamp window is five minutes. A nonce may be accepted once. Sign the exact bytes sent; JSON reformatting after signing invalidates the request. GET policy requests sign an empty body.

Protocol, database, and signed-policy timestamps remain UTC/ISO 8601 for unambiguous comparison. Operator-facing dashboard and WordPress status timestamps are rendered in Malaysia Time (`Asia/Kuala_Lumpur`, MYT, UTC+8), and the AI analyst receives an explicit MYT timestamp alongside the ISO reference.

## Event batches

`POST /v1/agent/events/batch` accepts 1–500 events and at most 1 MiB total. Every event has a unique idempotency key, timestamp, kind, method, path, source IP, action, and optional already-sanitized evidence. A `202` response reports accepted, duplicate, and queued counts. Retain only unaccepted local entries; safe retries use the same idempotency keys.

The current API consumes JSON. Enable gzip only after an integration test confirms signature verification occurs over the same compressed or decompressed representation on both sides.

## Policy synchronization

`GET /v1/agent/config` returns an ETag and a signed object containing site ID, monotonically increasing version, issue/expiry timestamps, `OBSERVE` or `ENFORCE` mode, and bounded declarative rules. The plugin must:

1. Verify Ed25519 signature against the pinned enrollment key.
2. Verify matching site ID, valid timestamps, monotonic version, known rule types, valid CIDR/country/route values, and rule-count/length bounds.
3. Write a new policy to a temporary option, read it back, and atomically select it.
4. `POST /v1/agent/config/ack` with version, status, and a non-sensitive error summary.

Allow rules precede block rules. Unsupported rules are rejected rather than partially interpreted. After expiry, switch to monitor-only.

## Heartbeat and scheduling

Every five minutes, `POST /v1/agent/heartbeat` reports plugin version, bounded local queue depth, active policy version, mode, and health. Fetch signed honeypot policy every minute through WP-Cron, with an immediate fetch after enrollment and a manual sync fallback. Send event batches through WP-Cron and also opportunistically after capturing an event, but never make a control-plane call synchronously in the visitor request path.

## Inert decoys

The plugin may register fake admin, backup, API, login, and phpMyAdmin-style routes. Responses are static, contain no third-party branding, never authenticate, never connect to a shell/database, and never execute input. Captured passwords and credential-like fields are discarded before queuing.

## Failure behavior

- Central/API outage: spool within a strict item/byte cap, evict oldest entries with a visible dropped count, and keep WordPress available.
- Invalid policy/signature: retain last verified policy and send a rejection acknowledgement later.
- Expired policy: monitor-only/fail-open.
- Queue full: preserve WordPress availability and surface health degradation.
- Clock drift: show a specific admin warning; never weaken replay checks automatically.
