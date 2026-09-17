'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { saveAuth } from '@/lib/auth';
import type { LoginResponse } from '@lumina/shared';
import AppHeader from '@/components/AppHeader';

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
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader
        title="登录"
        items={[]}
        showUserMenu={false}
        trailing={(
          <Link href="/" className="text-sm text-gray-500 transition hover:text-blue-600">
            返回首页
          </Link>
        )}
      />
      <div className="flex min-h-[calc(100vh-81px)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Welcome back</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">进入 Lumina</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">登录后即可使用 AI 聊天与 AI 生图。</p>
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
              className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
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
                className="block w-full rounded-xl border border-gray-300 px-3 py-3 text-sm tracking-widest outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0 || sendingCode || loading}
                className="whitespace-nowrap rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          新用户会自动注册并获得初始体验额度
        </p>
        </div>
      </div>
    </main>
  );
}
