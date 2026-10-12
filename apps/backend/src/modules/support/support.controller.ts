import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupportService, supportConversationEventsChannel, SUPPORT_ADMIN_EVENTS_CHANNEL } from './support.service';
import {
  SendSupportMessageDto,
  SupportConversationsQueryDto,
  SupportMessagesQueryDto,
  UpdateSupportConversationStatusDto,
} from './dto/support.dto';

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('conversation')
  @ApiOperation({ summary: '获取当前用户客服会话' })
  async getConversation(@CurrentUser() user: User) {
    return { conversation: await this.supportService.getUserConversation(user.id) };
  }

  @Get('conversation/messages')
  @ApiOperation({ summary: '查询当前用户客服消息' })
  async getMessages(
    @CurrentUser() user: User,
    @Query() query: SupportMessagesQueryDto,
  ) {
    return this.supportService.listUserMessages(user.id, query);
  }

  @Post('conversation/messages')
  @ApiOperation({ summary: '发送客服消息' })
  async sendMessage(@CurrentUser() user: User, @Body() dto: SendSupportMessageDto) {
    return this.supportService.sendUserMessage(user, dto);
  }

  @Post('conversation/read')
  @ApiOperation({ summary: '标记用户侧客服消息已读' })
  async markRead(@CurrentUser() user: User) {
    return { conversation: await this.supportService.markUserRead(user.id) };
  }

  @Get('conversation/events')
  @ApiOperation({ summary: '订阅用户客服消息 SSE' })
  async conversationEvents(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const conversation = await this.supportService.getUserConversation(user.id);
    await this.openSse(
      response,
      request,
      supportConversationEventsChannel(conversation.id),
    );
  }

  @Get('admin/conversations')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '分页查询客服会话队列' })
  async listConversations(@Query() query: SupportConversationsQueryDto) {
    return this.supportService.listConversations(query);
  }

  @Get('admin/unread-count')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '查询客服未读总数' })
  async unreadCount() {
    return this.supportService.getAdminUnreadCount();
  }

  @Get('admin/conversations/:id/messages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '查询客服会话消息' })
  async getAdminMessages(
    @Param('id') conversationId: string,
    @Query() query: SupportMessagesQueryDto,
  ) {
    return this.supportService.getAdminMessages(conversationId, query);
  }

  @Post('admin/conversations/:id/messages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '发送管理员客服回复' })
  async sendAdminMessage(
    @CurrentUser() actor: User,
    @Param('id') conversationId: string,
    @Body() dto: SendSupportMessageDto,
    @Req() request: Request,
  ) {
    return this.supportService.sendAdminMessage(
      actor,
      conversationId,
      dto,
      this.auditContext(request),
    );
  }

  @Post('admin/conversations/:id/read')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '标记客服会话已读' })
  async markAdminRead(@Param('id') conversationId: string) {
    return { conversation: await this.supportService.markAdminRead(conversationId) };
  }

  @Patch('admin/conversations/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '更新客服会话状态' })
  async updateStatus(
    @CurrentUser() actor: User,
    @Param('id') conversationId: string,
    @Body() dto: UpdateSupportConversationStatusDto,
    @Req() request: Request,
  ) {
    return {
      conversation: await this.supportService.updateStatus(
        actor,
        conversationId,
        dto,
        this.auditContext(request),
      ),
    };
  }

  @Get('admin/events')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '订阅客服队列 SSE' })
  async adminEvents(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.openSse(response, request, SUPPORT_ADMIN_EVENTS_CHANNEL);
  }

  private async openSse(
    response: Response,
    request: Request,
    channel: string,
  ): Promise<void> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
    response.write('event: ready\ndata: {"type":"ready"}\n\n');

    let closed = false;
    let unsubscribe: () => Promise<void> = async () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const close = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      void unsubscribe();
    };
    request.once('close', close);
    response.once('close', close);

    try {
      unsubscribe = await this.supportService.subscribe(channel, (message) => {
        if (!closed && !response.writableEnded) {
          response.write(`data: ${message}\n\n`);
        }
      });
      if (closed) {
        await unsubscribe();
        return;
      }
      heartbeat = setInterval(() => {
        if (!closed && !response.writableEnded) response.write(': heartbeat\n\n');
      }, 25000);
    } catch (error) {
      close();
      throw error;
    }
  }

  private auditContext(request: Request) {
    return {
      ipAddress: request.ip || undefined,
      userAgent: request.get('user-agent') || undefined,
    };
  }
}
