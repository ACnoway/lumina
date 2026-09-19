-- Add the platform currency exchange setting and preserve existing monetary values.
ALTER TABLE "system_configs"
ADD COLUMN "photonPerCny" DECIMAL(18,6) NOT NULL DEFAULT 10.000000;

ALTER TABLE "wallets"
ALTER COLUMN "balance" TYPE DECIMAL(18,6);

ALTER TABLE "wallet_transactions"
ALTER COLUMN "amount" TYPE DECIMAL(18,6),
ALTER COLUMN "balance" TYPE DECIMAL(18,6);

ALTER TABLE "chat_messages"
ALTER COLUMN "cost" TYPE DECIMAL(18,6);

ALTER TABLE "image_generations"
ALTER COLUMN "cost" TYPE DECIMAL(18,6);

ALTER TABLE "image_generation_images"
ALTER COLUMN "cost" TYPE DECIMAL(18,6);
