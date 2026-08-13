'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { saveAuth } from '@/lib/auth';
import type { LoginResponse } from '@ailou/shared';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 倒计时逻辑
  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown]);

  // 发送验证码
  async function handleSendCode() {
    setError('');
    setInfo('');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }

    setSendingCode(true);
    try {
      await apiClient.post('/auth/send-code', { email });
      setInfo('验证码已发送，请查收邮件');
      setCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      setError(msg);
    } finally {
      setSendingCode(false);
    }
  }

  // 登录
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email || !code) {
      setError('请填写邮箱和验证码');
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', { email, code });
      saveAuth(res);
      router.push('/chat');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Ailou</h1>
          <p className="mt-1 text-sm text-gray-500">AI 聊天生图平台</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* 邮箱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              disabled={loading || sendingCode}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>

          {/* 验证码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700">验证码</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6位验证码"
                disabled={loading}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-widest focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0 || sendingCode || loading}
                className="whitespace-nowrap rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {countdown > 0 ? `${countdown}s` : sendingCode ? '发送中...' : '获取验证码'}
              </button>
            </div>
          </div>

          {/* 错误/提示信息 */}
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          {info && !error && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">
              {info}
            </div>
          )}

          {/* 登录按钮 */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-white font-medium hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          新用户会自动注册并获得初始体验额度
        </p>
      </div>
    </div>
  );
}
