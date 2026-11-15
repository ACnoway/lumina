import { createSign, generateKeyPairSync } from 'crypto';
import { AlipayPaymentAdapter } from './alipay.adapter';

function createKeys() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signPayload(payload: Record<string, string>, privateKey: string): string {
  const content = Object.keys(payload)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && payload[key] !== '')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('&');
  return createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
}

describe('AlipayPaymentAdapter', () => {
  const adapter = new AlipayPaymentAdapter();
  const keys = createKeys();
  const config = {
    appId: 'app-1',
    sellerId: 'seller-1',
    privateKey: keys.privateKey,
    alipayPublicKey: keys.publicKey,
  };

  function notification(overrides: { app_id?: string; seller_id?: string } = {}) {
    const payload = {
      app_id: 'app-1',
      seller_id: 'seller-1',
      out_trade_no: 'LM-1',
      trade_no: 'ALI-1',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '10.00',
      gmt_payment: '2026-11-15 12:00:00',
      ...overrides,
    };
    return {
      headers: {},
      rawBody: Buffer.alloc(0),
      body: { ...payload, sign: signPayload(payload, keys.privateKey) },
    };
  }

  it('verifies the notification and binds it to the configured app and seller', async () => {
    await expect(adapter.parseNotification(notification(), config)).resolves.toMatchObject({
      applicationId: 'app-1',
      merchantId: 'seller-1',
      orderNo: 'LM-1',
      amount: '10.00',
      status: 'SUCCESS',
      paidAt: new Date('2026-11-15T04:00:00.000Z'),
    });
  });

  it.each([
    ['a different application', { app_id: 'other-app' }],
    ['a different seller', { seller_id: 'other-seller' }],
  ] as Array<[string, { app_id?: string; seller_id?: string }]>)('rejects a validly signed notification for %s', async (_description, identity) => {
    await expect(adapter.parseNotification(notification(identity), config)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
  });
});
