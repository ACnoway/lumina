/**
 * API Client - 前端请求后端的 fetch 封装
 * 所有请求通过 Next.js rewrites 代理到后端，避免跨域
 */

import { getToken, clearAuth } from './auth';

const BASE_URL = '/api';

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 构建请求头，自动附加 Authorization
 */
function buildHeaders(custom?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...custom,
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: buildHeaders(headers),
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (!res.ok) {
    // 401 时自动清除认证信息
    if (res.status === 401) {
      clearAuth();
    }
    const error = await res.json().catch(() => ({ message: res.statusText })) as {
      message?: string | string[];
    };
    const message = Array.isArray(error.message)
      ? error.message.join('、')
      : error.message;
    throw new ApiError(message || `请求失败: ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: 'GET', headers }),

  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body, headers }),

  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PUT', body, headers }),

  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PATCH', body, headers }),

  delete: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: 'DELETE', headers }),

  /**
   * SSE 流式请求（用于聊天流式输出）
   * 返回 Response，调用方自行处理 stream
   */
  stream: async (
    path: string,
    body: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<Response> => {
    const token = getToken();
    return fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: options?.signal,
    });
  },
};
