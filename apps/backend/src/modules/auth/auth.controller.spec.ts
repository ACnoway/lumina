import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AuditService } from '../audit/audit.service';
import { AdminSmsChannelsController } from '../sms/controllers/admin-sms-channels.controller';
import { SmsChannelError, SmsErrorCode } from '../sms/core/sms.errors';
import { SmsChannelService } from '../sms/services/sms-channel.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

describe('SMS HTTP routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const auth = { sendSmsCode: jest.fn(), sendCode: jest.fn() };
  const channels = { test: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController, AdminSmsChannelsController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SmsChannelService, useValue: channels },
        { provide: AuditService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => jest.resetAllMocks());
  afterAll(async () => { await app?.close(); });

  async function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it.each([
    ['/auth/register/send-code', { phone: '13800000000' }, 'register'],
    ['/auth/send-code', { account: '13800000000' }, 'login'],
  ])('accepts POST %s and passes the client IP to rate limiting', async (path, body, purpose) => {
    const response = await post(path, body);
    expect(response.status).toBe(200);
    expect(auth.sendSmsCode).toHaveBeenCalledWith('13800000000', purpose, '127.0.0.1');
    await response.json();
  });

  it('does not send an SMS when the POST-only route is opened as a GET', async () => {
    const response = await fetch(`${baseUrl}/auth/register/send-code`);
    expect(response.status).toBe(404);
    expect(auth.sendSmsCode).not.toHaveBeenCalled();
    await response.json();
  });

  it('returns a safe service error for a provider template failure', async () => {
    auth.sendSmsCode.mockRejectedValueOnce(new ServiceUnavailableException({
      code: 'SMS_CONFIG_INVALID', message: '短信模板配置有误，请联系管理员',
    }));
    const response = await post('/auth/register/send-code', { phone: '13800000000' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'SMS_CONFIG_INVALID', message: '短信模板配置有误，请联系管理员' });
  });

  it('shows template compatibility errors to the administrator instead of an opaque 500', async () => {
    channels.test.mockRejectedValueOnce(new SmsChannelError(SmsErrorCode.INVALID_CHANNEL_CONFIG, '模板变量为 4 位，需要 6 位'));
    const response = await post('/admin/sms-channels/test-channel/test', {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CHANNEL_CONFIG', message: '模板变量为 4 位，需要 6 位' });
  });
});
