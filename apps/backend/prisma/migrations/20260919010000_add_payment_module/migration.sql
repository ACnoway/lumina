-- Add user-selected payment channels, payment orders and callback audit events.
CREATE TYPE "PaymentChannelType" AS ENUM ('EPAY', 'ALIPAY', 'WECHAT');
CREATE TYPE "PaymentMethod" AS ENUM ('ALIPAY', 'WECHAT');
CREATE TYPE "PaymentScene" AS ENUM ('WEB', 'H5', 'QR', 'JSAPI', 'APP');
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED', 'EXPIRED', 'REFUNDED');

CREATE TABLE "payment_channels" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PaymentChannelType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "publicConfig" JSONB,
  "configEncrypted" TEXT NOT NULL,
  "configVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
  "id" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "channelType" "PaymentChannelType" NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "scene" "PaymentScene" NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "photonAmount" DECIMAL(18,6) NOT NULL,
  "photonPerCny" DECIMAL(18,6) NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
  "providerTradeNo" TEXT,
  "paidAmount" DECIMAL(10,2),
  "paidAt" TIMESTAMP(3),
  "expireAt" TIMESTAMP(3),
  "clientIp" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_callback_events" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "orderNo" TEXT,
  "eventKey" TEXT NOT NULL,
  "signatureValid" BOOLEAN NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "payloadHash" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "payment_callback_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_orders_orderNo_key" ON "payment_orders"("orderNo");
CREATE UNIQUE INDEX "payment_orders_userId_idempotencyKey_key" ON "payment_orders"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "payment_callback_events_channelId_eventKey_key" ON "payment_callback_events"("channelId", "eventKey");
CREATE INDEX "payment_channels_type_idx" ON "payment_channels"("type");
CREATE INDEX "payment_channels_isActive_idx" ON "payment_channels"("isActive");
CREATE INDEX "payment_orders_userId_idx" ON "payment_orders"("userId");
CREATE INDEX "payment_orders_channelId_idx" ON "payment_orders"("channelId");
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");
CREATE INDEX "payment_orders_providerTradeNo_idx" ON "payment_orders"("providerTradeNo");
CREATE INDEX "payment_orders_createdAt_idx" ON "payment_orders"("createdAt");
CREATE INDEX "payment_callback_events_orderNo_idx" ON "payment_callback_events"("orderNo");
CREATE INDEX "payment_callback_events_createdAt_idx" ON "payment_callback_events"("createdAt");

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "payment_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_callback_events"
  ADD CONSTRAINT "payment_callback_events_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "payment_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
