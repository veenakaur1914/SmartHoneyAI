# FYP demonstration runbook

The demonstration proves the complete control loop safely: administrator onboarding, WordPress sensor, central analysis, incident visibility, alerting, signed policy, local enforcement, and outage tolerance. Use only an isolated WordPress instance and synthetic requests you are authorized to send.

## Before the session

- Deploy the tagged release over trusted HTTPS and record its commit/model revision.
- Create one platform administrator, two organizations, and Viewer/Analyst/Admin users to demonstrate isolation and RBAC.
- Connect a disposable WordPress site with default `OBSERVE` mode. Confirm plugin heartbeat, current policy, queue depth, and clock sync.
- Configure a dedicated Telegram test chat and verify its message contains no raw payload or full IP.
- Seed safe demonstration history so charts are legible, clearly label it synthetic, and retain a clean database snapshot.
- Keep Grafana, Compose logs, and the emergency monitor-only control available only to the operator.

## Demonstration sequence

1. **Landing and access:** show request access, platform-admin review, organization membership, and customer login. Explain invite-only scope and absence of server access.
2. **Tenant boundary:** sign in as Organization A, copy an Organization B event URL/ID, and show that it cannot be accessed. Show Viewer cannot create a firewall rule.
3. **Site onboarding:** create the WordPress site, install/activate the plugin, enter the one-time token, verify online status, and show that the secret is not displayed again.
4. **Inert detection:** request an enabled fake backup/admin route with a harmless marker such as `FYP-DEMO-001`. Do not submit credentials or exploit code.
5. **Durable ingestion:** show the event in Live Events with site, time, masked source, sanitized headers/payload, unique ID, and redaction state. Explain idempotency and replay protection.
6. **AI assessment:** show pending then complete/unavailable status, pinned model revision, confidence, severity, evidence summary, and recommendation. Explain that provider failure never means safe.
7. **Incident and alert:** open the related incident and Telegram delivery record. Confirm Telegram contains only the approved minimal fields.
8. **Policy:** create a short-lived test block rule for the demonstration source, preview it, publish, wait for plugin acknowledgement, and show policy version/signature state. Keep the operator address allowlisted.
9. **Local enforcement:** switch the disposable site to `ENFORCE` only after the preview. Repeat the harmless decoy request and show the local block plus resulting event. Remove/expire the rule and return to `OBSERVE`.
10. **Outage safety:** stop or network-block the API, load a normal WordPress page successfully, show cached policy state/local spool, then demonstrate monitor-only behavior using an intentionally short-lived test policy. Restore API and show queued delivery recovery.
11. **Operations:** show private container topology, readiness, queue/AI dashboards, encrypted backup artifact/checksum, and the documented restore target. Do not expose secret values.

## Evidence to capture

- Screenshots/video of the onboarding and event-to-policy loop.
- Event, assessment, incident, alert-delivery, policy version/acknowledgement, and audit IDs.
- Test output for TypeScript, PHP, integration, tenant isolation, accessibility, load, security scan, and backup restore.
- Timing: plugin policy overhead, ingest p95, dashboard p95, sustained/burst rates, and alert delivery.
- Known limitations: pilot scale, password-only auth, single-host deployment, AI uncertainty, WordPress-only integration, and inert HTTP decoys.

## Safety reset

Return every site to `OBSERVE`, delete demonstration blocks, revoke disposable enrollment/agent credentials, clear the Telegram test channel as permitted, verify no real credential-like input was retained, restore the clean fixture when appropriate, and preserve only approved FYP evidence.

## Acceptance checklist

- Complete platform-admin → owner → team → site → plugin journey.
- Decoy event persisted, classified, correlated, alerted, and safely enforced/revoked.
- Cross-tenant and role denial visibly demonstrated.
- WordPress remains available during central outage and recovers its spool.
- Hugging Face failure is visible and cannot auto-block.
- No credentials, cookies, authorization values, full IPs in Telegram, or server access exposed.

