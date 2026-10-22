import { BadRequestException } from '@nestjs/common';

export const MAX_CHAT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGES_PER_MESSAGE = 4;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = MAX_CHAT_IMAGE_SIZE_BYTES * MAX_CHAT_IMAGES_PER_MESSAGE;

export interface UploadedChatImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateChatImages(images: UploadedChatImage[]): void {
  if (images.length > MAX_CHAT_IMAGES_PER_MESSAGE) {
    throw new BadRequestException(`每条消息最多上传 ${MAX_CHAT_IMAGES_PER_MESSAGE} 张图片`);
  }

  let totalBytes = 0;
  for (const image of images) {
    if (!image.size || image.size > MAX_CHAT_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('单张图片大小不能超过 5 MiB');
    }
    totalBytes += image.size;

    const detectedType = detectImageType(image.buffer);
    if (!detectedType || !SUPPORTED_IMAGE_TYPES.has(detectedType)) {
      throw new BadRequestException('仅支持 JPEG、PNG 和 WebP 图片');
    }
    if (image.mimetype !== detectedType) {
      throw new BadRequestException('图片文件内容与声明的格式不一致');
    }
  }

  if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
    throw new BadRequestException('单条消息图片总大小不能超过 20 MiB');
  }
}

function detectImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
