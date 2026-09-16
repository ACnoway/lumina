import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
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
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
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

  constructor(
    private readonly providersService: ProvidersService,
    private readonly auditService: AuditService,
  ) {}

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
    @Req() request: Request,
  ) {
    this.logger.log(`创建平台模型: userId=${user.id}, name=${dto.name}`);
    const model = await this.providersService.createPlatformModel(dto);
    await this.auditMutation(
      user,
      request,
      'platform_model.created',
      'platform_model',
      model.id,
      { after: this.platformModelAuditDetails(model) },
    );
    return model;
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
    @Req() request: Request,
  ) {
    this.logger.log(`更新平台模型: userId=${user.id}, id=${id}`);
    const model = await this.providersService.updatePlatformModel(id, dto);
    await this.auditMutation(
      user,
      request,
      'platform_model.updated',
      'platform_model',
      model.id,
      {
        updatedFields: Object.keys(dto),
        after: this.platformModelAuditDetails(model),
      },
    );
    return model;
  }

  @Delete('models/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除平台模型' })
  async deletePlatformModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    this.logger.log(`删除平台模型: userId=${user.id}, id=${id}`);
    const model = await this.providersService.deletePlatformModel(id);
    await this.auditMutation(
      user,
      request,
      'platform_model.deleted',
      'platform_model',
      model.id,
      { before: this.platformModelAuditDetails(model) },
    );
    return model;
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
    @Req() request: Request,
  ) {
    this.logger.log(`创建供应商: userId=${user.id}, name=${dto.name}`);
    const provider = await this.providersService.createProvider(dto);
    await this.auditMutation(
      user,
      request,
      'provider.created',
      'provider',
      provider.id,
      { after: this.providerAuditDetails(provider) },
    );
    return provider;
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
    @Req() request: Request,
  ) {
    this.logger.log(`更新供应商: userId=${user.id}, id=${id}`);
    const provider = await this.providersService.updateProvider(id, dto);
    await this.auditMutation(
      user,
      request,
      'provider.updated',
      'provider',
      provider.id,
      {
        updatedFields: Object.keys(dto),
        after: this.providerAuditDetails(provider),
      },
    );
    return provider;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除供应商' })
  async deleteProvider(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    this.logger.log(`删除供应商: userId=${user.id}, id=${id}`);
    const provider = await this.providersService.deleteProvider(id);
    await this.auditMutation(
      user,
      request,
      'provider.deleted',
      'provider',
      provider.id,
      { before: this.providerAuditDetails(provider) },
    );
    return provider;
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
    @Req() request: Request,
  ) {
    this.logger.log(`添加上游映射: userId=${user.id}, platformModelId=${id}`);
    const upstream = await this.providersService.addUpstreamModel({
      ...dto,
      platformModelId: id,
    });
    await this.auditMutation(
      user,
      request,
      'upstream_model.created',
      'upstream_model',
      upstream.id,
      { after: this.upstreamAuditDetails(upstream) },
    );
    return upstream;
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
    @Req() request: Request,
  ) {
    this.logger.log(`更新上游映射: userId=${user.id}, id=${id}`);
    const upstream = await this.providersService.updateUpstreamModel(id, dto);
    await this.auditMutation(
      user,
      request,
      'upstream_model.updated',
      'upstream_model',
      upstream.id,
      {
        updatedFields: Object.keys(dto),
        after: this.upstreamAuditDetails(upstream),
      },
    );
    return upstream;
  }

  @Delete('upstreams/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除上游映射' })
  async removeUpstreamModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    this.logger.log(`删除上游映射: userId=${user.id}, id=${id}`);
    const upstream = await this.providersService.removeUpstreamModel(id);
    await this.auditMutation(
      user,
      request,
      'upstream_model.deleted',
      'upstream_model',
      upstream.id,
      { before: this.upstreamAuditDetails(upstream) },
    );
    return upstream;
  }

  private async auditMutation(
    user: User,
    request: Request,
    action: string,
    resource: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      actorId: user.id,
      action,
      resource,
      details: { targetId, ...metadata },
      ipAddress: request.ip || undefined,
      userAgent: request.get('user-agent') || undefined,
    });
  }

  private platformModelAuditDetails(model: {
    id: string;
    name: string;
    type: ModelType;
    isActive: boolean;
  }): Record<string, unknown> {
    return {
      id: model.id,
      name: model.name,
      type: model.type,
      isActive: model.isActive,
    };
  }

  private providerAuditDetails(provider: {
    id: string;
    name: string;
    apiFormat: string;
    supportsStreaming: boolean;
    isActive: boolean;
  }): Record<string, unknown> {
    return {
      id: provider.id,
      name: provider.name,
      apiFormat: provider.apiFormat,
      supportsStreaming: provider.supportsStreaming,
      isActive: provider.isActive,
    };
  }

  private upstreamAuditDetails(upstream: {
    id: string;
    platformModelId: string;
    providerId: string;
    upstreamModelId: string;
    priority: number;
    weight: number;
    isActive: boolean;
  }): Record<string, unknown> {
    return {
      id: upstream.id,
      platformModelId: upstream.platformModelId,
      providerId: upstream.providerId,
      upstreamModelId: upstream.upstreamModelId,
      priority: upstream.priority,
      weight: upstream.weight,
      isActive: upstream.isActive,
    };
  }
}
