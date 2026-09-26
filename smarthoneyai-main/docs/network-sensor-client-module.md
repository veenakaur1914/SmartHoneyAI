# SmartHoneyAI client sensor modules

SmartHoneyAI is the control plane. Its Dokploy Compose does not run OpenCanary, publish sensor ports, create a sensor network, or store client sensor credentials.

## Packages

- `smarthoneyai-wordpress-1.1.0.zip` is for Hostinger and other normal WordPress hosting. It provides inert HTTP decoys, sanitized telemetry, and WordPress application-layer blocking.
- `smarthoneyai-wordpress-docker-1.1.0.tar.gz` contains the same plugin plus a standalone OpenCanary module for a client-controlled Docker host. The module adds SSH, MySQL, and Redis detection. It never performs firewall blocking.

Build both packages with `pnpm package:clients`. Verify `output/releases/SHA256SUMS` before distribution.

## Docker boundary

The standalone Compose project creates only `sensor_internal` and `sensor_egress`. OpenCanary joins the internal network only. The forwarding agent joins both networks so it can send signed, sanitized batches to the public HTTPS control plane. Neither container joins WordPress, database, reverse-proxy, or Dokploy networks.

Production activation is blocked unless Docker is healthy, 1 GiB memory and 5 GiB disk are free, all three host ports are unused, the HTTPS endpoint is configured, an exact source allowlist exists, and the provider firewall allowlist is explicitly confirmed. Production has no source-IP override.

## Data handling

OpenCanary logs only to the private socket handler. The agent projects an allowlisted event shape and never copies `logdata`. SSH/MySQL usernames and passwords, Redis commands and arguments, tokens, and raw session values therefore never enter the spool, API payload, PostgreSQL, AI request, Telegram, or evidence report.

`OBSERVED` means the client host reported the real source address. `DEMO_OVERRIDE` is accepted only for an active 15-minute self-test run, from its paired sensor, using its bound source IP and scoped bearer token. The production bundle excludes the local override Compose file.

## Containment boundary

Network signals can correlate with WordPress telemetry, but signed policy is delivered only to WordPress clients. A 24-hour containment rule protects connected WordPress sites at the application layer. It does not alter the client host firewall. Self-test cleanup disables only the rule owned by that run; expiration automatically removes an outstanding self-test rule.
