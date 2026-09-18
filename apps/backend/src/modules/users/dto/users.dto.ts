import { IsString, Length, Matches } from 'class-validator';

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class ChangePasswordDto {
  @IsString()
  @Length(1, 72)
  currentPassword!: string;

  @IsString()
  @Length(8, 72)
  @Matches(passwordPattern, {
    message: '新密码至少包含一个字母和一个数字',
  })
  newPassword!: string;

  @IsString()
  @Length(8, 72)
  confirmPassword!: string;
}
