import { createHash } from 'crypto';
import { EpayPaymentAdapter } from './epay.adapter';

describe('EpayPaymentAdapter', () => {
  const adapter = new EpayPaymentAdapter();
  const config = {
    baseUrl: 'https://pay.example.com',
    pid: '10001',
    key: 'test-key',
  };

  it('declares user-selectable payment methods and scenes', () => {
    expect(adapter.getMetadata()).toMatchObject({
      type: 'EPAY',
      methods: ['ALIPAY', 'WECHAT'],
      scenes: ['WEB', 'QR'],
    });
  });

  it('verifies a V1 success notification', async () => {
    const payload: Record<string, string> = {
      money: '10.00',
      out_trade_no: 'LM202609190000001234',
      pid: config.pid,
      trade_no: 'T202609190001',
      trade_status: 'TRADE_SUCCESS',
    };
    const content = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key]}`)
      .join('&');
    payload.sign = createHash('md5').update(`${content}${config.key}`).digest('hex');

    await expect(adapter.parseNotification({
      headers: {},
      rawBody: Buffer.from(new URLSearchParams(payload).toString()),
      body: payload,
    }, config)).resolves.toMatchObject({
      orderNo: 'LM202609190000001234',
      providerTradeNo: 'T202609190001',
      status: 'SUCCESS',
      amount: '10.00',
    });
  });
});
