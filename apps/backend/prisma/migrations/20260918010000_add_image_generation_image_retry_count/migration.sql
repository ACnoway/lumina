-- AlterTable
ALTER TABLE "image_generation_images"
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
