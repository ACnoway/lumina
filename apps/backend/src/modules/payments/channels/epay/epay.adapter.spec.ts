import { createHash } from 'crypto';
import axios from 'axios';
import { PaymentMethod, PaymentScene } from '@prisma/client';
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
      scenes: ['WEB', 'H5', 'QR'],
    });
  });

  const paymentContext = {
    orderNo: 'LM202609190000001234',
    notifyUrl: 'https://lumina.example.com/payment/notify',
    returnUrl: 'https://lumina.example.com/payment/return',
  };

  const paymentRequest = (scene: PaymentScene) =>
    ({
      amount: { toFixed: () => '10.00' },
      paymentMethod: PaymentMethod.ALIPAY,
      scene,
      subject: 'Test order',
    }) as never;

  it('uses a redirect URL for web and H5 flows even when Epay also returns a QR code', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        qrcode: 'weixin://wxpay/bizpayurl?pr=qr',
        url: 'https://pay.example.com/cashier',
        trade_no: 'T202609190001',
      },
    } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(PaymentScene.WEB), config),
    ).resolves.toEqual({
      action: { type: 'REDIRECT_URL', url: 'https://pay.example.com/cashier' },
      providerTradeNo: 'T202609190001',
    });
    await expect(
      adapter.createPayment(paymentContext, paymentRequest(PaymentScene.H5), config),
    ).resolves.toEqual({
      action: { type: 'REDIRECT_URL', url: 'https://pay.example.com/cashier' },
      providerTradeNo: 'T202609190001',
    });
    jest.restoreAllMocks();
  });

  it('detects an Epay HTML form before treating raw text as a redirect URL', async () => {
    const html = '<form action="https://pay.example.com/cashier" method="post"><input name="token" value="abc"></form>';
    jest.spyOn(axios, 'post').mockResolvedValue({ data: html } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(PaymentScene.WEB), config),
    ).resolves.toEqual({ action: { type: 'HTML_FORM', html } });
    jest.restoreAllMocks();
  });

  it('keeps Epay QR behavior when the QR scene is requested', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        qrcode: 'weixin://wxpay/bizpayurl?pr=qr',
        url: 'https://pay.example.com/cashier',
        trade_no: 'T202609190001',
      },
    } as never);

    await expect(
      adapter.createPayment(paymentContext, paymentRequest(PaymentScene.QR), config),
    ).resolves.toEqual({
      action: { type: 'QR_CODE', content: 'weixin://wxpay/bizpayurl?pr=qr' },
      providerTradeNo: 'T202609190001',
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

  it('uses the authenticated order query when a GET callback signature is rejected', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        code: 1,
        status: 1,
        trade_no: 'T202609190001',
        money: '10.00',
      },
    } as never);

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
    ).resolves.toMatchObject({
      orderNo: 'LM202609190000001234',
      providerTradeNo: 'T202609190001',
      status: 'SUCCESS',
      amount: '10.00',
      signatureValid: false,
    });
    expect(axios.get).toHaveBeenCalledWith('https://pay.example.com/api.php', {
      params: {
        act: 'order',
        pid: config.pid,
        key: config.key,
        out_trade_no: 'LM202609190000001234',
      },
      timeout: 10000,
    });
    jest.restoreAllMocks();
  });

  it('does not treat a successful query response as a successful payment', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
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
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
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
