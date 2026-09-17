import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformModel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const GLOBAL_CONFIG_ID = 1;

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
}
