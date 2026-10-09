import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, Matches } from 'class-validator';

export class SendCodeDto {
  @IsOptional()
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email?: string;

  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  phone?: string;

  @IsOptional()
  @IsString({ message: '账号必须是字符串' })
  account?: string;
}

export class LoginDto {
  @IsOptional()
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email?: string;

  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  phone?: string;

  @IsOptional()
  @IsString({ message: '账号必须是字符串' })
  account?: string;

  @IsString({ message: '验证码必须是字符串' })
  @Length(6, 6, { message: '验证码必须是6位数字' })
  @Matches(/^\d{6}$/, { message: '验证码必须是6位数字' })
  code!: string;
}

export class PasswordLoginDto {
  @IsOptional()
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email?: string;

  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  phone?: string;

  @IsOptional()
  @IsString({ message: '账号必须是字符串' })
  account?: string;

  @IsString({ message: '密码必须是字符串' })
  @Length(1, 72, { message: '密码长度不正确' })
  password!: string;
}

export class RegisterDto {
  @IsOptional()
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email?: string;

  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  phone?: string;

  @IsOptional()
  @IsIn(['email', 'sms'], { message: '验证方式不合法' })
  verificationMethod?: 'email' | 'sms';

  @IsString({ message: '验证码必须是字符串' })
  @Length(6, 6, { message: '验证码必须是6位数字' })
  @Matches(/^\d{6}$/, { message: '验证码必须是6位数字' })
  code!: string;

  @IsString({ message: '密码必须是字符串' })
  @Length(8, 72, { message: '密码长度必须为8到72位' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '密码至少需要包含字母和数字',
  })
  password!: string;

  @IsString({ message: '确认密码必须是字符串' })
  @Length(8, 72, { message: '确认密码长度必须为8到72位' })
  confirmPassword!: string;

  @IsOptional()
  @IsString({ message: '昵称必须是字符串' })
  @MaxLength(32, { message: '昵称不能超过32个字符' })
  nickname?: string;
}

export class BindPhoneSendCodeDto {
  @IsString({ message: '手机号必须是字符串' })
  phone!: string;
}

export class BindPhoneDto {
  @IsString({ message: '手机号必须是字符串' })
  phone!: string;

  @IsString({ message: '验证码必须是字符串' })
  @Length(6, 6, { message: '验证码必须是6位数字' })
  @Matches(/^\d{6}$/, { message: '验证码必须是6位数字' })
  code!: string;
}
