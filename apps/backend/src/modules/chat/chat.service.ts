import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    // 先验证所有权
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
    // 先验证所有权
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
    // 先验证会话所有权
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

    return { messages, total, page, limit };
  }
}
