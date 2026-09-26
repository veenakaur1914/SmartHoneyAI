# SmartHoneyAI WordPress Agent

This plugin is the WordPress sensor and local enforcement agent for the SmartHoneyAI control plane. It creates inert HTTP decoys, queues sanitized security events locally, sends signed event batches in the background, and applies only verified, cached declarative policies.

It does **not** expose a shell, execute attacker input, call the control plane during normal page rendering, or store submitted passwords. If the control plane is unavailable, WordPress continues serving traffic. If the last verified policy expires, enforcement becomes `MONITOR_ONLY`.

## Requirements

- WordPress 6.2 or newer
- PHP 7.4 or newer
- PHP Sodium extension for Ed25519 policy verification
- HTTPS SmartHoneyAI control-plane URL
- Pretty permalinks for decoy rewrite routes

## Install and enroll

1. Copy this directory to `wp-content/plugins/honeypot-ai` or install its ZIP in WordPress.
2. Activate **SmartHoneyAI Agent**.
3. In the SaaS dashboard, create a WordPress site and a one-time enrollment token.
4. Open **Settings → SmartHoneyAI** in WordPress.
5. Enter the HTTPS control-plane URL and one-time token. The token is never persisted.
6. Confirm a heartbeat and policy acknowledgement in the SaaS dashboard.

The enrollment response must return `siteId`, `keyId`, `secret`, and `policyPublicKey`. The values may also be inside a `credential` object. `policyPublicKey` is a base64-encoded Ed25519 public key.

## Decoys

The last verified signed policy controls up to 200 routes. Older control planes safely fall back to these 15 built-in decoys:

- `/secure-admin-login`
- `/wp-content/backups/site-backup.zip`
- `/internal/admin-console`
- `/phpmyadmin`
- `/env`
- `/git-config`
- `/wp-config-backup`
- `/server-diagnostics`
- `/adminer.php`
- `/debug-log`
- `/backup.sql`
- `/actuator/env`

They return inert responses only. Form fields are sanitized before queueing and credential-like fields are replaced with `[REDACTED]`. Cookies and authorization headers are always redacted. Headers are capped at 16 KiB and the JSON payload excerpt at 32 KiB.

Even in observation mode, the plugin locally tracks only HMAC source/route hashes. A public, non-allowlisted source that opens three distinct routes in ten minutes is blocked locally for 24 hours. Private, reserved, loopback, allowlisted, and logged-in administrator sources are never auto-blocked. The activating honeypot event and subsequent blocked-request events include automation metadata for Live events and AI analysis.

## Control-plane protocol

The plugin implements:

- `POST /v1/agent/enroll`
- `POST /v1/agent/events/batch`
- `GET /v1/agent/config`
- `POST /v1/agent/config/ack`
- `POST /v1/agent/heartbeat`

All calls except enrollment include:

```text
X-Honeypot-Site-Id
X-Honeypot-Key-Id
X-Honeypot-Timestamp
X-Honeypot-Nonce
X-Honeypot-Content-SHA256
X-Honeypot-Signature
Idempotency-Key          # unique request ID; stable across batch retries
```

The signature is base64-encoded HMAC-SHA256 over this UTF-8 canonical string:

```text
METHOD
/v1/agent/path
unixTimestamp
nonce
lowercaseHexSha256OfExactBody
idempotencyKeyOrEmptyString
```

The server should reject timestamps outside five minutes, reused nonces, mismatched body hashes, revoked key IDs, and signatures that do not pass constant-time verification. The body of a `GET` is the empty string. Event batches contain no more than 25 events, keeping even maximum-sized sanitized events below the 1 MiB API limit.

Config responses may be either the policy object itself or `{ "policy": { ... } }`. The plugin sends `If-None-Match` after the first verified policy and accepts `304 Not Modified`.

Heartbeats report the enabled decoy keys, bounded queue depth, cumulative dropped-event count, effective policy mode/version, health, and a bounded active error code. The local administrator page separately shows the last successful heartbeat, spool bytes, policy expiry, and the last sanitized error detail.

### Policy signature

The `signature` field is base64-encoded Ed25519. The signed bytes are canonical JSON of the policy after removing `signature`: object keys are sorted lexicographically at every depth, arrays retain order, and JSON is encoded without escaped slashes or Unicode characters. During transition, the agent also verifies insertion-order JSON emitted by the Node control plane. The public key may be the raw 32-byte Ed25519 key encoded as base64 or a base64-wrapped Ed25519 SPKI PEM. A missing Sodium extension, invalid signature, different site ID, invalid rule shape, or older version rejects the policy and is acknowledged as `REJECTED`.

Supported local rule types are:

- `ALLOW_IP`: exact IPv4/IPv6 or CIDR; allow rules always win.
- `BLOCK_IP`: exact IPv4/IPv6 or CIDR.
- `BLOCK_USER_AGENT`: bounded, case-insensitive literal substring; no regex evaluation.
- `BLOCK_ROUTE`: exact path or a trailing `*` prefix match; no regex evaluation.
- `BLOCK_COUNTRY`: evaluated only when a trusted country value is available. The current standalone plugin deliberately does not trust spoofable forwarding headers, so it remains non-matching by default.
- `RATE_LIMIT`: `requests/window-seconds`, for example `60/60`. Counters use an atomic database upsert rather than request-racy transients.

Loopback, private, link-local, reserved, and invalid source addresses are protected from local blocking. An active policy must be unexpired and in `ENFORCE` mode before any broad policy deny or rate-limit action occurs. The targeted repeat-honeypot automation remains independent of broad enforcement mode.

## Queue and scheduling

Events are stored in the `${table_prefix}honeypot_ai_events` table. The queue is bounded to both 10,000 rows and 64 MiB of JSON payload; the oldest unclaimed events are discarded on overflow and a cumulative dropped-event counter is exposed in the administrator and heartbeat telemetry. A transactional singleton state row maintains exact O(1) queue counters, while short delivery leases prevent parallel workers from sending the same rows. Rate-limit buckets use `${table_prefix}honeypot_ai_rate_limits`; repeat-honeypot route and block tables contain opaque hashes only. Expired buckets are cleared during the agent tick. WP-Cron checks signed honeypot policy every minute and runs delivery, cleanup, and heartbeat maintenance every five minutes. Enrollment performs an immediate policy sync, and the administrator page retains a manual **Sync now** fallback. Failed deliveries release their lease, retry within one minute, and schedule a prompt delivery attempt. Normal visitors never wait for a control-plane network request.

Verified policies are written to a temporary candidate option, read back and hash-checked, then promoted. If promotion is interrupted, policy selection can recover the newest valid candidate without selecting a corrupt record.

For low-traffic sites, configure a real system cron to call `wp-cron.php` regularly.

The WordPress status screen displays heartbeat, policy-expiry, and agent-error times in Malaysia Time (`Asia/Kuala_Lumpur`, MYT, UTC+8). Wire and signed-policy timestamps remain UTC/ISO 8601.

## Uninstall and incident response

By default, uninstalling preserves credentials, policy, settings, and queued evidence. Select **Delete plugin data when uninstalling** first if complete removal is required. Disconnecting locally does not revoke the server credential; revoke it in the SaaS dashboard as well.

If a credential may be exposed:

1. Revoke its key ID in the control plane.
2. Disconnect locally.
3. Generate a fresh one-time enrollment token.
4. Re-enroll and confirm a new heartbeat.

## Tests

Install development dependencies with Composer and point `WP_TESTS_DIR` at the WordPress PHPUnit test library:

```bash
composer install
WP_TESTS_DIR=/tmp/wordpress-tests-lib composer test
composer lint
composer package
```

`composer package` produces `output/releases/smarthoneyai-wordpress-1.1.0.zip` with stable file ordering, permissions, and timestamps. Plugin source, header, and WordPress.org stable-tag versions must all match before packaging.
