-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('WAITING_FOR_AGENT', 'WAITING_FOR_USER', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageSenderType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'WAITING_FOR_AGENT',
    "lastMessagePreview" VARCHAR(160),
    "lastMessageAt" TIMESTAMP(3),
    "userUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "adminUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" "SupportMessageSenderType" NOT NULL,
    "senderId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_userId_key" ON "support_conversations"("userId");
CREATE INDEX "support_conversations_userId_status_idx" ON "support_conversations"("userId", "status");
CREATE INDEX "support_conversations_status_lastMessageAt_idx" ON "support_conversations"("status", "lastMessageAt");
CREATE INDEX "support_conversations_adminUnreadCount_lastMessageAt_idx" ON "support_conversations"("adminUnreadCount", "lastMessageAt");
CREATE INDEX "support_messages_conversationId_createdAt_idx" ON "support_messages"("conversationId", "createdAt");
CREATE INDEX "support_messages_senderType_createdAt_idx" ON "support_messages"("senderType", "createdAt");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
