import { createCipheriv, createSign, generateKeyPairSync } from 'crypto';
import axios from 'axios';
import { WechatPaymentAdapter } from './wechat.adapter';

function createKeys() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function sign(privateKey: string, message: string): string {
  return createSign('RSA-SHA256').update(message, 'utf8').sign(privateKey, 'base64');
}

describe('WechatPaymentAdapter', () => {
  const adapter = new WechatPaymentAdapter();
  const keys = createKeys();
  const config = {
    appId: 'wx-app',
    mchId: 'merchant-1',
    merchantSerialNo: 'serial-1',
    merchantPrivateKey: keys.privateKey,
    apiV3Key: '0123456789abcdef0123456789abcdef',
    wechatPayPublicKey: keys.publicKey,
  };

  afterEach(() => jest.restoreAllMocks());

  it('verifies API responses against the original response body before parsing JSON', async () => {
    const timestamp = '1794700000';
    const nonce = 'response-nonce';
    const rawBody = '{ "out_trade_no" : "LM-1", "trade_state":"SUCCESS", "amount":{"total":1000,"payer_total":800,"currency":"CNY"}, "success_time":"2026-11-15T10:00:00+08:00" }';
    const signature = sign(keys.privateKey, `${timestamp}\n${nonce}\n${rawBody}\n`);
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      data: rawBody,
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signature,
      },
    } as never);

    await expect(adapter.queryPayment({ orderNo: 'LM-1' }, config)).resolves.toMatchObject({
      status: 'SUCCESS',
      orderNo: 'LM-1',
      amount: '10.00',
      payerAmount: '8.00',
    });
    expect(request.mock.calls[0][0]).toMatchObject({
      responseType: 'text',
      transformResponse: expect.any(Array),
    });
  });

  it('checks the gross order total and retains the coupon-adjusted payer amount', async () => {
    const timestamp = '1794700000';
    const requestNonce = 'callback-nonce';
    const resourceNonce = '123456789012';
    const associatedData = 'transaction';
    const plaintext = JSON.stringify({
      out_trade_no: 'LM-2',
      transaction_id: 'WX-2',
      trade_state: 'SUCCESS',
      success_time: '2026-11-15T10:00:00+08:00',
      amount: { total: 1000, payer_total: 800, currency: 'CNY' },
    });
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.apiV3Key), Buffer.from(resourceNonce));
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const rawBody = Buffer.from(JSON.stringify({
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encrypted,
        nonce: resourceNonce,
        associated_data: associatedData,
      },
    }));
    const signature = sign(keys.privateKey, `${timestamp}\n${requestNonce}\n${rawBody.toString('utf8')}\n`);

    await expect(adapter.parseNotification({
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': requestNonce,
        'wechatpay-signature': signature,
      },
      rawBody,
      body: undefined,
    }, config)).resolves.toMatchObject({
      orderNo: 'LM-2',
      status: 'SUCCESS',
      amount: '10.00',
      payerAmount: '8.00',
    });
  });
});
