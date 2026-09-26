-- Add editable profile identity and targeted honeypot automation controls.
CREATE TYPE "HoneypotSource" AS ENUM ('BUILT_IN', 'CUSTOM');

ALTER TABLE "User"
ADD COLUMN "avatarEmoji" TEXT NOT NULL DEFAULT '🛡️';

ALTER TABLE "Site"
ADD COLUMN "autoBlockEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "HoneypotDeployment"
ADD COLUMN "name" TEXT,
ADD COLUMN "source" "HoneypotSource" NOT NULL DEFAULT 'BUILT_IN';

UPDATE "HoneypotDeployment"
SET "name" = initcap(replace("key", '-', ' '))
WHERE "name" IS NULL;

UPDATE "HoneypotDeployment"
SET "path" = '/' || "path"
WHERE "path" NOT LIKE '/%';

ALTER TABLE "HoneypotDeployment"
ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "HoneypotDeployment_siteId_key_key"
ON "HoneypotDeployment"("siteId", "key");

CREATE INDEX "HoneypotDeployment_siteId_source_idx"
ON "HoneypotDeployment"("siteId", "source");

-- Preserve the tenant identity while removing the legacy demo label.
UPDATE "Organization"
SET "name" = 'Professional Security Operations'
WHERE "name" = concat('Demo', chr(32), 'Security Operations');
