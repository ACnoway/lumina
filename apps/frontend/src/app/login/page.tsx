'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { saveAuth } from '@/lib/auth';
import type { LoginResponse } from '@lumina/shared';
import {
  AuthField,
  AuthLayout,
  AuthMessage,
  VerificationCodeField,
  authInputClassName,
  authPrimaryButtonClassName,
} from '@/components/AuthLayout';

type LoginMode = 'password' | 'code';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError('');
    setInfo('');
  }

  function validateEmail(): boolean {
    if (!emailPattern.test(email.trim())) {
      setError('请输入有效的邮箱地址');
      return false;
    }
    return true;
  }

  async function handleSendCode(): Promise<boolean> {
    setError('');
    setInfo('');
    if (!validateEmail()) return false;

    setSendingCode(true);
    try {
      await apiClient.post('/auth/send-code', { email: email.trim() });
      setInfo('验证码已发送，请查收邮件');
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败');
      return false;
    } finally {
      setSendingCode(false);
    }
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');

    if (!validateEmail() || !password) {
      if (!password) setError('请输入邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/password-login', {
        email: email.trim(),
        password,
      });
      saveAuth(response);
      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeLogin(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');

    if (!validateEmail() || !/^\d{6}$/.test(code)) {
      if (!/^\d{6}$/.test(code)) setError('请输入6位验证码');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/login', {
        email: email.trim(),
        code,
      });
      saveAuth(response);
      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="登录"
      eyebrow="Welcome back"
      heading="进入 Lumina"
      description="登录后即可使用 AI 聊天与 AI 生图。"
      footer={(
        <p className="text-center text-sm text-gray-500">
          还没有账号？{' '}
          <Link href="/register" className="font-medium text-blue-600 transition hover:text-blue-700">
            立即注册
          </Link>
        </p>
      )}
    >
      <div className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          onClick={() => switchMode('password')}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            mode === 'password' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          密码登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'code'}
          onClick={() => switchMode('code')}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            mode === 'code' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          验证码登录
        </button>
      </div>

      {mode === 'password' ? (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <AuthField label="邮箱" htmlFor="login-email">
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="请输入邮箱"
              disabled={loading}
              className={authInputClassName}
            />
          </AuthField>

          <AuthField label="密码" htmlFor="login-password">
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              disabled={loading}
              className={authInputClassName}
            />
          </AuthField>

          <AuthMessage error={error} info={info} />

          <button type="submit" disabled={loading} className={authPrimaryButtonClassName}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCodeLogin} className="space-y-4">
          <AuthField label="邮箱" htmlFor="code-login-email">
            <input
              id="code-login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="请输入邮箱"
              disabled={loading || sendingCode}
              className={authInputClassName}
            />
          </AuthField>

          <VerificationCodeField
            value={code}
            onChange={setCode}
            onSend={handleSendCode}
            disabled={loading}
            sending={sendingCode}
          />

          <AuthMessage error={error} info={info} />

          <button type="submit" disabled={loading} className={authPrimaryButtonClassName}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
