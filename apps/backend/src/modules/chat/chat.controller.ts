import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import {
  CreateSessionDto,
  UpdateSessionDto,
  GetSessionsQueryDto,
  GetMessagesQueryDto,
} from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  // ==================== 会话管理 ====================

  @Post('sessions')
  @ApiOperation({ summary: '创建会话' })
  async createSession(
    @CurrentUser() user: User,
    @Body() dto: CreateSessionDto,
  ) {
    this.logger.log(`创建会话: userId=${user.id}`);
    return this.chatService.createSession(user.id, dto.title);
  }

  @Get('sessions')
  @ApiOperation({ summary: '获取会话列表' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  async getSessions(
    @CurrentUser() user: User,
    @Query() query: GetSessionsQueryDto,
  ) {
    this.logger.log(`获取会话列表: userId=${user.id}`);
    return this.chatService.getSessions(
      user.id,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '获取单个会话' })
  async getSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`获取会话: userId=${user.id}, sessionId=${id}`);
    return this.chatService.getSession(user.id, id);
  }

  @Patch('sessions/:id')
  @ApiOperation({ summary: '更新会话标题' })
  async updateSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    this.logger.log(`更新会话: userId=${user.id}, sessionId=${id}`);
    return this.chatService.updateSession(user.id, id, dto.title || '新对话');
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: '删除会话' })
  async deleteSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`删除会话: userId=${user.id}, sessionId=${id}`);
    await this.chatService.deleteSession(user.id, id);
    return { message: '会话已删除' };
  }

  // ==================== 消息查询 ====================

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: '获取会话历史消息' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  async getMessages(
    @CurrentUser() user: User,
    @Param('id') sessionId: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    this.logger.log(
      `获取消息: userId=${user.id}, sessionId=${sessionId}, page=${query.page}`,
    );
    return this.chatService.getMessages(
      user.id,
      sessionId,
      query.page || 1,
      query.limit || 50,
    );
  }
}
