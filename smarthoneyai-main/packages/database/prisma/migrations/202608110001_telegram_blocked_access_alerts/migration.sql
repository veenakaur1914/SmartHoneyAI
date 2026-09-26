ALTER TABLE "AlertDelivery" ADD COLUMN "eventId" TEXT;

CREATE INDEX "AlertDelivery_eventId_idx" ON "AlertDelivery"("eventId");
CREATE UNIQUE INDEX "AlertDelivery_channelId_eventId_key" ON "AlertDelivery"("channelId", "eventId");

ALTER TABLE "AlertDelivery"
ADD CONSTRAINT "AlertDelivery_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "SecurityEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
