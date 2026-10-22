import { BadRequestException } from '@nestjs/common';
import { MAX_CHAT_IMAGE_SIZE_BYTES, validateChatImages } from './chat-image';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('chat image validation', () => {
  it('accepts a PNG whose content signature matches its MIME type', () => {
    expect(() => validateChatImages([{ buffer: png, size: png.length, mimetype: 'image/png', originalname: 'test.png' }])).not.toThrow();
  });

  it('rejects an unsupported file even when its name and MIME type look like an image', () => {
    expect(() => validateChatImages([{ buffer: Buffer.from('not an image'), size: 12, mimetype: 'image/png', originalname: 'fake.png' }])).toThrow(BadRequestException);
  });

  it('rejects a MIME type that does not match the file signature', () => {
    expect(() => validateChatImages([{ buffer: png, size: png.length, mimetype: 'image/jpeg', originalname: 'fake.jpg' }])).toThrow(BadRequestException);
  });

  it('rejects images larger than 5 MiB', () => {
    const oversized = { buffer: png, size: MAX_CHAT_IMAGE_SIZE_BYTES + 1, mimetype: 'image/png', originalname: 'large.png' };
    expect(() => validateChatImages([oversized])).toThrow(BadRequestException);
  });
});
