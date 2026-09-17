import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  PlatformModel,
  Provider,
  UpstreamModel,
  ModelType,
  ApiFormat,
} from '@prisma/client';
import { assertValidPlatformModelPricing } from './platform-model-pricing';
import { assertValidProviderConfig } from './provider-config';

/**
 * 路由结果
 */
export interface ResolvedUpstream {
  upstreamModel: UpstreamModel & { provider: Provider };
  provider: Provider;
  upstreamModelId: string;
  providerId: string;
  recordResult: (success: boolean) => Promise<void>;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  // 熔断器配置
  private readonly CIRCUIT_FAILURE_THRESHOLD: number;
  private readonly CIRCUIT_RESET_TIMEOUT: number;

  // 限流配置
  private readonly DEFAULT_RATE_LIMIT: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.CIRCUIT_FAILURE_THRESHOLD =
      this.configService.get<number>('CIRCUIT_FAILURE_THRESHOLD', 5) || 5;
    this.CIRCUIT_RESET_TIMEOUT =
      (this.configService.get<number>('CIRCUIT_RESET_TIMEOUT', 60) as number) || 60;
    this.DEFAULT_RATE_LIMIT =
      (this.configService.get<number>('PROVIDER_DEFAULT_RATE_LIMIT', 60) as number) || 60;
  }

  // ==================== 平台模型管理 ====================

  /**
   * 获取启用的平台模型列表（可按类型筛选）
   */
  async getPlatformModels(
    type?: ModelType,
    includeInactive = false,
  ): Promise<PlatformModel[]> {
    return this.prisma.platformModel.findMany({
      where: {
        ...(!includeInactive ? { isActive: true } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 按名称获取平台模型（含活跃的上游映射和供应商信息）
   */
  async getPlatformModelByName(name: string): Promise<PlatformModel | null> {
    return this.prisma.platformModel.findUnique({
      where: { name },
      include: {
        upstreamModels: {
          where: { isActive: true },
          include: { provider: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });
  }

  /**
   * 创建平台模型
   */
  async createPlatformModel(data: {
    name: string;
    displayName: string;
    type: ModelType;
    pricing: Record<string, any>;
    maxTokens?: number;
    isActive?: boolean;
  }): Promise<PlatformModel> {
    assertValidPlatformModelPricing(data.type, data.pricing);

    const exists = await this.prisma.platformModel.findUnique({
      where: { name: data.name },
    });

    if (exists) {
      throw new BadRequestException('平台模型名称已存在');
    }

    return this.prisma.platformModel.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        type: data.type,
        pricing: data.pricing,
        maxTokens: data.maxTokens,
        isActive: data.isActive ?? true,
      },
    });
  }

  /**
   * 更新平台模型
   */
  async updatePlatformModel(
    id: string,
    data: Partial<{
      name: string;
      displayName: string;
      type: ModelType;
      pricing: Record<string, any>;
      maxTokens: number;
      isActive: boolean;
    }>,
  ): Promise<PlatformModel> {
    const model = await this.prisma.platformModel.findUnique({ where: { id } });
    if (!model) {
      throw new NotFoundException('平台模型不存在');
    }

    const nextType = data.type ?? model.type;
    const nextPricing = data.pricing ?? model.pricing;
    assertValidPlatformModelPricing(nextType, nextPricing);

    if (data.name && data.name !== model.name) {
      const exists = await this.prisma.platformModel.findUnique({
        where: { name: data.name },
      });
      if (exists) {
        throw new BadRequestException('平台模型名称已存在');
      }
    }

    return this.prisma.platformModel.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.pricing !== undefined && { pricing: data.pricing }),
        ...(data.maxTokens !== undefined && { maxTokens: data.maxTokens }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /**
   * 删除平台模型（级联删除上游映射）
   */
  async deletePlatformModel(id: string): Promise<PlatformModel> {
    const model = await this.prisma.platformModel.findUnique({ where: { id } });
    if (!model) {
      throw new NotFoundException('平台模型不存在');
    }

    return this.prisma.platformModel.delete({ where: { id } });
  }

  // ==================== 供应商管理 ====================

  /**
   * 获取所有供应商
   */
  async getProviders(): Promise<Provider[]> {
    return this.prisma.provider.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建供应商
   */
  async createProvider(data: {
    name: string;
    apiFormat: string;
    supportsStreaming?: boolean;
    config: Record<string, any>;
    isActive?: boolean;
  }): Promise<Provider> {
    assertValidProviderConfig(data.config);

    const exists = await this.prisma.provider.findUnique({
      where: { name: data.name },
    });

    if (exists) {
      throw new BadRequestException('供应商名称已存在');
    }

    return this.prisma.provider.create({
      data: {
        name: data.name,
        apiFormat: data.apiFormat as ApiFormat,
        supportsStreaming: data.supportsStreaming ?? true,
        config: data.config,
        isActive: data.isActive ?? true,
      },
    });
  }

  /**
   * 更新供应商
   */
  async updateProvider(
    id: string,
    data: Partial<{
      name: string;
      apiFormat: string;
      supportsStreaming: boolean;
      config: Record<string, any>;
      isActive: boolean;
    }>,
  ): Promise<Provider> {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider) {
      throw new NotFoundException('供应商不存在');
    }

    if (data.config !== undefined) {
      assertValidProviderConfig(data.config);
    }

    if (data.name && data.name !== provider.name) {
      const exists = await this.prisma.provider.findUnique({
        where: { name: data.name },
      });
      if (exists) {
        throw new BadRequestException('供应商名称已存在');
      }
    }

    return this.prisma.provider.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.apiFormat !== undefined && { apiFormat: data.apiFormat as ApiFormat }),
        ...(data.supportsStreaming !== undefined && { supportsStreaming: data.supportsStreaming }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /**
   * 删除供应商
   */
  async deleteProvider(id: string): Promise<Provider> {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider) {
      throw new NotFoundException('供应商不存在');
    }

    return this.prisma.provider.delete({ where: { id } });
  }

  // ==================== 上游映射管理 ====================

  /**
   * 获取某平台模型的所有上游（按 priority 排序）
   */
  async getUpstreamsForPlatformModel(
    platformModelId: string,
  ): Promise<(UpstreamModel & { provider: Provider })[]> {
    const platformModel = await this.prisma.platformModel.findUnique({
      where: { id: platformModelId },
    });

    if (!platformModel) {
      throw new NotFoundException('平台模型不存在');
    }

    return this.prisma.upstreamModel.findMany({
      where: { platformModelId },
      include: { provider: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * 为平台模型添加上游映射
   */
  async addUpstreamModel(data: {
    platformModelId: string;
    providerId: string;
    upstreamModelId: string;
    priority?: number;
    weight?: number;
    isActive?: boolean;
    upstreamPricing?: Record<string, any>;
    maxTokens?: number;
  }): Promise<UpstreamModel> {
    const platformModel = await this.prisma.platformModel.findUnique({
      where: { id: data.platformModelId },
    });
    if (!platformModel) {
      throw new NotFoundException('平台模型不存在');
    }

    const provider = await this.prisma.provider.findUnique({
      where: { id: data.providerId },
    });
    if (!provider) {
      throw new NotFoundException('供应商不存在');
    }

    return this.prisma.upstreamModel.create({
      data: {
        platformModelId: data.platformModelId,
        providerId: data.providerId,
        upstreamModelId: data.upstreamModelId,
        priority: data.priority ?? 1,
        weight: data.weight ?? 1,
        isActive: data.isActive ?? true,
        upstreamPricing: data.upstreamPricing,
        maxTokens: data.maxTokens,
      },
    });
  }

  /**
   * 更新上游映射
   */
  async updateUpstreamModel(
    id: string,
    data: Partial<{
      providerId: string;
      upstreamModelId: string;
      priority: number;
      weight: number;
      isActive: boolean;
      upstreamPricing: Record<string, any>;
      maxTokens: number;
    }>,
  ): Promise<UpstreamModel> {
    const upstream = await this.prisma.upstreamModel.findUnique({ where: { id } });
    if (!upstream) {
      throw new NotFoundException('上游映射不存在');
    }

    if (data.providerId && data.providerId !== upstream.providerId) {
      const provider = await this.prisma.provider.findUnique({
        where: { id: data.providerId },
      });
      if (!provider) {
        throw new NotFoundException('供应商不存在');
      }
    }

    return this.prisma.upstreamModel.update({
      where: { id },
      data: {
        ...(data.providerId !== undefined && { providerId: data.providerId }),
        ...(data.upstreamModelId !== undefined && { upstreamModelId: data.upstreamModelId }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.weight !== undefined && { weight: data.weight }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.upstreamPricing !== undefined && { upstreamPricing: data.upstreamPricing }),
        ...(data.maxTokens !== undefined && { maxTokens: data.maxTokens }),
      },
    });
  }

  /**
   * 删除上游映射
   */
  async removeUpstreamModel(id: string): Promise<UpstreamModel> {
    const upstream = await this.prisma.upstreamModel.findUnique({ where: { id } });
    if (!upstream) {
      throw new NotFoundException('上游映射不存在');
    }

    return this.prisma.upstreamModel.delete({ where: { id } });
  }

  // ==================== 路由 + 熔断 + 限流 ====================

  /**
   * 核心路由方法：为平台模型选择一个可用的上游
   */
  async resolveUpstream(platformModelName: string): Promise<ResolvedUpstream> {
    const platformModel = await this.prisma.platformModel.findUnique({
      where: { name: platformModelName },
      include: {
        upstreamModels: {
          where: { isActive: true },
          include: { provider: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!platformModel) {
      throw new NotFoundException('平台模型不存在');
    }

    if (!platformModel.isActive) {
      throw new ServiceUnavailableException('平台模型已禁用');
    }

    const upstreams = platformModel.upstreamModels.filter(
      (u) => u.provider.isActive,
    );

    if (upstreams.length === 0) {
      throw new ServiceUnavailableException('该平台模型暂无可用上游');
    }

    // 按 priority 分组
    const groups = new Map<number, (UpstreamModel & { provider: Provider })[]>();
    for (const upstream of upstreams) {
      const list = groups.get(upstream.priority) || [];
      list.push(upstream);
      groups.set(upstream.priority, list);
    }

    // 按 priority 从小到大尝试
    const sortedPriorities = Array.from(groups.keys()).sort((a, b) => a - b);

    for (const priority of sortedPriorities) {
      const group = groups.get(priority)!;
      const weighted = this.weightedRandom(group);

      for (const candidate of weighted) {
        const providerId = candidate.providerId;
        const upstreamModelId = candidate.id;

        // 检查熔断器
        const isCircuitOpen = await this.isCircuitOpen(providerId, upstreamModelId);
        if (isCircuitOpen) {
          this.logger.warn(
            `熔断器已打开，跳过上游: providerId=${providerId}, upstreamModelId=${upstreamModelId}`,
          );
          continue;
        }

        // 检查限流
        const rateLimitConfig =
          (candidate.provider.config as Record<string, any>)?.rateLimit ||
          this.DEFAULT_RATE_LIMIT;
        const rateLimit = Number(rateLimitConfig) || this.DEFAULT_RATE_LIMIT;
        const isRateLimited = await this.checkRateLimit(
          providerId,
          upstreamModelId,
          rateLimit,
        );
        if (isRateLimited) {
          this.logger.warn(
            `上游限流，跳过: providerId=${providerId}, upstreamModelId=${upstreamModelId}`,
          );
          continue;
        }

        // 找到可用候选
        this.logger.log(
          `路由成功: platformModel=${platformModelName}, providerId=${providerId}, upstreamModelId=${upstreamModelId}`,
        );

        return {
          upstreamModel: candidate,
          provider: candidate.provider,
          upstreamModelId: candidate.id,
          providerId: candidate.providerId,
          recordResult: async (success: boolean) => {
            if (success) {
              await this.recordSuccess(providerId, upstreamModelId);
            } else {
              await this.recordFailure(providerId, upstreamModelId);
            }
          },
        };
      }
    }

    throw new ServiceUnavailableException('所有上游均不可用');
  }

  /**
   * 同优先级内按 weight 做加权随机排序
   */
  private weightedRandom<T extends { weight: number }>(items: T[]): T[] {
    if (items.length === 0) return [];

    const result = [...items];
    const totalWeight = result.reduce((sum, item) => sum + Math.max(item.weight, 1), 0);

    if (totalWeight <= 0) return result;

    // 使用 Fisher-Yates 风格的加权洗牌：权重越高，排在越前面
    for (let i = 0; i < result.length; i++) {
      const remainingWeight = result.slice(i).reduce((sum, item) => sum + Math.max(item.weight, 1), 0);
      let random = Math.random() * remainingWeight;

      for (let j = i; j < result.length; j++) {
        random -= Math.max(result[j].weight, 1);
        if (random < 0) {
          [result[i], result[j]] = [result[j], result[i]];
          break;
        }
      }
    }

    return result;
  }

  // ==================== 熔断器逻辑 ====================

  private circuitFailKey(providerId: string, upstreamModelId: string): string {
    return `circuit:fail:${providerId}:${upstreamModelId}`;
  }

  private circuitOpenKey(providerId: string, upstreamModelId: string): string {
    return `circuit:open:${providerId}:${upstreamModelId}`;
  }

  /**
   * 检查熔断器是否打开
   */
  async isCircuitOpen(providerId: string, upstreamModelId: string): Promise<boolean> {
    const key = this.circuitOpenKey(providerId, upstreamModelId);
    const value = await this.redis.get(key);
    return value === '1';
  }

  /**
   * 记录成功：清除失败计数和熔断状态
   */
  async recordSuccess(providerId: string, upstreamModelId: string): Promise<void> {
    const failKey = this.circuitFailKey(providerId, upstreamModelId);
    const openKey = this.circuitOpenKey(providerId, upstreamModelId);

    await Promise.all([this.redis.del(failKey), this.redis.del(openKey)]);

    this.logger.log(
      `熔断器记录成功: providerId=${providerId}, upstreamModelId=${upstreamModelId}`,
    );
  }

  /**
   * 记录失败：增加失败计数，达到阈值则打开熔断器
   */
  async recordFailure(providerId: string, upstreamModelId: string): Promise<void> {
    const failKey = this.circuitFailKey(providerId, upstreamModelId);
    const openKey = this.circuitOpenKey(providerId, upstreamModelId);

    const count = await this.redis.incr(failKey, this.CIRCUIT_RESET_TIMEOUT);

    this.logger.warn(
      `熔断器记录失败: providerId=${providerId}, upstreamModelId=${upstreamModelId}, count=${count}`,
    );

    if (count >= this.CIRCUIT_FAILURE_THRESHOLD) {
      await this.redis.set(openKey, '1', this.CIRCUIT_RESET_TIMEOUT);
      this.logger.error(
        `熔断器已打开: providerId=${providerId}, upstreamModelId=${upstreamModelId}`,
      );
    }
  }

  // ==================== 限流逻辑 ====================

  /**
   * 检查是否超过限流（滑动窗口，每分钟）
   * @returns true 表示超过限流
   */
  async checkRateLimit(
    providerId: string,
    upstreamModelId: string,
    limit?: number,
  ): Promise<boolean> {
    const key = `ratelimit:${providerId}:${upstreamModelId}`;
    const configuredLimit = Number(limit ?? this.DEFAULT_RATE_LIMIT);
    const rateLimit =
      Number.isFinite(configuredLimit) && configuredLimit > 0
        ? Math.max(1, Math.floor(configuredLimit))
        : this.DEFAULT_RATE_LIMIT;

    return this.redis.isRateLimited(key, rateLimit, 60);
  }
}
