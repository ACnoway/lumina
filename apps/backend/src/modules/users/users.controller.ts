import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { GetCurrentUserResponse } from '@lumina/shared';
import { ChangePasswordDto } from './dto/users.dto';

@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * 获取当前用户信息（包含钱包）
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(
    @CurrentUser() user: User,
  ): Promise<GetCurrentUserResponse> {
    this.logger.log(`Get current user: ${user.id}`);

    const userWithWallet = await this.usersService.findByIdWithWallet(user.id);

    if (!userWithWallet) {
      throw new NotFoundException('用户不存在');
    }

    return {
      user: {
        id: userWithWallet.id,
        email: userWithWallet.email,
        nickname: userWithWallet.nickname,
        avatar: userWithWallet.avatar,
        role: userWithWallet.role,
        status: userWithWallet.status,
      },
      wallet: userWithWallet.wallet
        ? {
            id: userWithWallet.wallet.id,
            balance: parseFloat(userWithWallet.wallet.balance.toString()),
          }
        : { id: '', balance: 0 },
    };
  }

  /**
   * 修改当前用户密码。
   */
  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.usersService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmPassword,
    );

    return { message: '密码修改成功' };
  }
}
