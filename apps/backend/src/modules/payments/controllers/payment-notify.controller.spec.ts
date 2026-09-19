import { PaymentNotifyController } from './payment-notify.controller';

describe('PaymentNotifyController', () => {
  it('passes GET query notifications to the payment service', async () => {
    const paymentService = {
      processNotification: jest
        .fn()
        .mockResolvedValue({ body: 'success', contentType: 'text/plain' }),
    };
    const controller = new PaymentNotifyController(paymentService as never);
    const response = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const request = {
      headers: { host: 'lumina.oom.li' },
      query: {
        out_trade_no: 'LM-test',
        trade_status: 'TRADE_SUCCESS',
        sign: 'signature',
      },
      originalUrl:
        '/payments/notify/channel-1?out_trade_no=LM-test&trade_status=TRADE_SUCCESS&sign=signature',
    };

    await controller.notifyGet('channel-1', request as never, response as never);

    expect(paymentService.processNotification).toHaveBeenCalledWith('channel-1', {
      headers: request.headers,
      rawBody: Buffer.from('out_trade_no=LM-test&trade_status=TRADE_SUCCESS&sign=signature'),
      body: request.query,
    });
    expect(response.type).toHaveBeenCalledWith('text/plain');
    expect(response.send).toHaveBeenCalledWith('success');
  });

  it('keeps accepting POST notifications with the raw request body', async () => {
    const paymentService = {
      processNotification: jest
        .fn()
        .mockResolvedValue({ body: 'success', contentType: 'text/plain' }),
    };
    const controller = new PaymentNotifyController(paymentService as never);
    const response = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const rawBody = Buffer.from('payload');
    const request = { headers: {}, body: { order: 'LM-test' }, rawBody };

    await controller.notifyPost('channel-1', request as never, response as never);

    expect(paymentService.processNotification).toHaveBeenCalledWith('channel-1', {
      headers: request.headers,
      rawBody,
      body: request.body,
    });
  });
});
