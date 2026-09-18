import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '@prisma/client';
import { LoginResponse, UserInfo } from '@lumina/shared';
import { LoginDto, PasswordLoginDto, RegisterDto, SendCodeDto } from './dto/auth.dto';

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
    this.logger.log(`Send code request for: ${dto.email}`);
    await this.authService.sendCode(dto.email, 'login');
    return { message: '验证码已发送，请查收邮件' };
  }

  /**
   * 发送注册验证码
   */
  @Post('register/send-code')
  @HttpCode(HttpStatus.OK)
  async sendRegisterCode(@Body() dto: SendCodeDto): Promise<{ message: string }> {
    this.logger.log(`Send registration code request for: ${dto.email}`);
    await this.authService.sendCode(dto.email, 'register');
    return { message: '注册验证码已发送，请查收邮件' };
  }

  /**
   * 验证码登录
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    this.logger.log(`Login attempt for: ${dto.email}`);
    const { accessToken, user } = await this.authService.login(dto.email, dto.code);

    return this.toLoginResponse(accessToken, user);
  }

  /**
   * 密码登录
   */
  @Post('password-login')
  @HttpCode(HttpStatus.OK)
  async passwordLogin(@Body() dto: PasswordLoginDto): Promise<LoginResponse> {
    this.logger.log(`Password login attempt for: ${dto.email}`);
    const { accessToken, user } = await this.authService.passwordLogin(dto.email, dto.password);

    return this.toLoginResponse(accessToken, user);
  }

  /**
   * 注册
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto): Promise<LoginResponse> {
    this.logger.log(`Registration attempt for: ${dto.email}`);
    const { accessToken, user } = await this.authService.register(dto);

    return this.toLoginResponse(accessToken, user);
  }

  private toLoginResponse(accessToken: string, user: User): LoginResponse {
    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
    };

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
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
    };
  }
}
