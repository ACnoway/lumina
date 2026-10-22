import { createHash } from 'crypto';
import axios from 'axios';
import { ChuanglanSmsAdapter } from './chuanglan-sms.adapter';

describe('ChuanglanSmsAdapter', () => {
  const adapter = new ChuanglanSmsAdapter();
  const config = {
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    templateCode: 'verify-template',
  };

  afterEach(() => jest.restoreAllMocks());

  it('posts a verification template with the AppID signature headers', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { code: '000000', data: { successNum: '1', failNum: '0', msgId: '1234567890' } },
    } as never);

    await adapter.sendVerificationCode('+8613800000000', '123456', 'login', config);

    const [url, body, options] = post.mock.calls[0];
    expect(url).toBe('https://smssh.253.com/sms/v2/batch-send');
    expect(body).toEqual({
      productType: 'verify',
      phoneNumbers: '13800000000',
      templateCode: 'verify-template',
      templateParam: '[{"param1":"123456"}]',
    });
    const headers = options?.headers as Record<string, string>;
    expect(headers.AppID).toBe(config.appId);
    expect(headers.Nonce).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(headers.CurTime).toMatch(/^\d{10}$/);
    expect(headers.CheckSum).toBe(
      createHash('sha1').update(`${config.appSecret}${headers.Nonce}${headers.CurTime}`).digest('hex'),
    );
  });

  it('rejects a provider business error and partial send response', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { code: '201152', msg: 'template not found' },
    } as never);
    await expect(adapter.sendVerificationCode('+8613800000000', '123456', 'login', config)).rejects.toMatchObject({
      code: 'CHANNEL_REQUEST_FAILED',
    });

    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { code: '000000', data: { successNum: '0', failNum: '1' } },
    } as never);
    await expect(adapter.sendVerificationCode('+8613800000000', '123456', 'login', config)).rejects.toMatchObject({
      code: 'CHANNEL_REQUEST_FAILED',
    });
  });

  it('checks credentials and the approved template without sending an SMS', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { code: '000000', data: { status: '1' } },
    } as never);

    await adapter.testConnection(config);

    expect(post).toHaveBeenCalledWith(
      'https://smssh.253.com/sms/v2/template/detail',
      { productType: 'verify', templateCode: config.templateCode },
      expect.objectContaining({ headers: expect.objectContaining({ AppID: config.appId }) }),
    );
  });

  it('includes the provider code in send failures for backend diagnostics', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { code: '201500', msg: '统一应用不存在' },
    } as never);

    await expect(adapter.sendVerificationCode('+8613800000000', '123456', 'register', config)).rejects.toMatchObject({
      code: 'CHANNEL_REQUEST_FAILED',
      message: expect.stringContaining('code=201500'),
    });
  });

  it('masks AppID and never includes the AppSecret in public config', () => {
    const publicConfig = adapter.getPublicConfig(config);
    expect(publicConfig).toMatchObject({ appId: 'te****id', templateCode: config.templateCode, secretConfigured: true });
    expect(JSON.stringify(publicConfig)).not.toContain(config.appSecret);
  });

  it('requires HTTPS for a custom endpoint', async () => {
    await expect(adapter.validateConfig({ ...config, endpoint: 'http://smssh.253.com' })).rejects.toMatchObject({
      code: 'INVALID_CHANNEL_CONFIG',
    });
    await expect(adapter.validateConfig({ ...config, endpoint: 'https://user:secret@smssh.253.com' })).rejects.toMatchObject({
      code: 'INVALID_CHANNEL_CONFIG',
    });
  });
});
