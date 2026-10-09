import { User } from '@prisma/client';
import { UserInfo } from '@lumina/shared';
import { maskPhone } from './phone.util';

export function toUserInfo(user: User): UserInfo {
  return {
    id: user.id,
    email: user.email,
    phone: maskPhone(user.phone),
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
  };
}
