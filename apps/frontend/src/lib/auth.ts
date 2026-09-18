/**
 * 认证状态管理 - 前端 JWT token 管理
 */

import { LoginResponse, UserInfo, GetCurrentUserResponse } from '@lumina/shared';

const TOKEN_KEY = 'lumina_token';
const USER_KEY = 'lumina_user';
const COOKIE_KEY = 'lumina_token';
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600;

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getCookieValue(key: string): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const prefix = `${encodeURIComponent(key)}=`;
    const cookie = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));

    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

function saveTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;

  try {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // Cookie storage may also be unavailable in restricted browser contexts.
  }
}

function clearTokenCookie(): void {
  if (typeof document === 'undefined') return;

  try {
    document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Clearing auth is best effort and must not throw.
  }
}

/**
 * 获取存储的 token
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;

  const storage = getLocalStorage();
  if (storage) {
    try {
      const token = storage.getItem(TOKEN_KEY);
      if (token) return token;
    } catch {
      // Fall back to the cookie when localStorage is unavailable.
    }
  }

  return getCookieValue(COOKIE_KEY);
}

/**
 * 获取存储的用户信息
 */
export function getStoredUser(): UserInfo | null {
  if (typeof window === 'undefined') return null;

  const storage = getLocalStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(USER_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
}

/**
 * 保存认证信息（cookie + localStorage）
 */
export function saveAuth(response: LoginResponse): void {
  // 先写入 cookie，供 middleware 和 localStorage 不可用时的 API 请求读取。
  saveTokenCookie(response.accessToken);

  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(TOKEN_KEY, response.accessToken);
  } catch {
    // localStorage may be blocked or full; cookie auth remains valid.
  }

  try {
    storage.setItem(USER_KEY, JSON.stringify(response.user));
  } catch {
    // User cache is optional and must not block navigation after login.
  }
}

/**
 * 清除认证信息（登出）
 */
export function clearAuth(): void {
  const storage = getLocalStorage();
  if (storage) {
    try {
      storage.removeItem(TOKEN_KEY);
    } catch {
      // Continue clearing the remaining auth state.
    }

    try {
      storage.removeItem(USER_KEY);
    } catch {
      // Continue clearing the cookie.
    }
  }

  clearTokenCookie();
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
