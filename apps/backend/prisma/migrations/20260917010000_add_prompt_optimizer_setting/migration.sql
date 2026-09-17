-- CreateTable
CREATE TABLE "system_configs" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "promptOptimizerModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_promptOptimizerModelId_fkey" FOREIGN KEY ("promptOptimizerModelId") REFERENCES "platform_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
