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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { ModelType, UserRole } from '@prisma/client';
import {
  CreateProviderDto,
  UpdateProviderDto,
  CreatePlatformModelDto,
  UpdatePlatformModelDto,
  CreateUpstreamModelDto,
  UpdateUpstreamModelDto,
} from './dto/providers.dto';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  private readonly logger = new Logger(ProvidersController.name);

  constructor(private readonly providersService: ProvidersService) {}

  // ==================== 平台模型 ====================

  @Get('models')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取平台模型列表' })
  @ApiQuery({ name: 'type', required: false, enum: ['CHAT', 'IMAGE'] })
  async getPlatformModels(@Query('type') type?: ModelType) {
    this.logger.log(`获取平台模型列表: type=${type || 'all'}`);
    return this.providersService.getPlatformModels(type);
  }

  @Post('models')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建平台模型' })
  async createPlatformModel(
    @CurrentUser() user: User,
    @Body() dto: CreatePlatformModelDto,
  ) {
    this.logger.log(`创建平台模型: userId=${user.id}, name=${dto.name}`);
    return this.providersService.createPlatformModel(dto);
  }

  @Patch('models/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新平台模型' })
  async updatePlatformModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformModelDto,
  ) {
    this.logger.log(`更新平台模型: userId=${user.id}, id=${id}`);
    return this.providersService.updatePlatformModel(id, dto);
  }

  @Delete('models/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除平台模型' })
  async deletePlatformModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`删除平台模型: userId=${user.id}, id=${id}`);
    return this.providersService.deletePlatformModel(id);
  }

  // ==================== 供应商 ====================

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取所有供应商' })
  async getProviders(@CurrentUser() user: User) {
    this.logger.log(`获取供应商列表: userId=${user.id}`);
    return this.providersService.getProviders();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建供应商' })
  async createProvider(
    @CurrentUser() user: User,
    @Body() dto: CreateProviderDto,
  ) {
    this.logger.log(`创建供应商: userId=${user.id}, name=${dto.name}`);
    return this.providersService.createProvider(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新供应商' })
  async updateProvider(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    this.logger.log(`更新供应商: userId=${user.id}, id=${id}`);
    return this.providersService.updateProvider(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除供应商' })
  async deleteProvider(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`删除供应商: userId=${user.id}, id=${id}`);
    return this.providersService.deleteProvider(id);
  }

  // ==================== 上游映射 ====================

  @Get('models/:id/upstreams')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取某平台模型的上游列表' })
  async getUpstreamsForPlatformModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`获取上游列表: userId=${user.id}, platformModelId=${id}`);
    return this.providersService.getUpstreamsForPlatformModel(id);
  }

  @Post('models/:id/upstreams')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '为平台模型添加上游映射' })
  async addUpstreamModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateUpstreamModelDto,
  ) {
    this.logger.log(`添加上游映射: userId=${user.id}, platformModelId=${id}`);
    return this.providersService.addUpstreamModel({
      ...dto,
      platformModelId: id,
    });
  }

  @Patch('upstreams/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新上游映射' })
  async updateUpstreamModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateUpstreamModelDto,
  ) {
    this.logger.log(`更新上游映射: userId=${user.id}, id=${id}`);
    return this.providersService.updateUpstreamModel(id, dto);
  }

  @Delete('upstreams/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除上游映射' })
  async removeUpstreamModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    this.logger.log(`删除上游映射: userId=${user.id}, id=${id}`);
    return this.providersService.removeUpstreamModel(id);
  }
}
