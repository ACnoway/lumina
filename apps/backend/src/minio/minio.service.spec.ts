import {
  parseMinioPort,
  parseMinioPublicUrl,
  parseMinioUseSsl,
} from './minio.service';

describe('MinIO environment configuration', () => {
  it('converts a Docker Compose port environment variable to a number', () => {
    expect(parseMinioPort('9000')).toBe(9000);
    expect(parseMinioPort(9001)).toBe(9001);
  });

  it('rejects invalid MinIO ports before constructing the SDK client', () => {
    expect(() => parseMinioPort('not-a-port')).toThrow(
      'MINIO_PORT must be an integer between 1 and 65535',
    );
    expect(() => parseMinioPort('65536')).toThrow(
      'MINIO_PORT must be an integer between 1 and 65535',
    );
  });

  it('converts Docker Compose boolean environment variables to booleans', () => {
    expect(parseMinioUseSsl('false')).toBe(false);
    expect(parseMinioUseSsl('true')).toBe(true);
    expect(parseMinioUseSsl(false)).toBe(false);
    expect(parseMinioUseSsl(true)).toBe(true);
  });

  it('parses a public URL into a path-style MinIO client endpoint', () => {
    expect(parseMinioPublicUrl('https://example.com')).toEqual({
      endPoint: 'example.com',
      port: 443,
      useSSL: true,
    });
    expect(parseMinioPublicUrl('http://localhost:3000')).toEqual({
      endPoint: 'localhost',
      port: 3000,
      useSSL: false,
    });
  });

  it('rejects a public URL with a path because it would break S3 signatures', () => {
    expect(() => parseMinioPublicUrl('https://example.com/storage')).toThrow(
      'MINIO_PUBLIC_URL must contain only scheme, host and optional port',
    );
  });
});
