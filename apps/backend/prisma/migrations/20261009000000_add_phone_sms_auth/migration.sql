-- Allow legacy email accounts to continue working while supporting phone-only accounts.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "users_phone_idx" ON "users"("phone");

CREATE TYPE "SmsChannelType" AS ENUM ('MOCK', 'ALIYUN', 'TENCENT');

CREATE TABLE "sms_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SmsChannelType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publicConfig" JSONB,
    "configEncrypted" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_channels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_channels_type_idx" ON "sms_channels"("type");
CREATE INDEX "sms_channels_isActive_idx" ON "sms_channels"("isActive");
