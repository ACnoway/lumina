import { IsEmail, IsString, Length } from 'class-validator';

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
