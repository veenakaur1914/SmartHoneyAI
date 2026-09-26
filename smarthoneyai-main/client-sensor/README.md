# SmartHoneyAI WordPress Docker Sensor

This standalone module adds SSH, MySQL and Redis decoys beside an existing Docker-hosted WordPress site. It does not join the WordPress, database or reverse-proxy networks and it never changes firewall rules. SmartHoneyAI containment remains application-level enforcement inside the WordPress plugin.

1. Install `smarthoneyai-wordpress-1.1.0.zip` in WordPress and enroll the site.
2. Create a paired network sensor in SmartHoneyAI and copy its one-time token.
3. Copy `.env.example` to `.env`, fill the exact values and configure the provider firewall to allow the three ports only from authorized sources.
4. Run `./scripts/install.sh`.
5. Remove the enrollment token after the first successful heartbeat.

The production module has no local source-IP override. `docker-compose.local.yml` stays in the SmartHoneyAI source repository for the gated laptop self-test workflow and is excluded from the client release archive.

For the complete two-package setup, safe attack commands, expected dashboard/Telegram results, and cleanup sequence, see `docs/client-sensor-demo-guide.md` in the SmartHoneyAI source repository.
