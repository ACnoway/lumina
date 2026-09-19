import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService, AuditRequestContext } from './admin.service';
import {
  AdjustUserBalanceDto,
  ListAdminUsersQueryDto,
  PaginationQueryDto,
  UpdatePromptOptimizerModelDto,
  UpdateCurrencySettingsDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: '获取管理后台概览' })
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get('settings/prompt-optimizer')
  @ApiOperation({ summary: '获取提示词优化模型配置' })
  async getPromptOptimizerSetting() {
    return this.adminService.getPromptOptimizerSetting();
  }

  @Patch('settings/prompt-optimizer')
  @ApiOperation({ summary: '更新提示词优化模型配置' })
  async updatePromptOptimizerSetting(
    @CurrentUser() actor: User,
    @Body() dto: UpdatePromptOptimizerModelDto,
    @Req() request: Request,
  ) {
    return this.adminService.updatePromptOptimizerSetting(
      actor,
      dto,
      this.auditContext(request),
    );
  }

  @Get('settings/currency')
  @ApiOperation({ summary: '获取平台光子货币设置' })
  async getCurrencySettings() {
    return this.adminService.getCurrencySettings();
  }

  @Patch('settings/currency')
  @ApiOperation({ summary: '更新人民币充值与光子汇率' })
  async updateCurrencySettings(
    @CurrentUser() actor: User,
    @Body() dto: UpdateCurrencySettingsDto,
    @Req() request: Request,
  ) {
    return this.adminService.updateCurrencySettings(
      actor,
      dto,
      this.auditContext(request),
    );
  }

  @Get('users')
  @ApiOperation({ summary: '分页查询用户（管理员）' })
  async listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: '获取用户详情（管理员）' })
  async getUser(@Param('id') userId: string) {
    return this.adminService.getUser(userId);
  }

  @Get('users/:id/transactions')
  @ApiOperation({ summary: '查询用户账本（管理员）' })
  async getUserTransactions(@Param('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.adminService.getUserTransactions(userId, query.page || 1, query.limit || 20);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: '更新用户状态（管理员）' })
  async updateUserStatus(
    @CurrentUser() actor: User,
    @Param('id') userId: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() request: Request,
  ) {
    return this.adminService.updateUserStatus(actor, userId, dto, this.auditContext(request));
  }

  @Post('wallet/adjustments')
  @ApiOperation({ summary: '调整用户钱包余额（管理员）' })
  async adjustUserBalance(
    @CurrentUser() actor: User,
    @Body() dto: AdjustUserBalanceDto,
    @Req() request: Request,
  ) {
    return this.adminService.adjustUserBalance(actor, dto, this.auditContext(request));
  }

  private auditContext(request: Request): AuditRequestContext {
    return {
      ipAddress: request.ip || undefined,
      userAgent: request.get('user-agent') || undefined,
    };
  }
}
