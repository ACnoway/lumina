import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { WalletService } from '../wallet/wallet.service';
import { ProvidersService } from '../providers/providers.service';
import { AdapterFactory } from './adapters/adapter-factory';
import { TokenUsage } from './adapters/types';
import { SendMessageDto } from './dto/chat.dto';

// 上下文消息数量
const CONTEXT_MESSAGES_COUNT = 20;
// 默认预估输出 token
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 1000;
// 自动标题截断长度
const AUTO_TITLE_LENGTH = 30;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly providersService: ProvidersService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  // ==================== 会话管理 ====================

  /**
   * 创建会话
   */
  async createSession(userId: string, title?: string) {
    const session = await this.prisma.chatSession.create({
      data: {
        userId,
        title: title || '新对话',
      },
    });

    this.logger.log(`创建会话: userId=${userId}, sessionId=${session.id}`);
    return session;
  }

  /**
   * 获取用户会话列表（分页）
   */
  async getSessions(userId: string, page: number = 1, limit: number = 20) {
    const where: Prisma.ChatSessionWhereInput = { userId };

    const [sessions, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return { sessions, total, page, limit };
  }

  /**
   * 获取单个会话（验证所有权）
   */
  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问该会话');
    }

    return session;
  }

  /**
   * 更新会话标题
   */
  async updateSession(userId: string, sessionId: string, title: string) {
    await this.getSession(userId, sessionId);

    const session = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { title },
    });

    this.logger.log(`更新会话标题: userId=${userId}, sessionId=${sessionId}`);
    return session;
  }

  /**
   * 删除会话（级联删除消息）
   */
  async deleteSession(userId: string, sessionId: string) {
    await this.getSession(userId, sessionId);

    await this.prisma.chatSession.delete({
      where: { id: sessionId },
    });

    this.logger.log(`删除会话: userId=${userId}, sessionId=${sessionId}`);
  }

  // ==================== 消息查询 ====================

  /**
   * 获取会话历史消息（分页，按时间正序）
   */
  async getMessages(
    userId: string,
    sessionId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    await this.getSession(userId, sessionId);

    const where: Prisma.ChatMessageWhereInput = { sessionId };

    const [messages, total] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatMessage.count({ where }),
    ]);

    // Prisma Decimal 在 JSON 序列化时会变成字符串，接口契约要求 cost 为 number。
    // 在后端边界统一转换，避免前端对历史消息调用 toFixed 时发生类型错误。
    return {
      messages: messages.map((message) => ({
        ...message,
        cost: message.cost === null ? null : Number(message.cost.toString()),
      })),
      total,
      page,
      limit,
    };
  }

  // ==================== 发送消息（流式） ====================

  /**
   * 发送消息并流式返回响应
   * 完整流程：保存用户消息 → 预扣 → 路由上游 → 流式调用 → 结算/退回 → 保存AI回复
   */
  async sendMessageStream(
    userId: string,
    dto: SendMessageDto,
    res: Response,
  ): Promise<void> {
    // ---- 1. 验证会话所有权 ----
    const session = await this.getSession(userId, dto.sessionId);

    // ---- 2. 统计现有消息数（用于判断是否需要自动标题） ----
    const existingCount = await this.prisma.chatMessage.count({
      where: { sessionId: session.id },
    });

    // ---- 3. 保存用户消息 ----
    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: dto.content,
      },
    });

    // ---- 4. 自动更新标题（第一条消息时） ----
    if (existingCount === 0 && session.title === '新对话') {
      const autoTitle =
        dto.content.length > AUTO_TITLE_LENGTH
          ? dto.content.slice(0, AUTO_TITLE_LENGTH) + '...'
          : dto.content;
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { title: autoTitle },
      }).catch((err) => {
        this.logger.warn(`自动更新标题失败: ${err.message}`);
      });
    }

    // ---- 5. 获取平台模型（含定价） ----
    const platformModel = await this.providersService.getPlatformModelByName(
      dto.model,
    );

    if (!platformModel) {
      throw new NotFoundException(`模型 "${dto.model}" 不存在`);
    }
    if (!platformModel.isActive) {
      throw new BadRequestException(`模型 "${dto.model}" 已禁用`);
    }
    if (platformModel.type !== 'CHAT') {
      throw new BadRequestException(`模型 "${dto.model}" 不是聊天模型`);
    }

    // ---- 6. 构建上下文消息列表 ----
    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: CONTEXT_MESSAGES_COUNT,
    });

    const messages = history.map((m) => ({
      role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // ---- 7. 预估成本并预扣 ----
    const pricing = (platformModel.pricing as any) || {};
    const inputPrice = Number(pricing.input) || 0; // 每千 token 价格
    const outputPrice = Number(pricing.output) || 0;

    // 粗略预估：输入字符数/2 + 预估输出 token
    const estimatedInputTokens = Math.ceil(
      messages.reduce((sum, m) => sum + m.content.length, 0) / 2,
    );
    const estimatedOutputTokens = dto.maxTokens || DEFAULT_ESTIMATED_OUTPUT_TOKENS;
    const estimatedCost =
      (estimatedInputTokens / 1000) * inputPrice +
      (estimatedOutputTokens / 1000) * outputPrice;

    // 预扣至少 0.01 光子，避免极小金额
    const preDeductAmount = Math.max(estimatedCost, 0.01);
    const idempotencyKey = `chat:${session.id}:${userMessage.id}`;

    this.logger.log(
      `预扣: userId=${userId}, key=${idempotencyKey}, estimated=${preDeductAmount}`,
    );

    await this.walletService.preDeduct(
      userId,
      preDeductAmount,
      idempotencyKey,
    );

    // ---- 8. 路由上游 ----
    let resolved;
    try {
      resolved = await this.providersService.resolveUpstream(dto.model);
    } catch (error) {
      // 路由失败，退回预扣
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`路由失败，退回预扣: ${errMsg}`);
      await this.walletService.refund(userId, idempotencyKey, '路由失败');
      throw error;
    }

    // ---- 9. 创建适配器 ----
    const providerConfig = (resolved.provider.config as Record<string, any>) || {};
    const adapter = this.adapterFactory.createAdapter(
      resolved.provider.apiFormat,
      providerConfig,
    );

    // 上游实际模型名
    const upstreamModelId = resolved.upstreamModel.upstreamModelId;
    // 上游 maxTokens 限制（可选覆盖平台值）
    const maxTokens =
      dto.maxTokens ||
      resolved.upstreamModel.maxTokens ||
      platformModel.maxTokens ||
      undefined;

    // ---- 10. 设置 SSE 响应头 ----
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲

    // 辅助函数：安全写入 SSE
    let responseEnded = false;
    const writeSSE = (data: Record<string, any>): void => {
      if (responseEnded || res.destroyed) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // 响应可能已关闭
      }
    };

    const endResponse = (data?: Record<string, any>): void => {
      if (responseEnded) return;
      responseEnded = true;
      if (data && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // 忽略
        }
      }
      if (!res.destroyed) {
        try {
          res.end();
        } catch {
          // 忽略
        }
      }
    };

    // ---- 11. 流式调用上游 ----
    let fullContent = '';
    let streamUsage: TokenUsage | null = null;
    let streamError: Error | null = null;

    try {
      await adapter.chatStream(
        {
          messages,
          model: upstreamModelId,
          temperature: dto.temperature,
          maxTokens,
          stream: true,
        },
        {
          onContent: (chunk: string) => {
            fullContent += chunk;
            writeSSE({ type: 'content', content: chunk });
          },
          onDone: (usage: TokenUsage) => {
            streamUsage = usage;
          },
          onError: (err: Error) => {
            streamError = err;
          },
        },
      );

      // ---- 12. 流结束后处理结果 ----
      if (streamError) {
        await this.handleStreamError(
          streamError as Error,
          userId,
          idempotencyKey,
          session.id,
          resolved.recordResult,
        );
        endResponse({ type: 'error', message: (streamError as Error).message });
      } else if (streamUsage) {
        // TS 不追踪回调内的赋值，需要类型断言
        const usage = streamUsage as TokenUsage;

        // 计算实际成本
        const actualCost =
          (usage.inputTokens / 1000) * inputPrice +
          (usage.outputTokens / 1000) * outputPrice;

        // 结算钱包
        await this.walletService.settle(
          userId,
          actualCost,
          idempotencyKey,
          `聊天: ${dto.model}`,
          {
            sessionId: session.id,
            messageId: userMessage.id,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model: dto.model,
          },
        );

        // 保存 AI 回复
        await this.prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'ASSISTANT',
            content: fullContent,
            tokens: usage.totalTokens,
            cost: actualCost,
          },
        });

        // 记录上游成功
        await resolved.recordResult(true);

        this.logger.log(
          `聊天完成: userId=${userId}, sessionId=${session.id}, ` +
            `tokens=${usage.totalTokens}, cost=${actualCost}`,
        );

        endResponse({
          type: 'done',
          usage,
          cost: actualCost,
        });
      } else {
        // 异常情况：既没有 usage 也没有 error
        await this.walletService.refund(userId, idempotencyKey, '流异常结束');
        await resolved.recordResult(false);
        endResponse({ type: 'error', message: '流式响应异常结束' });
      }
    } catch (error) {
      // 捕获 chatStream 抛出的异常
      const err =
        error instanceof Error ? error : new Error(String(error));

      if (!streamError) {
        streamError = err;
      }

      await this.handleStreamError(
        streamError,
        userId,
        idempotencyKey,
        session.id,
        resolved.recordResult,
      );
      endResponse({ type: 'error', message: streamError.message });
    }
  }

  /**
   * 处理流式错误：退回预扣、保存错误消息、记录上游失败
   */
  private async handleStreamError(
    error: Error,
    userId: string,
    idempotencyKey: string,
    sessionId: string,
    recordResult: (success: boolean) => Promise<void>,
  ): Promise<void> {
    this.logger.error(`聊天流错误: ${error.message}`, error.stack);

    // 退回预扣
    try {
      await this.walletService.refund(userId, idempotencyKey, `聊天失败: ${error.message}`);
    } catch (err) {
      this.logger.error(`退回预扣失败: ${err}`);
    }

    // 记录上游失败
    try {
      await recordResult(false);
    } catch (err) {
      this.logger.error(`记录上游失败出错: ${err}`);
    }

    // 保存错误消息（让用户在历史记录中看到）
    try {
      await this.prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'ASSISTANT',
          content: `[错误] 请求失败: ${error.message}`,
        },
      });
    } catch (err) {
      this.logger.error(`保存错误消息失败: ${err}`);
    }
  }
}
