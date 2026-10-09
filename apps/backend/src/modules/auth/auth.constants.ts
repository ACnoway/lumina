export type AuthCodePurpose = 'login' | 'register' | 'bind';

export const VERIFICATION_CODE_TTL_SECONDS = 300;
export const SEND_COOLDOWN_TTL_SECONDS = 60;
export const PHONE_RATE_LIMIT_TTL_SECONDS = 3600;
export const PHONE_RATE_LIMIT = 10;
export const IP_RATE_LIMIT_TTL_SECONDS = 3600;
export const IP_RATE_LIMIT = 30;

export function getEmailCodeKey(email: string, purpose: AuthCodePurpose): string {
  return `auth:code:${purpose}:${email}`;
}

export function getEmailCooldownKey(email: string, purpose: AuthCodePurpose): string {
  return `auth:code:cooldown:${purpose}:${email}`;
}

export function getSmsCodeKey(phone: string, purpose: AuthCodePurpose): string {
  return `auth:sms:code:${purpose}:${phone}`;
}

export function getSmsCooldownKey(phone: string, purpose: AuthCodePurpose): string {
  return `auth:sms:cooldown:${purpose}:${phone}`;
}

export function getSmsPhoneRateKey(phone: string): string {
  return `auth:sms:rate:phone:${phone}`;
}

export function getSmsIpRateKey(ip: string): string {
  return `auth:sms:rate:ip:${ip}`;
}
