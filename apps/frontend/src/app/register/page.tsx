'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { saveAuth } from '@/lib/auth';
import type { LoginResponse } from '@lumina/shared';
import { AuthField, AuthLayout, AuthMessage, VerificationCodeField, authInputClassName, authPrimaryButtonClassName } from '@/components/AuthLayout';

type RegisterMethod = 'email' | 'sms';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?\d{7,15}$/;

export default function RegisterPage() {
  const router = useRouter();
  const [method, setMethod] = useState<RegisterMethod>('email');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function validatePrimary(): boolean {
    if (method === 'email' && !emailPattern.test(email.trim())) { setError('请输入有效的邮箱地址'); return false; }
    if (method === 'sms' && !phonePattern.test(phone.trim().replace(/[\s()-]/g, ''))) { setError('请输入有效的手机号'); return false; }
    return true;
  }

  function switchMethod(next: RegisterMethod) { setMethod(next); setError(''); setInfo(''); setCode(''); }

  async function handleSendCode(): Promise<boolean> {
    setError(''); setInfo(''); if (!validatePrimary()) return false;
    setSendingCode(true);
    try {
      await apiClient.post('/auth/register/send-code', method === 'email' ? { email: email.trim() } : { phone: phone.trim() });
      setInfo(method === 'email' ? '注册验证码已发送，请查收邮件' : '注册短信验证码已发送');
      return true;
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '发送失败'); return false; }
    finally { setSendingCode(false); }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault(); setError(''); setInfo('');
    if (!validatePrimary()) return;
    if (!/^\d{6}$/.test(code)) { setError('请输入6位数字验证码'); return; }
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('密码长度需为8-72位，且至少包含字母和数字'); return; }
    if (password !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/register', {
        nickname: nickname.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        verificationMethod: method,
        code,
        password,
        confirmPassword,
      });
      saveAuth(response); router.replace('/');
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '注册失败'); }
    finally { setLoading(false); }
  }

  return (
    <AuthLayout title="注册" eyebrow="Start with Lumina" heading="创建 Lumina 账号" description="默认使用邮箱验证码注册，也可以切换为手机号短信验证码。至少完成一种验证方式。" footer={<p className="text-center text-sm text-gray-500">已有账号？{' '}<Link href="/login" className="font-medium text-blue-600 transition hover:text-blue-700">返回登录</Link></p>}>
      <div className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100 p-1"><button type="button" onClick={() => switchMethod('email')} className={`rounded-lg px-3 py-2 text-sm ${method === 'email' ? 'bg-white font-medium text-blue-700 shadow-sm' : 'text-gray-500'}`}>邮箱验证码</button><button type="button" onClick={() => switchMethod('sms')} className={`rounded-lg px-3 py-2 text-sm ${method === 'sms' ? 'bg-white font-medium text-blue-700 shadow-sm' : 'text-gray-500'}`}>短信验证码</button></div>
      <form onSubmit={handleRegister} className="space-y-4">
        <AuthField label="昵称（可选）" htmlFor="register-nickname"><input id="register-nickname" type="text" autoComplete="nickname" maxLength={32} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="不填写也可以" disabled={loading || sendingCode} className={authInputClassName} /></AuthField>
        {method === 'email' ? <AuthField label="邮箱" htmlFor="register-email"><input id="register-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" disabled={loading || sendingCode} className={authInputClassName} /></AuthField> : <AuthField label="手机号" htmlFor="register-phone"><input id="register-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入手机号" disabled={loading || sendingCode} className={authInputClassName} /></AuthField>}
        {method === 'email' && <AuthField label="手机号（可选，后续可绑定验证）" htmlFor="register-phone-optional"><input id="register-phone-optional" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="可稍后在个人中心绑定" disabled={loading || sendingCode} className={authInputClassName} /></AuthField>}
        <VerificationCodeField value={code} onChange={setCode} onSend={handleSendCode} disabled={loading} sending={sendingCode} />
        <AuthField label="密码" htmlFor="register-password"><input id="register-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少8位，包含字母和数字" disabled={loading} className={authInputClassName} /></AuthField>
        <AuthField label="确认密码" htmlFor="register-confirm-password"><input id="register-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" disabled={loading} className={authInputClassName} /></AuthField>
        <AuthMessage error={error} info={info} /><button type="submit" disabled={loading} className={authPrimaryButtonClassName}>{loading ? '注册中...' : '注册并开始使用'}</button>
      </form>
    </AuthLayout>
  );
}
