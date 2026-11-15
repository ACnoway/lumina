import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

type ConfigRecord = Record<string, unknown>;
type KeyRotation = { oldName: string; newName: string; label: string };

const rotations: KeyRotation[] = [
  {
    oldName: 'OLD_PAYMENT_CONFIG_ENCRYPTION_KEY',
    newName: 'NEW_PAYMENT_CONFIG_ENCRYPTION_KEY',
    label: 'payment',
  },
  {
    oldName: 'OLD_SMS_CONFIG_ENCRYPTION_KEY',
    newName: 'NEW_SMS_CONFIG_ENCRYPTION_KEY',
    label: 'sms',
  },
  {
    oldName: 'OLD_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY',
    newName: 'NEW_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY',
    label: 'object-storage',
  },
];

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret.trim(), 'utf8').digest();
}

function encrypt(value: ConfigRecord, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function decrypt(serialized: string, secret: string): ConfigRecord {
  const [version, ivValue, tagValue, ciphertextValue] = serialized.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('配置密文格式不合法');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  const parsed: unknown = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('配置内容不合法');
  }
  return parsed as ConfigRecord;
}

function requiredSecret(name: string): string {
  const secret = process.env[name]?.trim();
  if (!secret) throw new Error(`${name} is required`);
  return secret;
}

function validateNewSecret(name: string, value: string, oldValue: string): void {
  const normalized = value.toLowerCase();
  if (
    value.length < 32
    || value === oldValue
    || normalized.includes('change_this')
    || normalized.includes('your_jwt_secret')
    || normalized === 'lumina_password'
  ) {
    throw new Error(`${name} must be a new, non-example value with at least 32 characters`);
  }
}

async function main(): Promise<void> {
  const keyValues = rotations.map(({ oldName, newName }) => {
    const oldValue = requiredSecret(oldName);
    const newValue = requiredSecret(newName);
    validateNewSecret(newName, newValue, oldValue);
    return { oldValue, newValue };
  });

  const prisma = new PrismaClient();
  try {
    const [paymentChannels, smsChannels, systemConfig] = await Promise.all([
      prisma.paymentChannel.findMany({ select: { id: true, configEncrypted: true } }),
      prisma.smsChannel.findMany({ select: { id: true, configEncrypted: true } }),
      prisma.systemConfig.findUnique({
        where: { id: 1 },
        select: { objectStorageCredentialsEncrypted: true },
      }),
    ]);

    const paymentUpdates = paymentChannels.map((channel) => ({
      id: channel.id,
      configEncrypted: encrypt(decrypt(channel.configEncrypted, keyValues[0].oldValue), keyValues[0].newValue),
    }));
    const smsUpdates = smsChannels.map((channel) => ({
      id: channel.id,
      configEncrypted: encrypt(decrypt(channel.configEncrypted, keyValues[1].oldValue), keyValues[1].newValue),
    }));
    const objectStorageUpdate = systemConfig?.objectStorageCredentialsEncrypted
      ? encrypt(
        decrypt(systemConfig.objectStorageCredentialsEncrypted, keyValues[2].oldValue),
        keyValues[2].newValue,
      )
      : null;

    await prisma.$transaction(async (transaction) => {
      for (const channel of paymentUpdates) {
        await transaction.paymentChannel.update({
          where: { id: channel.id },
          data: { configEncrypted: channel.configEncrypted },
        });
      }
      for (const channel of smsUpdates) {
        await transaction.smsChannel.update({
          where: { id: channel.id },
          data: { configEncrypted: channel.configEncrypted },
        });
      }
      if (objectStorageUpdate && systemConfig) {
        await transaction.systemConfig.update({
          where: { id: 1 },
          data: { objectStorageCredentialsEncrypted: objectStorageUpdate },
        });
      }
    });

    console.log(
      `Rotated encrypted configuration for ${paymentUpdates.length} payment channels, `
      + `${smsUpdates.length} SMS channels, and ${objectStorageUpdate ? 1 : 0} object-storage record(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Configuration key rotation failed');
  process.exitCode = 1;
});
