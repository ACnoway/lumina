import { parseMinioPort, parseMinioUseSsl } from './minio.service';

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
});
