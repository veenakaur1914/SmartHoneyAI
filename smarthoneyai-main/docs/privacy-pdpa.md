# Privacy and Malaysia PDPA notes

This document is implementation guidance, not legal advice. The operator should obtain Malaysian counsel before accepting production customers.

## Roles and purpose

Document whether SmartHoneyAI acts as data processor/service provider for customer security telemetry and when it is independently a data user/controller for accounts, access requests, billing-free administration, abuse prevention, and service audit records. Customer terms must require authority to monitor the connected WordPress site.

Use collected data only to detect, investigate, report, and safely mitigate suspicious activity; secure the platform; provide support; and meet documented legal duties. Do not sell telemetry, build advertising profiles, retaliate against sources, or train unrelated models without a new lawful basis and notice.

## Data inventory

- Account: name, work email, organization, role, sessions, hashed IP/user-agent metadata.
- Site: hostname, plugin version, health, policy version, and configuration.
- Security events: time, method/path, full source IP for 30 days, user agent, selected sanitized headers, bounded payload excerpt, GeoIP country, action, and derived hashes.
- Assessments/incidents: threat type, confidence, severity, recommendation, model/revision, evidence summary, and analyst actions.
- Communications: invitation/reset delivery and Telegram alert status; Telegram messages never include raw payloads or full IPs.
- Audit: actor, action, target, request ID, timestamp, and minimal metadata.

Never intentionally collect passwords, cookies, authorization values, session IDs, API tokens, private keys, or full ordinary-site traffic.

## Notice and choice

Publish a concise privacy notice at access request and in the dashboard describing purposes, categories, retention, security measures, processors, contact channel, access/correction/deletion process, and cross-border transfer. Organization owners must configure an appropriate notice on monitored sites where required. Auto-blocking is off by default and explicitly enabled per site after the observation period.

## Retention and deletion

| Data | Default retention |
|---|---:|
| Suspicious events and full IP addresses | 30 days |
| Non-identifying daily analytics | 13 months |
| Audit trail | 400 days |
| Expired enrollment/reset tokens | Delete within 24 hours |
| Revoked sessions | Delete after investigation window, at most 30 days |
| Rejected access requests | 90 days unless consent/legal need supports longer |

An approved legal/incident hold must identify scope, owner, reason, and review date. Tenant deletion jobs should remove or irreversibly anonymize linked operational data and produce a count-only audit record. Backup copies age out on the 30-day backup lifecycle rather than being selectively edited; prevent restoration from silently reactivating deleted accounts.

## Individual and customer requests

Authenticate the requester, record scope and deadline, search account/organization/site/event/alert/audit systems, review third-party processor data, export in a safe structured format, and obtain approval before deletion. Preserve data only where a documented legal/security exception applies. Notify the requester of completion or lawful refusal.

## Processors and cross-border transfers

Maintain a processor register for hosting, Hugging Face inference, SMTP, Telegram, backup storage, and MaxMind database downloads. Record country/region, data categories, contract, security review, retention, and deletion method. Hugging Face receives redacted normalized evidence only—never source IP, cookies, authorization, credentials, or session data. Telegram receives site name, incident ID, type/severity/action, masked IP, and dashboard link only.

Before cross-border processing, document PDPA transfer requirements, safeguards, customer notice/contract terms, and an alternative path when the transfer is not permitted.

## Breach response

Detect and contain, preserve evidence, determine affected people/organizations/data/time window, revoke keys, assess harm and Malaysian notification duties, communicate without exposing attacker-controlled evidence, remediate, and record lessons learned. Keep current regulator and customer contact procedures in the private operator runbook.

