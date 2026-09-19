import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformModel } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrencySettingsDto, PHOTON_SYMBOL } from '@lumina/shared';
import { PrismaService } from '../../prisma/prisma.service';

const GLOBAL_CONFIG_ID = 1;
export const DEFAULT_PHOTON_PER_CNY = 10;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve the configured prompt optimizer to an existing platform model.
   * The environment variable remains a one-time compatibility fallback for
   * deployments that have not saved the setting from the admin panel yet.
   */
  async getPromptOptimizerModel(): Promise<PlatformModel | null> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: GLOBAL_CONFIG_ID },
      include: { promptOptimizerModel: true },
    });

    if (config?.promptOptimizerModel) {
      return config.promptOptimizerModel;
    }

    const legacyModelName = this.configService
      .get<string>('PROMPT_OPTIMIZER_MODEL')
      ?.trim();

    if (!legacyModelName) return null;

    return this.prisma.platformModel.findUnique({
      where: { name: legacyModelName },
    });
  }

  async setPromptOptimizerModel(modelId: string): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { id: GLOBAL_CONFIG_ID },
      create: {
        id: GLOBAL_CONFIG_ID,
        promptOptimizerModelId: modelId,
      },
      update: { promptOptimizerModelId: modelId },
    });
  }

  async getCurrencySettings(): Promise<CurrencySettingsDto> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: GLOBAL_CONFIG_ID },
      select: { photonPerCny: true },
    });

    return {
      code: 'PHOTON',
      name: '光子',
      symbol: PHOTON_SYMBOL,
      photonPerCny: config?.photonPerCny
        ? Number(config.photonPerCny.toString())
        : DEFAULT_PHOTON_PER_CNY,
    };
  }

  async setPhotonPerCny(photonPerCny: number): Promise<CurrencySettingsDto> {
    if (!Number.isFinite(photonPerCny) || photonPerCny <= 0) {
      throw new BadRequestException('人民币与光子汇率必须是大于 0 的有限数字');
    }

    await this.prisma.systemConfig.upsert({
      where: { id: GLOBAL_CONFIG_ID },
      create: {
        id: GLOBAL_CONFIG_ID,
        photonPerCny: new Decimal(photonPerCny),
      },
      update: { photonPerCny: new Decimal(photonPerCny) },
    });

    return this.getCurrencySettings();
  }

  async convertCnyToPhoton(cnyAmount: number): Promise<number> {
    if (!Number.isFinite(cnyAmount) || cnyAmount < 0) {
      throw new BadRequestException('充值人民币金额必须是大于等于 0 的有限数字');
    }

    const settings = await this.getCurrencySettings();
    return new Decimal(cnyAmount)
      .times(settings.photonPerCny)
      .toDecimalPlaces(6)
      .toNumber();
  }
}
