-- CreateTable
CREATE TABLE "image_generation_images" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'PENDING',
    "width" INTEGER,
    "height" INTEGER,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "cost" DECIMAL(10,4),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_generation_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_generation_images_generationId_sequence_key" ON "image_generation_images"("generationId", "sequence");

-- CreateIndex
CREATE INDEX "image_generation_images_generationId_idx" ON "image_generation_images"("generationId");

-- CreateIndex
CREATE INDEX "image_generation_images_status_idx" ON "image_generation_images"("status");

-- AddForeignKey
ALTER TABLE "image_generation_images" ADD CONSTRAINT "image_generation_images_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "image_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
