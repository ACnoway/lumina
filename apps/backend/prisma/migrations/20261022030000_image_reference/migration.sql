ALTER TABLE "platform_models"
ADD COLUMN "supportsReferenceImage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "image_generations"
ADD COLUMN "referenceImageKey" TEXT,
ADD COLUMN "referenceImageMimeType" TEXT,
ADD COLUMN "referenceImageSize" INTEGER;
