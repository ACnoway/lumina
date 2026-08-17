import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from '../chat/adapters/adapter-factory';
import { MinioService } from '../../minio/minio.service';
import { Prisma } from '@prisma/client';
import axios from 'axios';

// 比例 → 尺寸映射
const ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

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
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly providersService: ProvidersService,
    private readonly adapterFactory: AdapterFactory,
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  // ==================== 提示词优化 ====================

  /**
   * 用聊天模型优化用户的简短提示词
   * 独立计费
   */
  async optimizePrompt(
    userId: string,
    originalPrompt: string,
  ): Promise<{ optimizedPrompt: string; cost: number }> {
    const optimizerModelName = this.configService.get<string>(
      'PROMPT_OPTIMIZER_MODEL',
      'gpt-4o-mini',
    );

    // 获取优化用的平台模型
    const platformModel =
      await this.providersService.getPlatformModelByName(optimizerModelName);

    if (!platformModel || !platformModel.isActive) {
      throw new ServiceUnavailableException(
        `提示词优化模型 "${optimizerModelName}" 不可用`,
      );
    }

    // 获取定价
    const pricing = (platformModel.pricing as any) || {};
    const inputPrice = Number(pricing.input) || 0;
    const outputPrice = Number(pricing.output) || 0;

    // 预估成本（系统指令 + 用户输入 ≈ 300 token，输出 ≈ 150 token）
    const estimatedInputTokens = 350;
    const estimatedOutputTokens = 200;
    const estimatedCost =
      (estimatedInputTokens / 1000) * inputPrice +
      (estimatedOutputTokens / 1000) * outputPrice;

    const idempotencyKey = `prompt-opt:${userId}:${Date.now()}`;

    // 预扣
    await this.walletService.preDeduct(
      userId,
      Math.max(estimatedCost, 0.01),
      idempotencyKey,
    );

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
    const adapter = this.adapterFactory.createAdapter(
      resolved.provider.apiFormat,
      providerConfig,
    );

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
        (response.inputTokens / 1000) * inputPrice +
        (response.outputTokens / 1000) * outputPrice;

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
      throw error instanceof Error
        ? error
        : new ServiceUnavailableException('提示词优化失败');
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
    },
  ) {
    // 验证模型存在且是生图类型
    const platformModel = await this.providersService.getPlatformModelByName(
      data.model,
    );

    if (!platformModel) {
      throw new NotFoundException(`模型 "${data.model}" 不存在`);
    }
    if (!platformModel.isActive) {
      throw new BadRequestException(`模型 "${data.model}" 已禁用`);
    }
    if (platformModel.type !== 'IMAGE') {
      throw new BadRequestException(`模型 "${data.model}" 不是生图模型`);
    }

    // 获取定价
    const pricing = (platformModel.pricing as any) || {};
    const perImagePrice = Number(pricing.perImage) || 0;

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
        parameters: data.aspectRatio
          ? { aspectRatio: data.aspectRatio }
          : undefined,
      },
    });

    // 异步处理（不 await，后台执行）
    this.processImageTask(
      userId,
      task.id,
      data.prompt,
      data.negativePrompt,
      data.model,
      data.aspectRatio,
      perImagePrice,
    ).catch((err) => {
      this.logger.error(`生图任务异步处理异常: taskId=${task.id}, err=${err.message}`);
    });

    this.logger.log(`创建生图任务: userId=${userId}, taskId=${task.id}, model=${data.model}`);

    return task;
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
  ): Promise<void> {
    const idempotencyKey = `image:${taskId}`;

    // 1. 预扣
    try {
      const preDeductAmount = Math.max(perImagePrice, 0.01);
      await this.walletService.preDeduct(userId, preDeductAmount, idempotencyKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '预扣失败';
      await this.failTask(taskId, msg);
      return;
    }

    // 2. 路由上游
    let resolved;
    try {
      resolved = await this.providersService.resolveUpstream(modelName);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '路由失败';
      await this.walletService.refund(userId, idempotencyKey, '生图路由失败');
      await this.failTask(taskId, msg);
      return;
    }

    // 更新任务状态为处理中
    await this.prisma.imageGeneration.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', provider: resolved.provider.name },
    });

    // 3. 调用上游生图 API
    try {
      const providerConfig = (resolved.provider.config as Record<string, any>) || {};
      const size = ASPECT_RATIO_SIZES[aspectRatio || '1:1'] || ASPECT_RATIO_SIZES['1:1'];

      // 根据 apiFormat 调用不同的生图接口
      let imageBuffer: Buffer;

      switch (resolved.provider.apiFormat) {
        case 'openai_image':
        case 'openai_compatible':
          ({ imageBuffer } = await this.callOpenAIImage(
            providerConfig,
            resolved.upstreamModel.upstreamModelId,
            prompt,
            size,
          ));
          break;

        case 'stability_image':
          ({ imageBuffer } = await this.callStabilityImage(
            providerConfig,
            resolved.upstreamModel.upstreamModelId,
            prompt,
            negativePrompt,
            size,
          ));
          break;

        default:
          throw new BadRequestException(
            `apiFormat "${resolved.provider.apiFormat}" 不支持生图`,
          );
      }

      // 4. 上传到 MinIO
      const objectName = `images/${taskId}.png`;
      await this.minioService.upload(objectName, imageBuffer, imageBuffer.length);

      // 获取预签名 URL
      const presignedUrl = await this.minioService.getPresignedUrl(objectName);

      // 5. 结算
      await this.walletService.settle(
        userId,
        perImagePrice,
        idempotencyKey,
        `生图: ${modelName}`,
        { taskId, model: modelName },
      );

      // 6. 更新任务状态为成功
      await this.prisma.imageGeneration.update({
        where: { id: taskId },
        data: {
          status: 'SUCCESS',
          imageUrl: presignedUrl,
          imageKey: objectName,
          cost: perImagePrice,
          width: size.width,
          height: size.height,
        },
      });

      // 记录上游成功
      await resolved.recordResult(true);

      this.logger.log(`生图任务完成: taskId=${taskId}, cost=${perImagePrice}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '生图失败';

      // 退回预扣
      await this.walletService.refund(userId, idempotencyKey, `生图失败: ${msg}`);

      // 记录上游失败
      await resolved.recordResult(false);

      // 更新任务状态为失败
      await this.failTask(taskId, msg);

      this.logger.error(`生图任务失败: taskId=${taskId}, err=${msg}`);
    }
  }

  /**
   * 调用 OpenAI Images API
   */
  private async callOpenAIImage(
    config: Record<string, any>,
    model: string,
    prompt: string,
    size: { width: number; height: number },
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
    });

    if (!task) {
      throw new NotFoundException('生图任务不存在');
    }

    if (task.userId !== userId) {
      throw new BadRequestException('无权访问该任务');
    }

    // 如果图片 URL 是预签名的，可能需要刷新（7天过期）
    // 这里简单返回，前端可以缓存
    return task;
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
      }),
      this.prisma.imageGeneration.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
