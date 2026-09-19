import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service';

const chatModel = {
  id: 'chat-model-1',
  name: 'chat-model',
  type: 'CHAT',
  isActive: true,
  pricing: { input: 0.01, output: 0.02 },
};

function createService() {
  const prisma = {
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    platformModel: {
      findUnique: jest.fn().mockResolvedValue(chatModel),
    },
  };
  const config = { get: jest.fn().mockReturnValue('legacy-chat-model') };
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );

  return { service, prisma, config };
}

describe('SettingsService', () => {
  it('prefers the model saved in system config', async () => {
    const { service, prisma, config } = createService();
    prisma.systemConfig.findUnique.mockResolvedValue({
      id: 1,
      promptOptimizerModelId: 'chat-model-1',
      promptOptimizerModel: chatModel,
    });

    await expect(service.getPromptOptimizerModel()).resolves.toEqual(chatModel);
    expect(config.get).not.toHaveBeenCalled();
    expect(prisma.platformModel.findUnique).not.toHaveBeenCalled();
  });

  it('uses the legacy environment model only when no admin setting exists', async () => {
    const { service, prisma, config } = createService();
    prisma.platformModel.findUnique.mockResolvedValue(chatModel);

    await expect(service.getPromptOptimizerModel()).resolves.toEqual(chatModel);
    expect(config.get).toHaveBeenCalledWith('PROMPT_OPTIMIZER_MODEL');
    expect(prisma.platformModel.findUnique).toHaveBeenCalledWith({
      where: { name: 'legacy-chat-model' },
    });
  });

  it('upserts the selected model into the singleton system config row', async () => {
    const { service, prisma } = createService();

    await service.setPromptOptimizerModel('chat-model-1');

    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, promptOptimizerModelId: 'chat-model-1' },
      update: { promptOptimizerModelId: 'chat-model-1' },
    });
  });

  it('returns the default photon exchange rate when no config exists', async () => {
    const { service } = createService();

    await expect(service.getCurrencySettings()).resolves.toEqual({
      code: 'PHOTON',
      name: '光子',
      symbol: '✦',
      photonPerCny: 10,
    });
  });

  it('updates the photon exchange rate and converts recharge amounts only', async () => {
    const { service, prisma } = createService();
    prisma.systemConfig.findUnique
      .mockResolvedValueOnce({ photonPerCny: { toString: () => '100' } })
      .mockResolvedValueOnce({ photonPerCny: { toString: () => '100' } });

    await expect(service.setPhotonPerCny(100)).resolves.toEqual({
      code: 'PHOTON',
      name: '光子',
      symbol: '✦',
      photonPerCny: 100,
    });
    await expect(service.convertCnyToPhoton(1.25)).resolves.toBe(125);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, photonPerCny: expect.anything() },
      update: { photonPerCny: expect.anything() },
    });
  });
});
