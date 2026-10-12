import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupportConversationStatus,
  SupportMessageSenderType,
  User,
} from '@prisma/client';
import {
  SupportConversationDto,
  SupportConversationsResponse,
  SupportMessageDto,
  SupportMessagesResponse,
  SupportUnreadResponse,
} from '@lumina/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { maskPhone } from '../auth/phone.util';
import {
  SendSupportMessageDto,
  SupportConversationsQueryDto,
  SupportMessagesQueryDto,
  UpdateSupportConversationStatusDto,
} from './dto/support.dto';

export const SUPPORT_ADMIN_EVENTS_CHANNEL = 'support:events:admin';

export function supportConversationEventsChannel(conversationId: string): string {
  return `support:events:conversation:${conversationId}`;
}

const conversationInclude = {
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      nickname: true,
    },
  },
} satisfies Prisma.SupportConversationInclude;

type ConversationRecord = Prisma.SupportConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type MessageRecord = Prisma.SupportMessageGetPayload<{}>;

export interface SupportAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditService: AuditService,
  ) {}

  async getOrCreateConversation(userId: string): Promise<SupportConversationDto> {
    const existing = await this.prisma.supportConversation.findUnique({
      where: { userId },
      include: conversationInclude,
    });

    if (existing) {
      return this.toConversationDto(existing);
    }

    try {
      const created = await this.prisma.supportConversation.create({
        data: {
          userId,
          status: SupportConversationStatus.WAITING_FOR_AGENT,
        },
        include: conversationInclude,
      });
      return this.toConversationDto(created);
    } catch (error) {
      // 并发首次请求时，唯一 userId 约束保证最终只有一个客服会话。
      if (this.isUniqueConstraintError(error)) {
        const concurrent = await this.prisma.supportConversation.findUnique({
          where: { userId },
          include: conversationInclude,
        });
        if (concurrent) return this.toConversationDto(concurrent);
      }
      throw error;
    }
  }

  async getUserConversation(userId: string): Promise<SupportConversationDto> {
    return this.getOrCreateConversation(userId);
  }

  async listUserMessages(
    userId: string,
    query: SupportMessagesQueryDto,
  ): Promise<SupportMessagesResponse> {
    const conversation = await this.findOwnedConversation(userId);
    return this.listMessages(conversation.id, query);
  }

  async sendUserMessage(
    user: User,
    dto: SendSupportMessageDto,
  ): Promise<{ message: SupportMessageDto; conversation: SupportConversationDto }> {
    await this.assertMessageRate(user.id);
    let conversation = await this.getOrCreateConversation(user.id);
    if (conversation.status === SupportConversationStatus.CLOSED) {
      const reopened = await this.prisma.supportConversation.update({
        where: { id: conversation.id },
        data: { status: SupportConversationStatus.WAITING_FOR_AGENT },
        include: conversationInclude,
      });
      conversation = this.toConversationDto(reopened);
    }
    const result = await this.createMessage(conversation.id, SupportMessageSenderType.USER, user.id, dto.content, {
      status: SupportConversationStatus.WAITING_FOR_AGENT,
      userUnreadCount: conversation.userUnreadCount,
      adminUnreadCount: { increment: 1 },
    });
    await this.publishMessage(result.message, result.conversation);
    return result;
  }

  async markUserRead(userId: string): Promise<SupportConversationDto> {
    const conversation = await this.findOwnedConversation(userId);
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversation.id },
      data: { userUnreadCount: 0 },
      include: conversationInclude,
    });
    await this.publishConversation(updated);
    return this.toConversationDto(updated);
  }

  async listConversations(
    query: SupportConversationsQueryDto,
  ): Promise<SupportConversationsResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const keyword = query.keyword?.trim();
    const where: Prisma.SupportConversationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.unread === 'USER' ? { userUnreadCount: { gt: 0 } } : {}),
      ...(query.unread === 'ADMIN' ? { adminUnreadCount: { gt: 0 } } : {}),
      ...(keyword
        ? {
            OR: [
              { lastMessagePreview: { contains: keyword, mode: 'insensitive' } },
              {
                user: {
                  OR: [
                    { email: { contains: keyword, mode: 'insensitive' } },
                    { phone: { contains: keyword, mode: 'insensitive' } },
                    { nickname: { contains: keyword, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.supportConversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [
          { adminUnreadCount: 'desc' },
          { lastMessageAt: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportConversation.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toConversationDto(item)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAdminMessages(
    conversationId: string,
    query: SupportMessagesQueryDto,
  ): Promise<SupportMessagesResponse> {
    await this.getConversationOrThrow(conversationId);
    return this.listMessages(conversationId, query);
  }

  async getAdminUnreadCount(): Promise<SupportUnreadResponse> {
    const aggregate = await this.prisma.supportConversation.aggregate({
      where: { adminUnreadCount: { gt: 0 } },
      _sum: { adminUnreadCount: true },
    });
    return {
      unreadCount: aggregate._sum.adminUnreadCount || 0,
    };
  }

  async sendAdminMessage(
    actor: User,
    conversationId: string,
    dto: SendSupportMessageDto,
    context: SupportAuditContext,
  ): Promise<{ message: SupportMessageDto; conversation: SupportConversationDto }> {
    const conversation = await this.getConversationOrThrow(conversationId);
    if (conversation.status === SupportConversationStatus.CLOSED) {
      throw new BadRequestException('会话已结束，请先重新打开会话');
    }

    const result = await this.createMessage(
      conversationId,
      SupportMessageSenderType.ADMIN,
      actor.id,
      dto.content,
      {
        status: SupportConversationStatus.WAITING_FOR_USER,
        userUnreadCount: { increment: 1 },
        adminUnreadCount: 0,
      },
    );

    await this.auditService.record({
      actorId: actor.id,
      action: 'support.message.created',
      resource: 'support_conversation',
      details: { targetId: conversationId, senderType: SupportMessageSenderType.ADMIN },
      ...context,
    });
    await this.publishMessage(result.message, result.conversation);
    return result;
  }

  async markAdminRead(conversationId: string): Promise<SupportConversationDto> {
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { adminUnreadCount: 0 },
      include: conversationInclude,
    });
    await this.publishConversation(updated);
    return this.toConversationDto(updated);
  }

  async updateStatus(
    actor: User,
    conversationId: string,
    dto: UpdateSupportConversationStatusDto,
    context: SupportAuditContext,
  ): Promise<SupportConversationDto> {
    const before = await this.getConversationOrThrow(conversationId);
    const after = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: dto.status },
      include: conversationInclude,
    });

    await this.auditService.record({
      actorId: actor.id,
      action: 'support.conversation.status.updated',
      resource: 'support_conversation',
      details: {
        targetId: conversationId,
        before: { status: before.status },
        after: { status: after.status },
      },
      ...context,
    });
    await this.publishConversation(after);
    return this.toConversationDto(after);
  }

  async subscribe(
    channel: string,
    write: (event: string) => void,
  ): Promise<() => Promise<void>> {
    return this.redis.subscribe(channel, write);
  }

  private async findOwnedConversation(userId: string): Promise<ConversationRecord> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { userId },
      include: conversationInclude,
    });
    if (!conversation) {
      await this.getOrCreateConversation(userId);
      return this.findOwnedConversation(userId);
    }
    return conversation;
  }

  private async getConversationOrThrow(conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude,
    });
    if (!conversation) throw new NotFoundException('客服会话不存在');
    return conversation;
  }

  private async listMessages(
    conversationId: string,
    query: SupportMessagesQueryDto,
  ): Promise<SupportMessagesResponse> {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const [rows, total] = await Promise.all([
      this.prisma.supportMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportMessage.count({ where: { conversationId } }),
    ]);

    return {
      messages: rows.reverse().map((message) => this.toMessageDto(message)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async createMessage(
    conversationId: string,
    senderType: SupportMessageSenderType,
    senderId: string,
    content: string,
    conversationData: Prisma.SupportConversationUpdateInput,
  ): Promise<{ message: SupportMessageDto; conversation: SupportConversationDto }> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('消息不能为空');

    const result = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          conversationId,
          senderType,
          senderId,
          content: trimmed,
        },
      });
      const conversation = await tx.supportConversation.update({
        where: { id: conversationId },
        data: {
          ...conversationData,
          lastMessagePreview: this.toPreview(trimmed),
          lastMessageAt: message.createdAt,
        },
        include: conversationInclude,
      });
      return { message, conversation };
    });

    return {
      message: this.toMessageDto(result.message),
      conversation: this.toConversationDto(result.conversation),
    };
  }

  private async assertMessageRate(userId: string): Promise<void> {
    if (await this.redis.isRateLimited(`support:message:user:${userId}`, 20, 60)) {
      throw new HttpException('客服消息发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async publishMessage(
    message: SupportMessageDto,
    conversation: SupportConversationDto,
  ): Promise<void> {
    const payload = JSON.stringify({ type: 'message', message, conversation });
    await this.publishSafely(SUPPORT_ADMIN_EVENTS_CHANNEL, payload);
    await this.publishSafely(supportConversationEventsChannel(conversation.id), payload);
  }

  private async publishConversation(conversation: ConversationRecord): Promise<void> {
    const payload = JSON.stringify({
      type: 'conversation',
      conversation: this.toConversationDto(conversation),
    });
    await this.publishSafely(SUPPORT_ADMIN_EVENTS_CHANNEL, payload);
    await this.publishSafely(supportConversationEventsChannel(conversation.id), payload);
  }

  private async publishSafely(channel: string, payload: string): Promise<void> {
    try {
      await this.redis.publish(channel, payload);
    } catch (error) {
      this.logger.warn(`客服实时事件发布失败 channel=${channel}: ${String(error)}`);
    }
  }

  private toConversationDto(conversation: ConversationRecord): SupportConversationDto {
    return {
      id: conversation.id,
      userId: conversation.userId,
      user: {
        id: conversation.user.id,
        email: conversation.user.email,
        phone: maskPhone(conversation.user.phone),
        nickname: conversation.user.nickname,
      },
      status: conversation.status,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      userUnreadCount: conversation.userUnreadCount,
      adminUnreadCount: conversation.adminUnreadCount,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessageDto(message: MessageRecord): SupportMessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderType: message.senderType,
      senderId: message.senderId,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toPreview(content: string): string {
    return content.length > 160 ? `${content.slice(0, 157)}...` : content;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
