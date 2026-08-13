import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private client!: Minio.Client;
  private bucketName!: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const endpoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = this.configService.get<number>('MINIO_PORT', 9000);
    const useSSL = this.configService.get<boolean>('MINIO_USE_SSL', false);
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY')!;
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY')!;
    this.bucketName = this.configService.get<string>('MINIO_BUCKET', 'lumina-images');

    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

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
    return this.client.presignedGetObject(this.bucketName, objectName, expiry);
  }

  /**
   * 删除文件
   */
  async delete(objectName: string): Promise<void> {
    await this.client.removeObject(this.bucketName, objectName);
  }
}
