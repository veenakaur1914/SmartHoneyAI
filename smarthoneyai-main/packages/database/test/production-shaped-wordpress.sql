INSERT INTO "Organization" ("id", "name", "slug", "updatedAt")
VALUES ('migration-org', 'Existing Production Organization', 'migration-org', CURRENT_TIMESTAMP);

INSERT INTO "Site" ("id", "organizationId", "name", "url", "domain", "status", "enforcementMode", "currentPolicyVersion", "autoBlockEnabled", "createdAt", "updatedAt")
VALUES ('migration-wordpress', 'migration-org', 'Existing WordPress', 'https://existing.example', 'existing.example', 'ONLINE', 'OBSERVE', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
