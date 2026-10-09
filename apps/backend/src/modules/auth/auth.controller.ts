import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '@prisma/client';
import { LoginResponse, UserInfo } from '@lumina/shared';
import { BindPhoneDto, BindPhoneSendCodeDto, LoginDto, PasswordLoginDto, RegisterDto, SendCodeDto } from './dto/auth.dto';
import { toUserInfo } from './user-info';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * 发送验证码
   */
  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() dto: SendCodeDto): Promise<{ message: string }> {
    if (dto.phone || (dto.account && !dto.account.includes('@'))) {
      await this.authService.sendSmsCode(dto.phone || dto.account!, 'login');
      return { message: '如果账号存在，验证码将发送到对应手机号' };
    }
    await this.authService.sendCode(dto.email || dto.account!, 'login');
    return { message: '验证码已发送，请查收邮件' };
  }

  /**
   * 发送注册验证码
   */
  @Post('register/send-code')
  @HttpCode(HttpStatus.OK)
  async sendRegisterCode(@Body() dto: SendCodeDto): Promise<{ message: string }> {
    if (dto.phone || (dto.account && !dto.account.includes('@'))) {
      await this.authService.sendSmsCode(dto.phone || dto.account!, 'register');
      return { message: '注册短信验证码已发送' };
    }
    await this.authService.sendCode(dto.email || dto.account!, 'register');
    return { message: '注册验证码已发送，请查收邮件' };
  }

  /**
   * 验证码登录
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    const account = dto.account || dto.email || dto.phone!;
    const { accessToken, user } = await this.authService.login(account, dto.code);

    return this.toLoginResponse(accessToken, user);
  }

  /**
   * 密码登录
   */
  @Post('password-login')
  @HttpCode(HttpStatus.OK)
  async passwordLogin(@Body() dto: PasswordLoginDto): Promise<LoginResponse> {
    const account = dto.account || dto.email || dto.phone!;
    const { accessToken, user } = await this.authService.passwordLogin(account, dto.password);

    return this.toLoginResponse(accessToken, user);
  }

  /**
   * 注册
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto): Promise<LoginResponse> {
    const { accessToken, user } = await this.authService.register(dto);

    return this.toLoginResponse(accessToken, user);
  }

  private toLoginResponse(accessToken: string, user: User): LoginResponse {
    const userInfo: UserInfo = toUserInfo(user);

    return {
      accessToken,
      user: userInfo,
    };
  }

  /**
   * 获取当前用户信息
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User): Promise<UserInfo> {
    this.logger.log(`Get current user: ${user.id}`);
    return toUserInfo(user);
  }

  @Post('phone/send-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async sendPhoneBindingCode(
    @CurrentUser() user: User,
    @Body() dto: BindPhoneSendCodeDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    await this.authService.sendSmsCode(dto.phone, 'bind', request.ip, user.id);
    return { message: '绑定短信验证码已发送' };
  }

  @Patch('me/phone')
  @UseGuards(JwtAuthGuard)
  async bindPhone(@CurrentUser() user: User, @Body() dto: BindPhoneDto): Promise<UserInfo> {
    return toUserInfo(await this.authService.bindPhone(user.id, dto.phone, dto.code));
  }
}
