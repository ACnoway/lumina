import 'reflect-metadata';
import { User } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

describe('ProvidersController audit logging', () => {
  it('records provider creation without copying the provider API configuration', async () => {
    const providers = {
      createProvider: jest.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'example-provider',
        apiFormat: 'openai_chat',
        supportsStreaming: true,
        isActive: true,
        config: { apiKey: 'must-not-be-audited' },
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProvidersController(
      providers as unknown as ProvidersService,
      audit as unknown as AuditService,
    );
    const request = {
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('Lumina test'),
    } as unknown as Request;

    await controller.createProvider(
      { id: 'admin-1' } as User,
      {
        name: 'example-provider',
        apiFormat: 'openai_chat',
        config: { apiKey: 'must-not-be-audited' },
      },
      request,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'provider.created',
        resource: 'provider',
        details: {
          targetId: 'provider-1',
          after: {
            id: 'provider-1',
            name: 'example-provider',
            apiFormat: 'openai_chat',
            supportsStreaming: true,
            isActive: true,
          },
        },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('must-not-be-audited');
  });
});
