import { createHash } from 'crypto';
import axios from 'axios';
import { PaymentMethod } from '@prisma/client';
import { EpayPaymentAdapter } from './epay.adapter';

function signEpayPayload(payload: Record<string, string>, key: string): string {
  const content = Object.keys(payload)
    .filter((name) => name !== 'sign' && name !== 'sign_type' && payload[name] !== '')
    .sort()
    .map((name) => `${name}=${payload[name]}`)
    .join('&');
  return createHash('md5').update(`${content}${key}`).digest('hex');
}

describe('EpayPaymentAdapter', () => {
  const adapter = new EpayPaymentAdapter();
  const config = {
    baseUrl: 'https://pay.example.com',
    pid: '10001',
    key: 'test-key',
  };

  it('rejects an HTTP endpoint so the merchant key is never sent in cleartext', async () => {
    await expect(adapter.validateConfig({ ...config, baseUrl: 'http://pay.example.com' })).rejects.toMatchObject({
      code: 'INVALID_CHANNEL_CONFIG',
    });
  });

  it('declares legacy action capabilities without making scenes part of the request', () => {
    expect(adapter.getMetadata()).toMatchObject({
      type: 'EPAY',
      methods: ['ALIPAY', 'WECHAT'],
      scenes: ['WEB', 'H5', 'QR'],
    });
  });

  const paymentContext = {
    orderNo: 'LM202609190000001234',
    notifyUrl: 'https://lumina.example.com/payment/notify',
    returnUrl: 'https://lumina.example.com/payment/return',
  };

  const paymentRequest = () =>
    ({
      amount: { toFixed: () => '10.00' },
      paymentMethod: PaymentMethod.ALIPAY,
      subject: 'Test order',
    }) as never;

  it('treats payurl as a redirect action even when Epay also returns a QR code', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        qrcode: 'weixin://wxpay/bizpayurl?pr=qr',
        payurl: 'https://pay.example.com/cashier',
        trade_no: 'T202609190001',
        code: 1,
      },
    } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(), config),
    ).resolves.toEqual({
      action: { type: 'REDIRECT_URL', url: 'https://pay.example.com/cashier' },
      providerTradeNo: 'T202609190001',
      legacyScene: 'WEB',
    });
    jest.restoreAllMocks();
  });

  it('detects an Epay HTML form before treating raw text as a redirect URL', async () => {
    const html = '<form action="https://pay.example.com/cashier" method="post"><input name="token" value="abc"></form>';
    jest.spyOn(axios, 'post').mockResolvedValue({ data: html } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(), config),
    ).resolves.toEqual({ action: { type: 'HTML_FORM', html }, legacyScene: 'WEB' });
    jest.restoreAllMocks();
  });

  it('uses a fixed signed subject for legacy submit.php forms', async () => {
    const result = await adapter.createPayment(
      paymentContext,
      paymentRequest(),
      { ...config, createEndpoint: 'submit.php' },
    );

    expect(result.action).toMatchObject({ type: 'HTML_FORM' });
    if (result.action.type !== 'HTML_FORM') throw new Error('expected a form action');
    expect(result.action.html).toContain('value="Lumina 光子充值"');
    expect(result.action.html).not.toContain('Test order');
  });

  it('returns a QR action when the provider only returns QR content', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        qrcode: 'weixin://wxpay/bizpayurl?pr=qr',
        trade_no: 'T202609190001',
        code: 1,
      },
    } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(), config),
    ).resolves.toEqual({
      action: { type: 'QR_CODE', content: 'weixin://wxpay/bizpayurl?pr=qr' },
      providerTradeNo: 'T202609190001',
      legacyScene: 'QR',
    });
    jest.restoreAllMocks();
  });

  it('verifies a V1 success notification', async () => {
    const payload: Record<string, string> = {
      money: '10.00',
      name: 'Lumina 光子充值',
      out_trade_no: 'LM202609190000001234',
      pid: config.pid,
      sign_type: 'MD5',
      trade_no: 'T202609190001',
      trade_status: 'TRADE_SUCCESS',
      type: 'alipay',
    };
    payload.sign = signEpayPayload(payload, config.key);

    await expect(
      adapter.parseNotification(
        {
          headers: {},
          rawBody: Buffer.from(new URLSearchParams(payload).toString()),
          body: payload,
        },
        config,
      ),
    ).resolves.toMatchObject({
      orderNo: 'LM202609190000001234',
      providerTradeNo: 'T202609190001',
      paymentMethod: PaymentMethod.ALIPAY,
      status: 'SUCCESS',
      amount: '10.00',
      signatureValid: true,
    });
  });

  it('rejects callback fields from another merchant even when their signature is valid', async () => {
    const payload: Record<string, string> = {
      money: '10.00',
      name: 'Lumina 光子充值',
      out_trade_no: 'LM202609190000001234',
      pid: 'another-merchant',
      sign_type: 'MD5',
      trade_no: 'T202609190001',
      trade_status: 'TRADE_SUCCESS',
      type: 'alipay',
    };
    payload.sign = signEpayPayload(payload, config.key);

    await expect(adapter.parseNotification({
      headers: {},
      rawBody: Buffer.from(new URLSearchParams(payload).toString()),
      body: payload,
    }, config)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('rejects ambiguous delimiter values and duplicate callback fields', async () => {
    const ambiguousPayload: Record<string, string> = {
      money: '10&money=0.01',
      name: 'Lumina 光子充值',
      out_trade_no: 'LM202609190000001234',
      pid: config.pid,
      sign_type: 'MD5',
      trade_no: 'T202609190001',
      trade_status: 'TRADE_SUCCESS',
      type: 'alipay',
    };
    ambiguousPayload.sign = signEpayPayload(ambiguousPayload, config.key);
    await expect(adapter.parseNotification({
      headers: {},
      rawBody: Buffer.from(new URLSearchParams(ambiguousPayload).toString()),
      body: {},
    }, config)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });

    await expect(adapter.parseNotification({
      headers: {},
      rawBody: Buffer.from('pid=10001&out_trade_no=LM202609190000001234&out_trade_no=LM202609190000009999&money=10.00&trade_status=TRADE_SUCCESS&sign=invalid'),
      body: {},
    }, config)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('rejects an invalid callback instead of silently trusting a follow-up query', async () => {
    await expect(
      adapter.parseNotification(
        {
          method: 'GET',
          headers: {},
          rawBody: Buffer.from('out_trade_no=LM202609190000001234&sign=invalid'),
          body: {
            out_trade_no: 'LM202609190000001234',
            sign: 'invalid',
            trade_status: 'TRADE_SUCCESS',
          },
        },
        config,
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('does not treat a successful query response as a successful payment', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        code: 1,
        status: 0,
        trade_no: 'T202609190002',
        money: '10.00',
      },
    } as never);

    await expect(adapter.queryPayment({ orderNo: 'LM202609190000001235' }, config)).resolves.toMatchObject({
      status: 'PENDING',
      providerTradeNo: 'T202609190002',
      amount: '10.00',
    });
    jest.restoreAllMocks();
  });

  it('keeps the payment pending when the query has no explicit order status', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        code: 1,
        trade_no: 'T202609190003',
        money: '10.00',
      },
    } as never);

    await expect(adapter.queryPayment({ orderNo: 'LM202609190000001236' }, config)).resolves.toMatchObject({
      status: 'PENDING',
    });
    jest.restoreAllMocks();
  });

  it('confirms Epay query success only for the requested merchant and order', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        code: 1,
        type: 'alipay',
        pid: config.pid,
        out_trade_no: 'LM202609190000001237',
        status: 1,
        trade_no: 'T202609190004',
        money: '10.00',
      },
    } as never);

    await expect(adapter.queryPayment({ orderNo: 'LM202609190000001237' }, config)).resolves.toMatchObject({
      status: 'SUCCESS',
      orderNo: 'LM202609190000001237',
      merchantId: config.pid,
      amount: '10.00',
    });
    jest.restoreAllMocks();
  });

  it('interprets timezone-less ISO payment times as China Standard Time', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        code: 1,
        type: 'alipay',
        pid: config.pid,
        out_trade_no: 'LM202609190000001238',
        status: 1,
        trade_no: 'T202609190005',
        money: '10.00',
        pay_time: '2026-11-15T12:00:00',
      },
    } as never);

    await expect(adapter.queryPayment({ orderNo: 'LM202609190000001238' }, config)).resolves.toMatchObject({
      status: 'SUCCESS',
      paidAt: new Date('2026-11-15T04:00:00.000Z'),
    });
    jest.restoreAllMocks();
  });
});
