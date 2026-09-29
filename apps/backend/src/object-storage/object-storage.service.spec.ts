import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from './object-storage.service';

const bucketExists = jest.fn();
const putObject = jest.fn();
const statObject = jest.fn();
const getObject = jest.fn();
const removeObject = jest.fn();

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bucketExists,
    putObject,
    statObject,
    getObject,
    removeObject,
    presignedGetObject: jest.fn().mockResolvedValue('https://storage.test/signed'),
  })),
}));

function createService() {
  const systemConfig = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    systemConfig,
    imageGeneration: { findMany: jest.fn().mockResolvedValue([]) },
    imageGenerationImage: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const config = {
    get: jest.fn().mockReturnValue('test-object-storage-root-key'),
  };
  return {
    service: new ObjectStorageService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    ),
    prisma,
  };
}

const input = {
  endpoint: 'https://s3.example.com',
  publicEndpoint: 'https://cdn.example.com',
  region: 'us-east-1',
  bucket: 'lumina-images',
  forcePathStyle: false,
  accessKey: 'access-key',
  secretKey: 'secret-key',
  isActive: true,
};

describe('ObjectStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bucketExists.mockResolvedValue(true);
    putObject.mockResolvedValue(undefined);
    statObject.mockResolvedValue({});
    removeObject.mockResolvedValue(undefined);
  });

  it('validates an existing bucket without creating it', async () => {
    const { service } = createService();

    await expect(service.testConnection(input)).resolves.toEqual({
      ok: true,
      bucket: 'lumina-images',
      message: '对象存储连接成功，已验证 Bucket「lumina-images」存在。',
    });
    expect(bucketExists).toHaveBeenCalledWith('lumina-images');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('returns a clear error when the bucket is missing', async () => {
    bucketExists.mockResolvedValue(false);
    const { service } = createService();

    await expect(service.testConnection(input)).rejects.toThrow(
      '系统不会自动创建 Bucket',
    );
  });

  it('masks credentials in the admin response', async () => {
    const { service, prisma } = createService();
    const encrypted = (service as any).encryptCredentials({
      accessKey: 'access-key',
      secretKey: 'secret-key',
    });
    prisma.systemConfig.findUnique.mockResolvedValue({
      objectStorageEndpoint: 'https://s3.example.com',
      objectStoragePublicEndpoint: null,
      objectStorageRegion: 'us-east-1',
      objectStorageBucket: 'lumina-images',
      objectStorageForcePathStyle: false,
      objectStorageCredentialsEncrypted: encrypted,
      objectStorageIsActive: true,
      updatedAt: new Date('2026-09-29T00:00:00.000Z'),
    });

    const result = await service.getAdminConfig();

    expect(result).toMatchObject({
      configured: true,
      enabled: true,
      accessKeyMasked: 'ac••••ey',
      secretKeyMasked: '••••••••',
    });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('does not accept an endpoint with a path because it breaks signatures', async () => {
    const { service } = createService();

    await expect(
      service.testConnection({ ...input, endpoint: 'https://s3.example.com/path' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
