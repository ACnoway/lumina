import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from '../chat/adapters/adapter-factory';
import { MinioService } from '../../minio/minio.service';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { ImageQueueService } from './image-queue.service';
import { SettingsService } from '../settings/settings.service';

// 比例 → 尺寸映射
const ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

const QUEUE_BLOCK_TIMEOUT_SECONDS = 1;
const PROCESSING_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_IMAGE_ATTEMPTS = 3;
const MAX_IMAGE_RETRIES = 3;
const MIN_IMAGE_CHARGE = 0.01;
const UPSTREAM_IDEMPOTENCY_HEADER = 'Idempotency-Key';

interface ImageTaskParameters {
  aspectRatio?: string;
  perImagePrice?: number;
  imageCount?: number;
  retryCount?: number;
}

// 提示词优化的系统指令
const PROMPT_OPTIMIZER_SYSTEM = `你是一个 AI 生图提示词优化专家。用户会给你一段简短的图片描述，你需要将它扩展成一段详细、富有画面感的英文提示词，包含以下要素：
- 主体描述（外貌、姿态、表情、服装等）
- 场景和环境
- 光线方向和类型
- 色彩色调
- 构图和视角
- 艺术风格（如 photorealistic, digital art, anime 等）
- 画面质量和细节描述

要求：
1. 输出纯英文，不要中文解释
2. 控制在 200 词以内
3. 用逗号分隔的关键词和短语形式，不要用完整句子
4. 保留用户原始意图，不要改变核心内容
5. 如果用户的描述已经足够详细，可以做轻微润色`;

@Injectable()
export class ImageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ImageService.name);
  private workerRunning = false;
  private workerPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly providersService: ProvidersService,
    private readonly adapterFactory: AdapterFactory,
    private readonly minioService: MinioService,
    private readonly imageQueueService: ImageQueueService,
    private readonly settingsService: SettingsService,
  ) {}

  onApplicationBootstrap(): void {
    this.workerRunning = true;
    this.workerPromise = this.runWorker();
  }

  async onModuleDestroy(): Promise<void> {
    this.workerRunning = false;
    await this.workerPromise;
  }

  // ==================== 提示词优化 ====================

  /**
   * 用聊天模型优化用户的简短提示词
   * 独立计费
   */
  async optimizePrompt(
    userId: string,
    originalPrompt: string,
  ): Promise<{ optimizedPrompt: string; cost: number }> {
    // 获取后台配置的现有聊天模型；未配置时由 SettingsService 兼容读取环境变量。
    const platformModel = await this.settingsService.getPromptOptimizerModel();

    if (!platformModel || !platformModel.isActive || platformModel.type !== 'CHAT') {
      throw new ServiceUnavailableException(`提示词优化模型未配置或不可用`);
    }

    const optimizerModelName = platformModel.name;

    // 获取定价
    const pricing = (platformModel.pricing as any) || {};
    const inputPrice = Number(pricing.input) || 0;
    const outputPrice = Number(pricing.output) || 0;

    // 预估成本（系统指令 + 用户输入 ≈ 300 token，输出 ≈ 150 token）
    const estimatedInputTokens = 350;
    const estimatedOutputTokens = 200;
    const estimatedCost =
      (estimatedInputTokens / 1000) * inputPrice + (estimatedOutputTokens / 1000) * outputPrice;

    const idempotencyKey = `prompt-opt:${userId}:${Date.now()}`;

    // 预扣
    await this.walletService.preDeduct(userId, Math.max(estimatedCost, 0.01), idempotencyKey);

    // 路由上游
    let resolved;
    try {
      resolved = await this.providersService.resolveUpstream(optimizerModelName);
    } catch (error) {
      await this.walletService.refund(userId, idempotencyKey, '优化路由失败');
      throw error;
    }

    // 创建适配器
    const providerConfig = (resolved.provider.config as Record<string, any>) || {};
    const adapter = this.adapterFactory.createAdapter(resolved.provider.apiFormat, providerConfig);

    try {
      // 调用聊天模型
      const response = await adapter.chat({
        messages: [
          { role: 'system', content: PROMPT_OPTIMIZER_SYSTEM },
          { role: 'user', content: originalPrompt },
        ],
        model: resolved.upstreamModel.upstreamModelId,
        temperature: 0.7,
        maxTokens: 300,
        stream: false,
      });

      // 计算实际成本
      const actualCost =
        (response.inputTokens / 1000) * inputPrice + (response.outputTokens / 1000) * outputPrice;

      // 结算
      await this.walletService.settle(
        userId,
        actualCost,
        idempotencyKey,
        `提示词优化: ${optimizerModelName}`,
        {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        },
      );

      // 记录上游成功
      await resolved.recordResult(true);

      this.logger.log(
        `提示词优化完成: userId=${userId}, cost=${actualCost}, ` +
          `outputTokens=${response.outputTokens}`,
      );

      return {
        optimizedPrompt: response.content.trim(),
        cost: actualCost,
      };
    } catch (error) {
      // 失败：退回预扣 + 记录上游失败
      await this.walletService.refund(userId, idempotencyKey, '优化失败');
      await resolved.recordResult(false);

      const msg = error instanceof Error ? error.message : '优化失败';
      this.logger.error(`提示词优化失败: ${msg}`);
      throw error instanceof Error ? error : new ServiceUnavailableException('提示词优化失败');
    }
  }

  // ==================== 生图任务管理 ====================

  /**
   * 创建生图任务（异步处理）
   */
  async createImageTask(
    userId: string,
    data: {
      prompt: string;
      originalPrompt?: string;
      negativePrompt?: string;
      model: string;
      aspectRatio?: string;
      imageCount?: number;
    },
  ) {
    // 验证模型存在且是生图类型
    const platformModel = await this.providersService.getPlatformModelByName(data.model);

    if (!platformModel) {
      throw new NotFoundException(`模型 "${data.model}" 不存在`);
    }
    if (!platformModel.isActive) {
      throw new BadRequestException(`模型 "${data.model}" 已禁用`);
    }
    if (platformModel.type !== 'IMAGE') {
      throw new BadRequestException(`模型 "${data.model}" 不是生图模型`);
    }

    const imageCount = this.normalizeImageCount(data.imageCount);

    // 获取定价
    const pricing = (platformModel.pricing as any) || {};
    const perImagePrice = this.normalizeImagePrice(pricing.perImage, data.model);

    // 创建任务记录
    const task = await this.prisma.imageGeneration.create({
      data: {
        userId,
        prompt: data.prompt,
        originalPrompt: data.originalPrompt || null,
        negativePrompt: data.negativePrompt || null,
        model: data.model,
        provider: '', // 异步处理时填充
        status: 'PENDING',
        parameters: {
          aspectRatio: data.aspectRatio || '1:1',
          perImagePrice,
          imageCount,
          retryCount: 0,
        },
        images: {
          create: Array.from({ length: imageCount }, (_, sequence) => ({
            sequence,
          })),
        },
      },
    });

    try {
      await this.imageQueueService.enqueue(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redis 队列不可用';
      await this.failTask(task.id, `任务入队失败: ${message}`);
      throw new ServiceUnavailableException('生图任务暂时无法排队，请稍后重试');
    }

    this.logger.log(`生图任务已入队: userId=${userId}, taskId=${task.id}, model=${data.model}`);

    return this.serializeTask(task);
  }

  private async runWorker(): Promise<void> {
    try {
      await this.recoverQueuedTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`恢复生图队列失败: ${message}`);
    }

    while (this.workerRunning) {
      let taskId: string | null;
      try {
        taskId = await this.imageQueueService.take(QUEUE_BLOCK_TIMEOUT_SECONDS);
      } catch (error) {
        const message = this.describeError(error);
        this.logger.error(`读取生图队列失败: ${message}`, this.getErrorStack(error));
        await this.waitForNextPoll();
        continue;
      }

      if (!taskId) continue;

      try {
        await this.processQueuedTask(taskId);
      } catch (error) {
        const message = this.describeError(error);
        this.logger.error(
          `处理生图任务异常: taskId=${taskId}, err=${message}`,
          this.getErrorStack(error),
        );
      } finally {
        try {
          await this.imageQueueService.acknowledge(taskId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`确认生图任务失败: taskId=${taskId}, err=${message}`);
        }
      }
    }
  }

  private async waitForNextPoll(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Redis 在 worker 异常退出后仍保留 processing 列表项；以数据库状态为准
   * 恢复 PENDING 任务，并在 PROCESSING 长时间未更新时按正常重试流程处理。
   */
  private async recoverQueuedTasks(): Promise<void> {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS);
    const [pendingTasks, stalledTasks] = await Promise.all([
      this.prisma.imageGeneration.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
      }),
      this.prisma.imageGeneration.findMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: staleBefore },
        },
        select: { id: true, parameters: true },
      }),
    ]);

    for (const task of stalledTasks) {
      await this.retryOrFail(
        task.id,
        this.getTaskParameters(task.parameters),
        '任务处理超时，正在恢复',
        staleBefore,
      );
    }

    for (const task of pendingTasks) {
      await this.imageQueueService.enqueue(task.id);
    }

    if (pendingTasks.length || stalledTasks.length) {
      this.logger.log(`恢复生图队列: pending=${pendingTasks.length}, stale=${stalledTasks.length}`);
    }
  }

  /**
   * 领取任务时仅允许 PENDING → PROCESSING 一次，重复队列消息和多 worker
   * 都不会触发第二次上游调用或第二次计费。
   */
  async processQueuedTask(taskId: string): Promise<void> {
    const task = await this.prisma.imageGeneration.findUnique({
      where: { id: taskId },
    });

    if (!task) return;

    const claim = await this.prisma.imageGeneration.updateMany({
      where: { id: taskId, status: 'PENDING' },
      data: { status: 'PROCESSING', errorMessage: null },
    });

    if (claim.count !== 1) return;

    const parameters = this.getTaskParameters(task.parameters);

    try {
      const perImagePrice = await this.getTaskPrice(task.model, parameters);
      await this.processImageTask(
        task.userId,
        task.id,
        task.prompt,
        task.negativePrompt || undefined,
        task.model,
        parameters.aspectRatio,
        perImagePrice,
        parameters,
      );
    } catch (error) {
      const message = this.describeError(error, '任务初始化失败');
      await this.retryOrFail(task.id, parameters, message);
    }
  }

  private getTaskParameters(value: Prisma.JsonValue | null): ImageTaskParameters {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const parameters = value as Record<string, unknown>;
    return {
      aspectRatio: typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : undefined,
      perImagePrice:
        typeof parameters.perImagePrice === 'number' ? parameters.perImagePrice : undefined,
      retryCount: typeof parameters.retryCount === 'number' ? parameters.retryCount : undefined,
      imageCount: typeof parameters.imageCount === 'number' ? parameters.imageCount : undefined,
    };
  }

  private normalizeImageCount(value: unknown): number {
    const imageCount = value === undefined ? 1 : Number(value);
    if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 4) {
      throw new BadRequestException('图片数量必须是1到4之间的整数');
    }
    return imageCount;
  }

  private async getTaskPrice(modelName: string, parameters: ImageTaskParameters): Promise<number> {
    if (
      typeof parameters.perImagePrice === 'number' &&
      Number.isFinite(parameters.perImagePrice) &&
      parameters.perImagePrice >= 0
    ) {
      return this.normalizeImagePrice(parameters.perImagePrice, modelName);
    }

    // 兼容已在本次改造前创建、未保存价格快照的旧 PENDING 任务。
    const platformModel = await this.providersService.getPlatformModelByName(modelName);
    if (!platformModel || !platformModel.isActive || platformModel.type !== 'IMAGE') {
      throw new BadRequestException(`生图模型 "${modelName}" 当前不可用`);
    }

    const pricing = (platformModel.pricing as Record<string, unknown>) || {};
    return this.normalizeImagePrice(pricing.perImage, modelName);
  }

  /**
   * 生图不支持 0 元结算；与预扣保持一致，统一使用最低收费。
   * 这样即使历史任务或旧模型配置缺少 perImage，也不会在上游生成完成后以 0 元结算失败。
   */
  private normalizeImagePrice(value: unknown, modelName: string): number {
    const configuredPrice = Number(value);

    if (!Number.isFinite(configuredPrice) || configuredPrice <= 0) {
      this.logger.warn(
        `生图模型未配置有效 perImage: model=${modelName}, ` + `使用最低收费 ${MIN_IMAGE_CHARGE} 元`,
      );
      return MIN_IMAGE_CHARGE;
    }

    return Math.max(configuredPrice, MIN_IMAGE_CHARGE);
  }

  private async retryOrFail(
    taskId: string,
    parameters: ImageTaskParameters,
    errorMessage: string,
    staleBefore?: Date,
  ): Promise<void> {
    const retryCount = (parameters.retryCount || 0) + 1;
    const where: Prisma.ImageGenerationWhereInput = {
      id: taskId,
      status: 'PROCESSING',
      ...(staleBefore ? { updatedAt: { lt: staleBefore } } : {}),
    };
    const nextParameters = { ...parameters, retryCount };

    if (retryCount >= MAX_IMAGE_ATTEMPTS) {
      await this.prisma.imageGeneration.updateMany({
        where,
        data: {
          status: 'FAILED',
          errorMessage: `任务已重试 ${MAX_IMAGE_ATTEMPTS} 次：${errorMessage}`,
          parameters: nextParameters,
        },
      });
      return;
    }

    const result = await this.prisma.imageGeneration.updateMany({
      where,
      data: {
        status: 'PENDING',
        errorMessage: `任务失败，将重试（${retryCount}/${MAX_IMAGE_ATTEMPTS - 1}）：${errorMessage}`,
        parameters: nextParameters,
      },
    });

    if (result.count === 1) {
      await this.prisma.imageGenerationImage.updateMany({
        where: {
          generationId: taskId,
          status: { in: ['PROCESSING', 'FAILED'] },
          retryCount: { lt: MAX_IMAGE_RETRIES },
        },
        data: {
          status: 'PENDING',
          errorMessage: null,
        },
      });
      try {
        await this.imageQueueService.enqueue(taskId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`生图重试任务入队失败: taskId=${taskId}, err=${message}`);
      }
      this.logger.warn(`生图任务重试: taskId=${taskId}, retry=${retryCount}, err=${errorMessage}`);
    }
  }

  /**
   * 异步处理生图任务
   */
  private async processImageTask(
    userId: string,
    taskId: string,
    prompt: string,
    negativePrompt: string | undefined,
    modelName: string,
    aspectRatio: string | undefined,
    perImagePrice: number,
    taskParameters: ImageTaskParameters,
  ): Promise<void> {
    const chargeAmount = this.normalizeImagePrice(perImagePrice, modelName);
    const imageCount = this.normalizeImageCount(taskParameters.imageCount);
    const imageRecords = await this.ensureImageRecords(taskId, imageCount);

    const pendingImages = imageRecords.filter(
      (image) => image.status === 'PENDING' && image.retryCount <= MAX_IMAGE_RETRIES,
    );
    for (const image of pendingImages) {
      try {
        await this.processSingleImage(
          userId,
          taskId,
          image.id,
          image.sequence,
          prompt,
          negativePrompt,
          modelName,
          aspectRatio,
          chargeAmount,
        );
      } catch (error) {
        const message = this.describeError(error);
        const exhausted = image.retryCount >= MAX_IMAGE_RETRIES;
        const retryCount = Math.min(image.retryCount + 1, MAX_IMAGE_RETRIES);
        await this.prisma.imageGenerationImage.update({
          where: { id: image.id },
          data: {
            status: exhausted ? 'FAILED' : 'PENDING',
            retryCount,
            errorMessage: exhausted
              ? message
              : `图片生成失败，将重试（${retryCount}/${MAX_IMAGE_RETRIES}）：${message}`,
          },
        });
        this.logger.error(
          `单张生图失败: taskId=${taskId}, sequence=${image.sequence}, retry=${retryCount}/${MAX_IMAGE_RETRIES}, err=${message}`,
          this.getErrorStack(error),
        );
      }
    }

    const completedImages = await this.prisma.imageGenerationImage.findMany({
      where: { generationId: taskId },
      orderBy: { sequence: 'asc' },
    });
    const successfulImages = completedImages.filter((image) => image.status === 'SUCCESS');
    const retryableImages = completedImages.filter(
      (image) => image.status === 'PENDING' && image.retryCount <= MAX_IMAGE_RETRIES,
    );
    const totalCost = successfulImages.reduce((sum, image) => sum + Number(image.cost || 0), 0);
    const firstSuccessfulImage = successfulImages[0];
    const taskStatus = retryableImages.length
      ? 'PENDING'
      : successfulImages.length > 0
        ? 'SUCCESS'
        : 'FAILED';
    const taskErrorMessage = retryableImages.length
      ? '部分图片生成失败，正在重试'
      : successfulImages.length > 0
        ? null
        : completedImages.find((image) => image.status === 'FAILED')?.errorMessage ||
          '所有图片均生成失败';

    await this.prisma.imageGeneration.update({
      where: { id: taskId },
      data: {
        status: taskStatus,
        cost: totalCost,
        errorMessage: taskErrorMessage,
        ...(firstSuccessfulImage
          ? {
              imageUrl: firstSuccessfulImage.imageUrl,
              imageKey: firstSuccessfulImage.imageKey,
              width: firstSuccessfulImage.width,
              height: firstSuccessfulImage.height,
            }
          : {}),
        parameters: {
          ...taskParameters,
          imageCount,
          completedImageCount: successfulImages.length,
        },
      },
    });

    if (retryableImages.length > 0) {
      await this.imageQueueService.enqueue(taskId);
      this.logger.warn(
        `生图任务等待单张重试: taskId=${taskId}, retryable=${retryableImages.length}, success=${successfulImages.length}/${imageCount}`,
      );
      return;
    }

    if (successfulImages.length > 0) {
      this.logger.log(
        `生图任务完成: taskId=${taskId}, success=${successfulImages.length}/${imageCount}, cost=${totalCost}`,
      );
    } else {
      this.logger.error(
        `生图任务失败: taskId=${taskId}, attempts=${MAX_IMAGE_RETRIES + 1}`,
      );
    }
  }

  private async ensureImageRecords(taskId: string, imageCount: number) {
    let records = await this.prisma.imageGenerationImage.findMany({
      where: { generationId: taskId },
      orderBy: { sequence: 'asc' },
    });

    if (records.length < imageCount) {
      await this.prisma.imageGenerationImage.createMany({
        data: Array.from({ length: imageCount }, (_, sequence) => ({
          generationId: taskId,
          sequence,
        })).filter(({ sequence }) => !records.some((record) => record.sequence === sequence)),
      });
      records = await this.prisma.imageGenerationImage.findMany({
        where: { generationId: taskId },
        orderBy: { sequence: 'asc' },
      });
    }

    return records;
  }

  private async processSingleImage(
    userId: string,
    taskId: string,
    imageId: string,
    sequence: number,
    prompt: string,
    negativePrompt: string | undefined,
    modelName: string,
    aspectRatio: string | undefined,
    chargeAmount: number,
  ): Promise<void> {
    const claim = await this.prisma.imageGenerationImage.updateMany({
      where: {
        id: imageId,
        generationId: taskId,
        status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      },
      data: { status: 'PROCESSING', errorMessage: null },
    });
    if (claim.count !== 1) return;

    const idempotencyKey = `image:${taskId}:${sequence}`;
    let reserved = false;
    let settled = false;
    let upstreamSucceeded = false;
    let resolved: any;
    let processingStage = '上游生图 API';

    try {
      processingStage = '钱包预扣';
      await this.walletService.preDeduct(userId, chargeAmount, idempotencyKey);
      reserved = true;

      processingStage = '上游路由';
      resolved = await this.providersService.resolveUpstream(modelName);
      await this.prisma.imageGeneration.update({
        where: { id: taskId },
        data: { status: 'PROCESSING', provider: resolved.provider.name },
      });

      const providerConfig = (resolved.provider.config as Record<string, any>) || {};
      const size = ASPECT_RATIO_SIZES[aspectRatio || '1:1'] || ASPECT_RATIO_SIZES['1:1'];
      let imageBuffer: Buffer;

      switch (resolved.provider.apiFormat) {
        case 'openai_image':
        case 'openai_compatible':
          ({ imageBuffer } = await this.callOpenAIImage(
            providerConfig,
            resolved.upstreamModel.upstreamModelId,
            prompt,
            size,
            idempotencyKey,
          ));
          upstreamSucceeded = true;
          break;
        case 'stability_image':
          ({ imageBuffer } = await this.callStabilityImage(
            providerConfig,
            resolved.upstreamModel.upstreamModelId,
            prompt,
            negativePrompt,
            size,
            idempotencyKey,
          ));
          upstreamSucceeded = true;
          break;
        default:
          throw new BadRequestException(`apiFormat "${resolved.provider.apiFormat}" 不支持生图`);
      }

      processingStage = 'MinIO 上传';
      const objectName = `images/${taskId}/${sequence}.png`;
      await this.minioService.upload(objectName, imageBuffer, imageBuffer.length);

      processingStage = 'MinIO 生成预签名 URL';
      const presignedUrl = await this.minioService.getPresignedUrl(objectName);

      processingStage = '钱包结算';
      await this.walletService.settle(userId, chargeAmount, idempotencyKey, `生图: ${modelName}`, {
        taskId,
        imageId,
        sequence,
        model: modelName,
      });
      settled = true;

      processingStage = '保存图片结果';
      await this.prisma.imageGenerationImage.update({
        where: { id: imageId },
        data: {
          status: 'SUCCESS',
          imageUrl: presignedUrl,
          imageKey: objectName,
          cost: chargeAmount,
          width: size.width,
          height: size.height,
          errorMessage: null,
        },
      });

      await resolved.recordResult(true).catch((recordError: unknown) => {
        this.logger.warn(`记录上游成功结果异常: ${this.describeError(recordError)}`);
      });
    } catch (error) {
      const details = this.describeError(error);
      const message = `阶段=${processingStage}; ${details}`;
      if (reserved && !settled) {
        await this.walletService.refund(userId, idempotencyKey, `生图失败: ${message}`);
      }
      if (resolved && !upstreamSucceeded) {
        await resolved.recordResult(false).catch((recordError: unknown) => {
          this.logger.warn(`记录上游失败结果异常: ${this.describeError(recordError)}`);
        });
      }
      throw new Error(message);
    }
  }

  private describeError(error: unknown, fallback = '未知错误'): string {
    if (axios.isAxiosError(error)) {
      const rawData = error.response?.data;
      const rawText = Buffer.isBuffer(rawData)
        ? rawData.toString('utf8')
        : typeof rawData === 'string'
          ? rawData
          : undefined;
      let responseData: unknown = rawData;
      if (rawText) {
        try {
          responseData = JSON.parse(rawText);
        } catch {
          responseData = rawText;
        }
      }

      const data =
        responseData && typeof responseData === 'object'
          ? (responseData as Record<string, unknown>)
          : undefined;
      const nestedError = data?.error;
      const nestedErrorData =
        nestedError && typeof nestedError === 'object'
          ? (nestedError as Record<string, unknown>)
          : undefined;
      const responseMessage =
        (typeof data?.message === 'string' && data.message) ||
        (typeof data?.detail === 'string' && data.detail) ||
        (typeof nestedError === 'string' && nestedError) ||
        (typeof nestedErrorData?.message === 'string' && nestedErrorData.message) ||
        (typeof responseData === 'string' && responseData) ||
        error.message;
      const responseStatus =
        error.response?.status ||
        (typeof data?.status_code === 'number' ? data.status_code : undefined);

      if (responseStatus) {
        return `status_code=${responseStatus}, ${responseMessage}`;
      }
    }

    if (error instanceof Error) {
      const name = error.name || 'Error';
      const message = error.message?.trim() || '未提供错误消息';
      const code = 'code' in error && typeof error.code === 'string' ? `, code=${error.code}` : '';
      return `${name}: ${message}${code}`;
    }

    if (typeof error === 'string') {
      return error.trim() || fallback;
    }

    if (error && typeof error === 'object') {
      try {
        return JSON.stringify(error) || fallback;
      } catch {
        return fallback;
      }
    }

    return fallback;
  }

  private getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }

  /**
   * 调用 OpenAI Images API
   */
  private async callOpenAIImage(
    config: Record<string, any>,
    model: string,
    prompt: string,
    size: { width: number; height: number },
    idempotencyKey: string,
  ): Promise<{ imageUrl: string; imageBuffer: Buffer }> {
    const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey = config.apiKey;
    const timeout = config.timeout || 60000;

    // OpenAI size 参数格式: "1024x1024"
    const sizeStr = `${size.width}x${size.height}`;

    const response = await axios.post(
      `${baseUrl}/images/generations`,
      {
        model,
        prompt,
        n: 1,
        size: sizeStr,
        response_format: 'url',
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          [UPSTREAM_IDEMPOTENCY_HEADER]: idempotencyKey,
        },
        timeout,
      },
    );

    const imageData = response.data?.data?.[0];
    if (!imageData) {
      throw new Error('上游返回了空的图片数据');
    }

    // 如果返回 URL，下载图片
    if (imageData.url) {
      const imgResponse = await axios.get(imageData.url, {
        responseType: 'arraybuffer',
        timeout,
      });
      return {
        imageUrl: imageData.url,
        imageBuffer: Buffer.from(imgResponse.data),
      };
    }

    // 如果返回 base64
    if (imageData.b64_json) {
      return {
        imageUrl: '', // 没有 URL，用 MinIO 的
        imageBuffer: Buffer.from(imageData.b64_json, 'base64'),
      };
    }

    throw new Error('上游返回了未知格式的图片数据');
  }

  /**
   * 调用 Stability AI 生图 API
   */
  private async callStabilityImage(
    config: Record<string, any>,
    model: string,
    prompt: string,
    negativePrompt: string | undefined,
    size: { width: number; height: number },
    idempotencyKey: string,
  ): Promise<{ imageUrl: string; imageBuffer: Buffer }> {
    const baseUrl = (config.baseUrl || 'https://api.stability.ai').replace(/\/+$/, '');
    const apiKey = config.apiKey;
    const timeout = config.timeout || 120000;

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', model);
    formData.append('width', String(size.width));
    formData.append('height', String(size.height));
    if (negativePrompt) {
      formData.append('negative_prompt', negativePrompt);
    }
    formData.append('output_format', 'png');

    const response = await axios.post(
      `${baseUrl}/v2beta/stable-image/generate/${model}`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'image/*',
          [UPSTREAM_IDEMPOTENCY_HEADER]: idempotencyKey,
        },
        timeout,
        responseType: 'arraybuffer',
      },
    );

    return {
      imageUrl: '',
      imageBuffer: Buffer.from(response.data),
    };
  }

  /**
   * 标记任务失败
   */
  private async failTask(taskId: string, errorMessage: string): Promise<void> {
    await this.prisma.imageGeneration.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });
  }

  // ==================== 查询 ====================

  /**
   * 查询任务状态
   */
  async getTask(userId: string, taskId: string) {
    const task = await this.prisma.imageGeneration.findUnique({
      where: { id: taskId },
      include: {
        images: {
          orderBy: { sequence: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('生图任务不存在');
    }

    if (task.userId !== userId) {
      throw new BadRequestException('无权访问该任务');
    }

    // 如果图片 URL 是预签名的，可能需要刷新（7天过期）
    // 这里简单返回，前端可以缓存
    return this.serializeTask(task);
  }

  /**
   * 获取生图历史（分页）
   */
  async getHistory(userId: string, page: number = 1, limit: number = 20) {
    const where: Prisma.ImageGenerationWhereInput = { userId };

    const [items, total] = await Promise.all([
      this.prisma.imageGeneration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: {
            orderBy: { sequence: 'asc' },
          },
        },
      }),
      this.prisma.imageGeneration.count({ where }),
    ]);

    return { items: items.map((item) => this.serializeTask(item)), total, page, limit };
  }

  private serializeTask(task: any) {
    const storedImages = Array.isArray(task.images) ? task.images : [];
    const images = storedImages.length
      ? storedImages.map((image: any) => ({
          id: image.id,
          sequence: image.sequence,
          status: image.status,
          width: image.width,
          height: image.height,
          imageUrl: image.imageUrl,
          cost: image.cost,
          errorMessage: image.errorMessage,
          createdAt: image.createdAt,
          updatedAt: image.updatedAt,
        }))
      : task.imageUrl
        ? [
            {
              id: `${task.id}:legacy:0`,
              sequence: 0,
              status: task.status,
              width: task.width,
              height: task.height,
              imageUrl: task.imageUrl,
              cost: task.cost,
              errorMessage: task.errorMessage,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
            },
          ]
        : [];

    return { ...task, images };
  }
}
