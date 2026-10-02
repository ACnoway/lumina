import { createHash } from 'crypto';
import axios from 'axios';
import { PaymentMethod } from '@prisma/client';
import { EpayPaymentAdapter } from './epay.adapter';

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
      status: 'SUCCESS',
      amount: '10.00',
      signatureValid: true,
    });
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
});
