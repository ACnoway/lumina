'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { saveAuth } from '@/lib/auth';
import type { LoginResponse } from '@lumina/shared';
import { AuthField, AuthLayout, AuthMessage, VerificationCodeField, authInputClassName, authPrimaryButtonClassName } from '@/components/AuthLayout';

type LoginMode = 'password' | 'code';
type CodeChannel = 'sms' | 'email';

function looksLikeAccount(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || /^\+?\d{7,15}$/.test(value.trim().replace(/[\s()-]/g, ''));
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('password');
  const [codeChannel, setCodeChannel] = useState<CodeChannel>('sms');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function validateAccount(): boolean {
    if (!looksLikeAccount(account)) { setError('请输入有效的邮箱或手机号'); return false; }
    return true;
  }

  function switchMode(next: LoginMode) { setMode(next); setError(''); setInfo(''); }

  async function handleSendCode(): Promise<boolean> {
    setError(''); setInfo('');
    if (!validateAccount()) return false;
    if (codeChannel === 'email' && !account.includes('@')) { setError('邮箱验证码登录请输入邮箱'); return false; }
    if (codeChannel === 'sms' && account.includes('@')) { setError('短信验证码登录请输入手机号'); return false; }
    setSendingCode(true);
    try {
      await apiClient.post('/auth/send-code', { account: account.trim() });
      setInfo(codeChannel === 'sms' ? '如果账号存在，验证码将发送到对应手机号' : '验证码已发送，请查收邮件');
      return true;
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '发送失败'); return false; }
    finally { setSendingCode(false); }
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault(); setError(''); setInfo('');
    if (!validateAccount() || !password) { if (!password) setError('请输入账号和密码'); return; }
    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/password-login', { account: account.trim(), password });
      saveAuth(response); router.replace('/');
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '登录失败'); }
    finally { setLoading(false); }
  }

  async function handleCodeLogin(event: React.FormEvent) {
    event.preventDefault(); setError(''); setInfo('');
    if (!validateAccount() || !/^\d{6}$/.test(code)) { if (!/^\d{6}$/.test(code)) setError('请输入6位数字验证码'); return; }
    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/login', { account: account.trim(), code });
      saveAuth(response); router.replace('/');
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '登录失败'); }
    finally { setLoading(false); }
  }

  return (
    <AuthLayout title="登录" eyebrow="Welcome back" heading="进入 Lumina" description="使用邮箱或手机号登录，继续使用 AI 聊天与 AI 生图。" footer={<p className="text-center text-sm text-gray-500">还没有账号？{' '}<Link href="/register" className="font-medium text-blue-600 transition hover:text-blue-700">立即注册</Link></p>}>
      <div className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="登录方式">
        {([['password', '账号密码登录'], ['code', '验证码登录']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => switchMode(value)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>)}
      </div>
      {mode === 'password' ? <form onSubmit={handlePasswordLogin} className="space-y-4">
        <AuthField label="账号（邮箱或手机号）" htmlFor="login-account"><input id="login-account" type="text" autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="请输入邮箱或手机号" disabled={loading} className={authInputClassName} /></AuthField>
        <AuthField label="密码" htmlFor="login-password"><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" disabled={loading} className={authInputClassName} /></AuthField>
        <AuthMessage error={error} info={info} /><button type="submit" disabled={loading} className={authPrimaryButtonClassName}>{loading ? '登录中...' : '登录'}</button>
      </form> : <form onSubmit={handleCodeLogin} className="space-y-4">
        <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1"><button type="button" onClick={() => setCodeChannel('sms')} className={`rounded-lg px-3 py-2 text-sm ${codeChannel === 'sms' ? 'bg-white font-medium text-blue-700 shadow-sm' : 'text-gray-500'}`}>短信验证码</button><button type="button" onClick={() => setCodeChannel('email')} className={`rounded-lg px-3 py-2 text-sm ${codeChannel === 'email' ? 'bg-white font-medium text-blue-700 shadow-sm' : 'text-gray-500'}`}>邮箱验证码</button></div>
        <AuthField label={codeChannel === 'sms' ? '手机号' : '邮箱'} htmlFor="code-login-account"><input id="code-login-account" type="text" autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder={codeChannel === 'sms' ? '请输入手机号' : '请输入邮箱'} disabled={loading || sendingCode} className={authInputClassName} /></AuthField>
        <VerificationCodeField value={code} onChange={setCode} onSend={handleSendCode} disabled={loading} sending={sendingCode} />
        <AuthMessage error={error} info={info} /><button type="submit" disabled={loading} className={authPrimaryButtonClassName}>{loading ? '登录中...' : '登录'}</button>
      </form>}
    </AuthLayout>
  );
}
