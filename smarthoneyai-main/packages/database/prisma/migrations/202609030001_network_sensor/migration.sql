CREATE TYPE "SiteKind" AS ENUM ('WORDPRESS', 'NETWORK_SENSOR');
CREATE TYPE "EventProtocol" AS ENUM ('HTTP', 'SSH', 'MYSQL', 'REDIS');
CREATE TYPE "EventActivity" AS ENUM ('CONNECTION', 'BANNER', 'AUTH_ATTEMPT', 'COMMAND', 'REQUEST');
ALTER TYPE "ThreatType" ADD VALUE 'SERVICE_ABUSE';

ALTER TABLE "Site"
  ADD COLUMN "kind" "SiteKind" NOT NULL DEFAULT 'WORDPRESS',
  ADD COLUMN "sourceIpVerifiedAt" TIMESTAMP(3),
  ALTER COLUMN "url" DROP NOT NULL,
  ALTER COLUMN "domain" DROP NOT NULL;

ALTER TABLE "SecurityEvent"
  ADD COLUMN "protocol" "EventProtocol",
  ADD COLUMN "activity" "EventActivity",
  ADD COLUMN "sourcePort" INTEGER,
  ADD COLUMN "destinationPort" INTEGER,
  ADD COLUMN "sessionId" TEXT;

CREATE TABLE "NetworkSensorHeartbeat" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "agentVersion" TEXT NOT NULL,
  "queueDepth" INTEGER NOT NULL,
  "health" TEXT NOT NULL,
  "enabledServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "droppedEvents" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NetworkSensorHeartbeat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NetworkSensorHeartbeat_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Site_organizationId_kind_status_idx" ON "Site"("organizationId", "kind", "status");
CREATE INDEX "NetworkSensorHeartbeat_siteId_createdAt_idx" ON "NetworkSensorHeartbeat"("siteId", "createdAt");
