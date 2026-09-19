import { ConfigService } from '@nestjs/config';
import { PaymentConfigCryptoService } from './payment-config-crypto.service';

describe('PaymentConfigCryptoService', () => {
  it('encrypts and decrypts channel configuration', () => {
    const service = new PaymentConfigCryptoService({
      get: jest.fn().mockReturnValue('test-payment-key'),
    } as unknown as ConfigService);
    const config = { appId: 'app-1', privateKey: 'secret', enabled: true };

    const encrypted = service.encrypt(config);

    expect(encrypted).not.toContain('privateKey');
    expect(service.decrypt(encrypted)).toEqual(config);
  });

  it('rejects tampered ciphertext', () => {
    const service = new PaymentConfigCryptoService({
      get: jest.fn().mockReturnValue('test-payment-key'),
    } as unknown as ConfigService);
    const encrypted = service.encrypt({ key: 'secret' });
    const parts = encrypted.split('.');
    parts[3] = `${parts[3].startsWith('A') ? 'B' : 'A'}${parts[3].slice(1)}`;

    expect(() => service.decrypt(parts.join('.'))).toThrow();
  });
});
