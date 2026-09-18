import { IsEmail, IsOptional, IsString, Length, MaxLength, Matches } from 'class-validator';

export class SendCodeDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;
}

export class LoginDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;

  @IsString({ message: '验证码必须是字符串' })
  @Length(6, 6, { message: '验证码必须是6位数字' })
  code!: string;
}

export class PasswordLoginDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;

  @IsString({ message: '密码必须是字符串' })
  @Length(1, 72, { message: '密码长度不正确' })
  password!: string;
}

export class RegisterDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;

  @IsString({ message: '验证码必须是字符串' })
  @Length(6, 6, { message: '验证码必须是6位数字' })
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
