import {
  Controller,
  Get,
  Post,
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
import { ImageService } from './image.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import {
  OptimizePromptDto,
  CreateImageTaskDto,
  GetImageHistoryQueryDto,
} from './dto/image.dto';

@ApiTags('image')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('image')
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(private readonly imageService: ImageService) {}

  // ==================== 提示词优化 ====================

  @Post('optimize-prompt')
  @ApiOperation({ summary: '提示词优化（单独计费）' })
  async optimizePrompt(
    @CurrentUser() user: User,
    @Body() dto: OptimizePromptDto,
  ) {
    this.logger.log(`提示词优化: userId=${user.id}`);
    return this.imageService.optimizePrompt(user.id, dto.prompt);
  }

  // ==================== 生图任务 ====================

  @Post('generate')
  @ApiOperation({ summary: '创建生图任务（异步处理）' })
  async createTask(
    @CurrentUser() user: User,
    @Body() dto: CreateImageTaskDto,
  ) {
    this.logger.log(
      `创建生图任务: userId=${user.id}, model=${dto.model}`,
    );
    return this.imageService.createImageTask(user.id, dto);
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: '查询生图任务状态' })
  async getTask(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`查询生图任务: userId=${user.id}, taskId=${id}`);
    return this.imageService.getTask(user.id, id);
  }

  @Get('history')
  @ApiOperation({ summary: '生图历史记录' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  async getHistory(
    @CurrentUser() user: User,
    @Query() query: GetImageHistoryQueryDto,
  ) {
    this.logger.log(`生图历史: userId=${user.id}`);
    return this.imageService.getHistory(
      user.id,
      query.page || 1,
      query.limit || 20,
    );
  }
}
