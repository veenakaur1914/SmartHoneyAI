-- Extend heartbeat telemetry reported by WordPress agents.
ALTER TABLE "AgentHeartbeat"
ADD COLUMN "enabledDecoys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "droppedEvents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastErrorCode" TEXT;

-- A source hash lets the API reuse a still-fresh signed policy when its inputs
-- have not changed, while preserving immutable versioned policy documents.
ALTER TABLE "RuleSet" ADD COLUMN "sourceHash" TEXT;

UPDATE "RuleSet"
SET "sourceHash" = md5("policy"::text)
WHERE "sourceHash" IS NULL;

ALTER TABLE "RuleSet" ALTER COLUMN "sourceHash" SET NOT NULL;

CREATE INDEX "RuleSet_siteId_sourceHash_createdAt_idx"
ON "RuleSet"("siteId", "sourceHash", "createdAt");
