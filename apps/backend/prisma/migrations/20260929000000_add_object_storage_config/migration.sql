-- Store the single active S3-compatible object storage configuration.
ALTER TABLE "system_configs"
  ADD COLUMN "objectStorageEndpoint" TEXT,
  ADD COLUMN "objectStoragePublicEndpoint" TEXT,
  ADD COLUMN "objectStorageRegion" TEXT,
  ADD COLUMN "objectStorageBucket" TEXT,
  ADD COLUMN "objectStorageForcePathStyle" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "objectStorageCredentialsEncrypted" TEXT,
  ADD COLUMN "objectStorageIsActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "objectStorageConfigVersion" INTEGER NOT NULL DEFAULT 1;
