import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

export interface ParsedMinioPublicUrl {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

export function parseMinioPort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MINIO_PORT must be an integer between 1 and 65535');
  }

  return port;
}

export function parseMinioUseSsl(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === '') {
      return false;
    }
  }

  throw new Error('MINIO_USE_SSL must be true or false');
}

/**
 * 解析用于生成预签名 URL 的公开入口。
 * 公开地址必须是根路径，图片 URL 会使用 /<bucket>/<object> 的 path-style 格式。
 */
export function parseMinioPublicUrl(value: unknown): ParsedMinioPublicUrl {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('MINIO_PUBLIC_URL must be a non-empty HTTP(S) URL');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MINIO_PUBLIC_URL must be a valid HTTP(S) URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MINIO_PUBLIC_URL must use http or https');
  }

  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('MINIO_PUBLIC_URL must contain only scheme, host and optional port');
  }

  return {
    endPoint: url.hostname,
    port: parseMinioPort(url.port || (url.protocol === 'https:' ? 443 : 80)),
    useSSL: url.protocol === 'https:',
  };
}

@Injectable()
export class MinioService implements OnModuleInit {
  private client!: Minio.Client;
  private publicClient!: Minio.Client;
  private bucketName!: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const endpoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = parseMinioPort(this.configService.get('MINIO_PORT', 9000));
    const useSSL = parseMinioUseSsl(this.configService.get('MINIO_USE_SSL', false));
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY')!;
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY')!;
    this.bucketName = this.configService.get<string>('MINIO_BUCKET', 'lumina-images');

    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
      pathStyle: true,
    });

    const publicUrl = this.configService.get<string>('MINIO_PUBLIC_URL')?.trim();
    this.publicClient = publicUrl
      ? new Minio.Client({
          ...parseMinioPublicUrl(publicUrl),
          accessKey,
          secretKey,
          pathStyle: true,
        })
      : this.client;

    // 确保 bucket 存在
    const exists = await this.client.bucketExists(this.bucketName);
    if (!exists) {
      await this.client.makeBucket(this.bucketName, 'us-east-1');
      console.log(`✅ MinIO bucket '${this.bucketName}' created`);
    }
  }

  getClient(): Minio.Client {
    return this.client;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * 上传文件
   */
  async upload(objectName: string, stream: Buffer | NodeJS.ReadableStream, size?: number) {
    await this.client.putObject(this.bucketName, objectName, stream as any, size);
    return objectName;
  }

  /**
   * 获取预签名 URL（用于前端直接访问）
   */
  async getPresignedUrl(objectName: string, expiry: number = 7 * 24 * 3600): Promise<string> {
    return this.publicClient.presignedGetObject(this.bucketName, objectName, expiry);
  }

  /**
   * 删除文件
   */
  async delete(objectName: string): Promise<void> {
    await this.client.removeObject(this.bucketName, objectName);
  }
}
