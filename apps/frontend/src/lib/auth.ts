/**
 * 认证状态管理 - 前端 JWT token 管理
 */

import { LoginResponse, UserInfo, GetCurrentUserResponse } from '@ailou/shared';

const TOKEN_KEY = 'ailou_token';
const USER_KEY = 'ailou_user';
const COOKIE_KEY = 'ailou_token';

/**
 * 获取存储的 token
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 获取存储的用户信息
 */
export function getStoredUser(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
}

/**
 * 保存认证信息（localStorage + cookie）
 */
export function saveAuth(response: LoginResponse): void {
  localStorage.setItem(TOKEN_KEY, response.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  // 同步写入 cookie，供 middleware 读取
  document.cookie = `${COOKIE_KEY}=${response.accessToken}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax`;
}

/**
 * 清除认证信息（登出）
 */
export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0`;
}

/**
 * 是否已登录
 */
export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * 登出并跳转到登录页
 */
export function logout(): void {
  clearAuth();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

/**
 * 获取当前用户信息（从后端拉取）
 */
export async function fetchCurrentUser(): Promise<GetCurrentUserResponse | null> {
  const token = getToken();
  if (!token) return null;

  const res = await fetch('/api/users/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
    }
    return null;
  }

  return res.json() as Promise<GetCurrentUserResponse>;
}
