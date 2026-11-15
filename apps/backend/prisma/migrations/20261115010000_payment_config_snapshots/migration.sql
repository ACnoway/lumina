-- Keep an encrypted immutable configuration for each payment channel version.
CREATE TABLE "payment_channel_configs" (
  "channelId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "configEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_channel_configs_pkey" PRIMARY KEY ("channelId", "version")
);

INSERT INTO "payment_channel_configs" ("channelId", "version", "configEncrypted")
SELECT "id", "configVersion", "configEncrypted"
FROM "payment_channels";

ALTER TABLE "payment_orders"
  ADD COLUMN "channelConfigVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "payerAmount" DECIMAL(10,2);

UPDATE "payment_orders" AS orders
SET "channelConfigVersion" = channels."configVersion"
FROM "payment_channels" AS channels
WHERE channels."id" = orders."channelId";

CREATE INDEX "payment_channel_configs_createdAt_idx" ON "payment_channel_configs"("createdAt");

ALTER TABLE "payment_channel_configs"
  ADD CONSTRAINT "payment_channel_configs_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "payment_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_channelId_channelConfigVersion_fkey"
  FOREIGN KEY ("channelId", "channelConfigVersion")
  REFERENCES "payment_channel_configs"("channelId", "version")
  ON DELETE RESTRICT ON UPDATE CASCADE;
