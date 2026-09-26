=== SmartHoneyAI Agent ===
Contributors: honeypot-ai
Tags: security, honeypot, firewall, monitoring
Requires at least: 6.2
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Safe, inert WordPress honeypot sensor and signed local policy agent for the SmartHoneyAI control plane.

== Description ==

SmartHoneyAI Agent connects an enrolled WordPress site to a SmartHoneyAI organization. It queues redacted suspicious events, checks signed declarative honeypot policy every minute through WP-Cron, and fails open when the verified policy expires.

The local spool is bounded to 10,000 events and 64 MiB, reports cumulative drops, and uses database-backed atomic rate-limit counters. Verified policy updates can synchronize up to 200 inert custom or built-in routes and use temporary write, readback verification, and recovery-safe selection.

The decoys never execute submitted content. Passwords, authorization headers, cookies, tokens, and secrets are not retained.

Repeat public attackers are blocked locally for 24 hours after opening three distinct decoys in ten minutes, including during observation mode. The automation stores only keyed source and route hashes and exempts private, reserved, allowlisted, and logged-in administrator sources.

== Installation ==

1. Upload the plugin and activate it.
2. Create a site and one-time enrollment token in SmartHoneyAI.
3. Open Settings > SmartHoneyAI.
4. Enter the control-plane HTTPS URL and token.
5. Confirm the site heartbeat in SmartHoneyAI.

== Frequently Asked Questions ==

= Does the plugin contact SmartHoneyAI on every request? =

No. It enforces a cached, verified policy locally and uses WP-Cron for network communication.

= What happens during an outage? =

The last verified policy remains active until its expiry. The plugin then enters monitor-only mode and WordPress remains available.

= Does a fake login retain passwords? =

No. Credential fields are replaced with a redaction marker before the event enters the local queue.

== Changelog ==

= 1.1.0 =

* Adds responsive readiness, policy, queue, error, and optional paired Docker sensor status. Enrollment now fails with an actionable message when PHP Sodium is unavailable.

= 1.0.1 =

* Automatically checks signed honeypot configuration every minute, refreshes new and custom routes correctly, and detects configured paths even while WordPress rewrite caches are stale.

= 1.0.0 =

* Production release with enrollment, a bounded event spool, rich heartbeat telemetry, signed policy sync, inert decoys, and database-backed local enforcement.
