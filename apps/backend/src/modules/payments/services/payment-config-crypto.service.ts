import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

@Injectable()
export class PaymentConfigCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
  }

  decrypt(serialized: string): Record<string, unknown> {
    const [version, ivValue, tagValue, ciphertextValue] = serialized.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('支付渠道配置密文格式不合法');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(ivValue, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('支付渠道配置内容不合法');
    }
    return parsed as Record<string, unknown>;
  }

  private key(): Buffer {
    const value = this.config.get<string>('PAYMENT_CONFIG_ENCRYPTION_KEY')?.trim();
    if (!value) {
      throw new Error('PAYMENT_CONFIG_ENCRYPTION_KEY 未配置');
    }
    return createHash('sha256').update(value, 'utf8').digest();
  }
}
