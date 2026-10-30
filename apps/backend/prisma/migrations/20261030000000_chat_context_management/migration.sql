ALTER TABLE "platform_models"
ADD COLUMN "contextWindowTokens" INTEGER NOT NULL DEFAULT 8192;

UPDATE "platform_models"
SET "contextWindowTokens" = GREATEST(8192, COALESCE("maxTokens", 0) + 1024)
WHERE "type" = 'CHAT';

ALTER TABLE "chat_sessions"
ADD COLUMN "contextSummary" TEXT;

ALTER TABLE "chat_messages"
ADD COLUMN "contextCompacted" BOOLEAN NOT NULL DEFAULT false;
