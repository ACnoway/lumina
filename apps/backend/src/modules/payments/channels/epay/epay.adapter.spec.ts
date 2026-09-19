import { createHash } from 'crypto';
import axios from 'axios';
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
