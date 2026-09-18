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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

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
      await apiClient.post('/auth/register/send-code', { email: email.trim() });
      setInfo('注册验证码已发送，请查收邮件');
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败');
      return false;
    } finally {
      setSendingCode(false);
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');

    if (!validateEmail()) return;
    if (!/^\d{6}$/.test(code)) {
      setError('请输入6位验证码');
      return;
    }
    if (password.length < 8 || password.length > 72) {
      setError('密码长度必须为8到72位');
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('密码至少需要包含字母和数字');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/register', {
        nickname: nickname.trim() || undefined,
        email: email.trim(),
        code,
        password,
        confirmPassword,
      });
      saveAuth(response);
      router.push('/chat');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="注册"
      eyebrow="Start with Lumina"
      heading="创建 Lumina 账号"
      description="验证邮箱后即可获得初始体验额度，开始使用 AI 聊天与 AI 生图。"
      footer={(
        <p className="text-center text-sm text-gray-500">
          已有账号？{' '}
          <Link href="/login" className="font-medium text-blue-600 transition hover:text-blue-700">
            返回登录
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleRegister} className="space-y-4">
        <AuthField label="昵称（可选）" htmlFor="register-nickname">
          <input
            id="register-nickname"
            type="text"
            autoComplete="nickname"
            maxLength={32}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="不填写也可以"
            disabled={loading || sendingCode}
            className={authInputClassName}
          />
        </AuthField>

        <AuthField label="邮箱" htmlFor="register-email">
          <input
            id="register-email"
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

        <AuthField label="密码" htmlFor="register-password">
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少8位，包含字母和数字"
            disabled={loading}
            className={authInputClassName}
          />
        </AuthField>

        <AuthField label="确认密码" htmlFor="register-confirm-password">
          <input
            id="register-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="再次输入密码"
            disabled={loading}
            className={authInputClassName}
          />
        </AuthField>

        <AuthMessage error={error} info={info} />

        <button type="submit" disabled={loading} className={authPrimaryButtonClassName}>
          {loading ? '注册中...' : '注册并开始使用'}
        </button>
      </form>
    </AuthLayout>
  );
}
