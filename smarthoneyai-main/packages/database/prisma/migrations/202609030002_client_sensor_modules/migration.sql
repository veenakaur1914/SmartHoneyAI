CREATE TYPE "WordpressDeploymentType" AS ENUM ('NORMAL_HOSTING', 'DOCKER');
CREATE TYPE "EventSourceAttribution" AS ENUM ('OBSERVED', 'DEMO_OVERRIDE');
CREATE TYPE "SelfTestStatus" AS ENUM ('CREATED', 'RUNNING', 'DETECTED', 'CONTAINED', 'CLEANED', 'FAILED', 'EXPIRED');

ALTER TABLE "Site"
  ADD COLUMN "deploymentType" "WordpressDeploymentType" NOT NULL DEFAULT 'NORMAL_HOSTING',
  ADD COLUMN "pairedWordpressSiteId" TEXT;

ALTER TABLE "SecurityEvent"
  ADD COLUMN "sourceAttribution" "EventSourceAttribution" NOT NULL DEFAULT 'OBSERVED',
  ADD COLUMN "selfTestRunId" TEXT;

CREATE TABLE "SelfTestRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "wordpressSiteId" TEXT NOT NULL,
  "networkSensorId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "SelfTestStatus" NOT NULL DEFAULT 'CREATED',
  "sourceIp" TEXT,
  "sourceIpHash" TEXT,
  "incidentId" TEXT,
  "firewallRuleId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "containedAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SelfTestRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SelfTestRun_tokenHash_key" ON "SelfTestRun"("tokenHash");
CREATE INDEX "Site_pairedWordpressSiteId_idx" ON "Site"("pairedWordpressSiteId");
CREATE INDEX "SecurityEvent_selfTestRunId_occurredAt_idx" ON "SecurityEvent"("selfTestRunId", "occurredAt");
CREATE INDEX "SelfTestRun_organizationId_status_expiresAt_idx" ON "SelfTestRun"("organizationId", "status", "expiresAt");
CREATE INDEX "SelfTestRun_wordpressSiteId_status_idx" ON "SelfTestRun"("wordpressSiteId", "status");
CREATE INDEX "SelfTestRun_networkSensorId_status_idx" ON "SelfTestRun"("networkSensorId", "status");

ALTER TABLE "Site" ADD CONSTRAINT "Site_pairedWordpressSiteId_fkey" FOREIGN KEY ("pairedWordpressSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_selfTestRunId_fkey" FOREIGN KEY ("selfTestRunId") REFERENCES "SelfTestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SelfTestRun" ADD CONSTRAINT "SelfTestRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfTestRun" ADD CONSTRAINT "SelfTestRun_wordpressSiteId_fkey" FOREIGN KEY ("wordpressSiteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfTestRun" ADD CONSTRAINT "SelfTestRun_networkSensorId_fkey" FOREIGN KEY ("networkSensorId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfTestRun" ADD CONSTRAINT "SelfTestRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
