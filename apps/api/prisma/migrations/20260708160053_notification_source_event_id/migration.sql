-- Idempotent notifications consumer: outbox event id + recipient per row
ALTER TABLE "Notification" ADD COLUMN "sourceEventId" TEXT;

CREATE UNIQUE INDEX "Notification_sourceEventId_key" ON "Notification"("sourceEventId");
