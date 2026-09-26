# Operations and disaster recovery

## Daily checks

- Confirm all Compose services are running and healthy.
- Review critical incidents, dead-letter jobs, replay/signature failures, cross-tenant authorization denials, and rule-sync age.
- Check PostgreSQL/Redis disk growth, host disk/inode use, memory pressure, TLS expiry, queue lag, AI failure rate, SMTP/Telegram delivery, and last successful backup.
- Ensure no operator troubleshooting port remains bound to a non-loopback interface.

Prometheus alert rules cover API availability, ingestion errors, queue lag, dead letters, AI failures, stale policy sync, replay failures, and tenant-boundary denial spikes. Metrics named in those rules must remain stable application contracts. Configure Alertmanager with an operator-controlled receiver; its committed default intentionally sends nothing externally.

## Logs and metrics

Nginx emits structured JSON without request bodies or credentials. Fastify logger redaction must cover authorization, cookies, agent secrets, passwords, and tokens. Use request IDs to correlate edge, API, worker, alert-delivery, and audit records. Never enable debug body logging in production.

Prometheus, Grafana, and Alertmanager are internal. Retain metrics for 30 days on the pilot host. Application events follow product retention rather than log retention. Configure Docker log rotation at the daemon level, for example `max-size=10m` and `max-file=5`.

## Backup schedule

Create a dedicated offline `age` identity and place only its public recipient on the application host. Run daily:

```bash
AGE_RECIPIENT='age1...' RCLONE_DESTINATION='remote:honeypot-ai' sh scripts/backup.sh
```

The script streams a PostgreSQL custom-format dump through `age`, creates a SHA-256 sidecar, deletes local backups older than 30 days, and optionally uploads both files with rclone. A successful local command is not proof of off-host durability: monitor destination object age and size.

Back up `secrets/` separately under a different encryption key and access policy. Database backups do not contain the policy private key or runtime secrets. Target RPO is 24 hours.

## Restore drill

Perform quarterly on an isolated host/network:

1. Restore the matching release and secret archive.
2. Verify the encrypted backup checksum before decryption.
3. Start PostgreSQL only, then run:

   ```bash
   AGE_IDENTITY_FILE=/secure/age-key \
   CONFIRM_RESTORE=honeypot_ai \
   sh scripts/restore.sh backups/honeypot-ai-TIMESTAMP.dump.age
   ```

4. Run readiness checks and Prisma/schema sanity checks.
5. Verify counts for organizations, memberships, sites, events, incidents, rules, audit entries, and unexpired sessions.
6. Confirm an existing plugin can fetch and verify a policy. Do not let the drill instance contact production WordPress sites, Telegram, SMTP, or Hugging Face.
7. Record duration and failures. The target RTO is four hours.

## Incident procedures

### API or worker outage

Keep Nginx and WordPress available. Events remain in plugin spools and accepted jobs remain in Redis. Inspect resource pressure and `docker compose logs --since 30m api worker`. Restart only the affected service. Do not purge Redis queues to clear lag.

### Redis loss

Accepted database events survive, but nonce state and queued analysis may be lost. Disable auto-blocking, restore Redis persistence if trustworthy, enqueue pending assessments from PostgreSQL, and review the five-minute replay exposure.

### Hugging Face or Telegram outage

Leave assessments pending/unavailable and retry with capped exponential backoff. Do not interpret provider failure as benign. Do not block visitors from unclassified events. The read-only analyst may show a labeled deterministic evidence summary during chat-provider failure; this is not a completed threat classification. Telegram failure must remain visible in-app.

### Suspected tenant escape

Disable affected API actions, preserve immutable logs, revoke active sessions, capture request IDs, determine organizations and fields exposed, patch and run the full IDOR/RBAC suite, then follow the PDPA breach assessment process.

### Signing-key exposure

Immediately force every site to monitor-only, generate a new offline Ed25519 pair, publish the new public key through an authenticated plugin re-enrollment/update path, revoke old agent credentials as needed, and audit policies issued during the exposure window. Replacing a key file alone will cause existing plugins to reject policies.

## Retention jobs

Run daily background jobs that delete full-IP/event evidence after 30 days, retain only non-identifying daily aggregates for 13 months, and delete audit records after 400 days unless a documented legal/incident hold applies. Deletion must be tenant-scoped, resumable, logged by count, and tested against foreign-key relationships.
