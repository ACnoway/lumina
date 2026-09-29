import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as Minio from 'minio';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { ObjectStorageConfigDto, ObjectStorageTestResponse } from '@lumina/shared';

const GLOBAL_CONFIG_ID = 1;
const PRESIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export interface ObjectStorageConfigInput {
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKey?: string;
  secretKey?: string;
  isActive: boolean;
}

interface ResolvedObjectStorageConfig {
  endpoint: string;
  publicEndpoint: string | null;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKey: string;
  secretKey: string;
  isActive: boolean;
}

interface StoredObjectStorageConfig extends ResolvedObjectStorageConfig {
  updatedAt: Date;
}

interface ObjectStorageClientPair {
  client: Minio.Client;
  publicClient: Minio.Client;
}

interface SaveObjectStorageResult {
  config: ObjectStorageConfigDto;
  migratedObjectCount: number;
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private clients: ObjectStorageClientPair | null = null;
  private activeConfig: ResolvedObjectStorageConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      // A broken or incomplete admin configuration must not prevent the API from
      // starting. Image generation will return the actionable error instead.
      this.clients = null;
      this.activeConfig = null;
      this.logger.warn(`对象存储配置未加载: ${this.describeError(error)}`);
    }
  }

  async getAdminConfig(): Promise<ObjectStorageConfigDto> {
    const record = await this.getStoredRecord();
    if (!record) {
      return {
        configured: false,
        enabled: false,
        endpoint: null,
        publicEndpoint: null,
        region: null,
        bucket: null,
        forcePathStyle: true,
        accessKeyMasked: null,
        secretKeyMasked: null,
        updatedAt: null,
      };
    }

    let accessKeyMasked: string | null = null;
    let credentialsConfigured = false;
    if (record.objectStorageCredentialsEncrypted) {
      try {
        const credentials = this.decryptCredentials(record.objectStorageCredentialsEncrypted);
        credentialsConfigured = true;
        accessKeyMasked = this.maskSecret(credentials.accessKey);
      } catch (error) {
        this.logger.warn(`对象存储密钥无法解密: ${this.describeError(error)}`);
      }
    }

    return {
      configured: Boolean(
        record.objectStorageEndpoint &&
          record.objectStorageRegion &&
          record.objectStorageBucket &&
          credentialsConfigured,
      ),
      enabled: record.objectStorageIsActive,
      endpoint: record.objectStorageEndpoint,
      publicEndpoint: record.objectStoragePublicEndpoint,
      region: record.objectStorageRegion,
      bucket: record.objectStorageBucket,
      forcePathStyle: record.objectStorageForcePathStyle,
      accessKeyMasked,
      secretKeyMasked: credentialsConfigured ? '••••••••' : null,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async testConnection(input: ObjectStorageConfigInput): Promise<ObjectStorageTestResponse> {
    const candidate = await this.resolveInput(input);
    const clients = this.createClients(candidate);
    await this.assertBucketExists(clients.client, candidate.bucket);

    return {
      ok: true,
      bucket: candidate.bucket,
      message: `对象存储连接成功，已验证 Bucket「${candidate.bucket}」存在。`,
    };
  }

  async saveConfig(input: ObjectStorageConfigInput): Promise<SaveObjectStorageResult> {
    const candidate = await this.resolveInput(input);
    const candidateClients = this.createClients(candidate);
    await this.assertBucketExists(candidateClients.client, candidate.bucket);

    const previous = await this.getStoredConfig();
    const shouldMigrate = Boolean(
      previous &&
        (previous.endpoint !== candidate.endpoint || previous.bucket !== candidate.bucket),
    );
    let migratedObjectCount = 0;
    let migratedObjectKeys: string[] = [];

    if (shouldMigrate && previous) {
      migratedObjectKeys = await this.migrateImageObjects(previous, candidate, candidateClients);
      migratedObjectCount = migratedObjectKeys.length;
    }

    await this.prisma.systemConfig.upsert({
      where: { id: GLOBAL_CONFIG_ID },
      create: {
        id: GLOBAL_CONFIG_ID,
        objectStorageEndpoint: candidate.endpoint,
        objectStoragePublicEndpoint: candidate.publicEndpoint,
        objectStorageRegion: candidate.region,
        objectStorageBucket: candidate.bucket,
        objectStorageForcePathStyle: candidate.forcePathStyle,
        objectStorageCredentialsEncrypted: this.encryptCredentials({
          accessKey: candidate.accessKey,
          secretKey: candidate.secretKey,
        }),
        objectStorageIsActive: candidate.isActive,
        objectStorageConfigVersion: 1,
      },
      update: {
        objectStorageEndpoint: candidate.endpoint,
        objectStoragePublicEndpoint: candidate.publicEndpoint,
        objectStorageRegion: candidate.region,
        objectStorageBucket: candidate.bucket,
        objectStorageForcePathStyle: candidate.forcePathStyle,
        objectStorageCredentialsEncrypted: this.encryptCredentials({
          accessKey: candidate.accessKey,
          secretKey: candidate.secretKey,
        }),
        objectStorageIsActive: candidate.isActive,
        objectStorageConfigVersion: { increment: 1 },
      },
    });

    if (previous && migratedObjectKeys.length > 0) {
      await this.removeMigratedSourceObjects(previous, migratedObjectKeys);
    }

    await this.refresh();
    return {
      config: await this.getAdminConfig(),
      migratedObjectCount,
    };
  }

  async refresh(): Promise<void> {
    const config = await this.getStoredConfig();
    if (!config || !config.isActive) {
      this.activeConfig = null;
      this.clients = null;
      return;
    }

    this.activeConfig = config;
    this.clients = this.createClients(config);
  }

  async upload(objectName: string, stream: Buffer | NodeJS.ReadableStream, size?: number) {
    const { config, clients } = this.requireActiveStorage();
    await clients.client.putObject(config.bucket, objectName, stream as any, size);
    return objectName;
  }

  async getPresignedUrl(
    objectName: string,
    expiry: number = PRESIGNED_URL_EXPIRY_SECONDS,
  ): Promise<string> {
    const { config, clients } = this.requireActiveStorage();
    return clients.publicClient.presignedGetObject(config.bucket, objectName, expiry);
  }

  async delete(objectName: string): Promise<void> {
    const { config, clients } = this.requireActiveStorage();
    await clients.client.removeObject(config.bucket, objectName);
  }

  private async resolveInput(input: ObjectStorageConfigInput): Promise<ResolvedObjectStorageConfig> {
    const previous = await this.getStoredConfig();
    const accessKey = input.accessKey?.trim() || previous?.accessKey || '';
    const secretKey = input.secretKey?.trim() || previous?.secretKey || '';

    const endpoint = this.normalizeEndpoint(input.endpoint, 'Endpoint');
    const publicEndpoint = input.publicEndpoint?.trim()
      ? this.normalizeEndpoint(input.publicEndpoint, '对外 Endpoint')
      : null;
    const region = input.region.trim();
    const bucket = input.bucket.trim();

    if (!region) throw new BadRequestException('Region 不能为空');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new BadRequestException('Bucket 名称不合法，请使用 3-63 位小写字母、数字、点或连字符');
    }
    if (!accessKey || !secretKey) {
      throw new BadRequestException('Access Key 和 Secret Key 必须填写');
    }

    return {
      endpoint,
      publicEndpoint,
      region,
      bucket,
      forcePathStyle: Boolean(input.forcePathStyle),
      accessKey,
      secretKey,
      isActive: Boolean(input.isActive),
    };
  }

  private createClients(config: ResolvedObjectStorageConfig): ObjectStorageClientPair {
    const client = new Minio.Client(this.clientOptions(config.endpoint, config));
    const publicClient = config.publicEndpoint
      ? new Minio.Client(this.clientOptions(config.publicEndpoint, config))
      : client;
    return { client, publicClient };
  }

  private clientOptions(endpoint: string, config: ResolvedObjectStorageConfig): Minio.ClientOptions {
    const url = new URL(endpoint);
    return {
      endPoint: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:',
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
      pathStyle: config.forcePathStyle,
    };
  }

  private async assertBucketExists(client: Minio.Client, bucket: string): Promise<void> {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        throw new BadRequestException(
          `Bucket「${bucket}」不存在或当前凭证无权访问；系统不会自动创建 Bucket。`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`对象存储连接失败：${this.describeError(error)}`);
    }
  }

  private async migrateImageObjects(
    previous: ResolvedObjectStorageConfig,
    candidate: ResolvedObjectStorageConfig,
    candidateClients: ObjectStorageClientPair,
  ): Promise<string[]> {
    let previousClients: ObjectStorageClientPair;
    try {
      previousClients = this.createClients(previous);
      await this.assertBucketExists(previousClients.client, previous.bucket);
    } catch (error) {
      throw new BadRequestException(`无法读取原对象存储，迁移已中止：${this.describeError(error)}`);
    }

    const [generationRows, imageRows] = await Promise.all([
      this.prisma.imageGeneration.findMany({
        where: { imageKey: { not: null } },
        select: { imageKey: true },
      }),
      this.prisma.imageGenerationImage.findMany({
        where: { imageKey: { not: null } },
        select: { imageKey: true },
      }),
    ]);
    const keys = [
      ...generationRows.map((row) => row.imageKey),
      ...imageRows.map((row) => row.imageKey),
    ].filter((key): key is string => Boolean(key));
    const uniqueKeys = [...new Set(keys)];

    for (const key of uniqueKeys) {
      try {
        const sourceStream = await previousClients.client.getObject(previous.bucket, key);
        const contents = await this.readStream(sourceStream);
        await candidateClients.client.putObject(candidate.bucket, key, contents, contents.length);
        await candidateClients.client.statObject(candidate.bucket, key);
      } catch (error) {
        throw new BadRequestException(
          `对象「${key}」迁移失败，配置未保存：${this.describeError(error)}`,
        );
      }
    }

    return uniqueKeys;
  }

  private async removeMigratedSourceObjects(
    previous: ResolvedObjectStorageConfig,
    keys: string[],
  ): Promise<void> {
    const previousClients = this.createClients(previous);
    for (const key of keys) {
      try {
        await previousClients.client.removeObject(previous.bucket, key);
      } catch (error) {
        this.logger.warn(`对象存储已切换，但原对象「${key}」删除失败：${this.describeError(error)}`);
      }
    }
  }

  private async readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async getStoredRecord() {
    return this.prisma.systemConfig.findUnique({
      where: { id: GLOBAL_CONFIG_ID },
      select: {
        objectStorageEndpoint: true,
        objectStoragePublicEndpoint: true,
        objectStorageRegion: true,
        objectStorageBucket: true,
        objectStorageForcePathStyle: true,
        objectStorageCredentialsEncrypted: true,
        objectStorageIsActive: true,
        updatedAt: true,
      },
    });
  }

  private async getStoredConfig(): Promise<StoredObjectStorageConfig | null> {
    const record = await this.getStoredRecord();
    if (
      !record?.objectStorageEndpoint ||
      !record.objectStorageRegion ||
      !record.objectStorageBucket ||
      !record.objectStorageCredentialsEncrypted
    ) {
      return null;
    }

    const credentials = this.decryptCredentials(record.objectStorageCredentialsEncrypted);
    return {
      endpoint: record.objectStorageEndpoint,
      publicEndpoint: record.objectStoragePublicEndpoint,
      region: record.objectStorageRegion,
      bucket: record.objectStorageBucket,
      forcePathStyle: record.objectStorageForcePathStyle,
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
      isActive: record.objectStorageIsActive,
      updatedAt: record.updatedAt,
    };
  }

  private normalizeEndpoint(value: string, label: string): string {
    const trimmed = value.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new BadRequestException(`${label} 必须是有效的 HTTP(S) 地址`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(`${label} 必须使用 http 或 https`);
    }
    if (
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new BadRequestException(`${label} 只能包含协议、主机和可选端口，不能包含路径`);
    }
    return url.toString().replace(/\/$/, '');
  }

  private encryptCredentials(credentials: { accessKey: string; secretKey: string }): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
  }

  private decryptCredentials(serialized: string): { accessKey: string; secretKey: string } {
    const [version, ivValue, tagValue, ciphertextValue] = serialized.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('对象存储配置密文格式不合法');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivValue, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).accessKey !== 'string' ||
      typeof (parsed as Record<string, unknown>).secretKey !== 'string'
    ) {
      throw new Error('对象存储配置内容不合法');
    }
    return parsed as { accessKey: string; secretKey: string };
  }

  private encryptionKey(): Buffer {
    const value = this.configService.get<string>('OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY')?.trim();
    if (!value) {
      throw new Error('OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY 未配置');
    }
    return createHash('sha256').update(value, 'utf8').digest();
  }

  private requireActiveStorage(): {
    config: ResolvedObjectStorageConfig;
    clients: ObjectStorageClientPair;
  } {
    if (!this.activeConfig || !this.clients) {
      throw new ServiceUnavailableException('对象存储未配置或未启用，请管理员先完成连接测试和保存');
    }
    return { config: this.activeConfig, clients: this.clients };
  }

  private maskSecret(value: string): string {
    if (!value) return '';
    if (value.length <= 4) return '••••';
    return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  }

  private describeError(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error || '未知错误');
    const value = error as { message?: unknown; code?: unknown; name?: unknown };
    const message = typeof value.message === 'string' && value.message ? value.message : '未提供错误消息';
    const code = value.code || value.name;
    return code ? `${message} (${String(code)})` : message;
  }
}
