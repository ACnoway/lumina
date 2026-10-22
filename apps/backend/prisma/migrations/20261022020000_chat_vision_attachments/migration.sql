ALTER TABLE "platform_models"
ADD COLUMN "supportsVision" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_attachments_objectKey_key" ON "chat_attachments"("objectKey");
CREATE INDEX "chat_attachments_messageId_idx" ON "chat_attachments"("messageId");

ALTER TABLE "chat_attachments"
ADD CONSTRAINT "chat_attachments_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
