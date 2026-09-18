'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';

interface AuthLayoutProps {
  title: string;
  eyebrow: string;
  heading: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({
  title,
  eyebrow,
  heading,
  description,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader
        title={title}
        items={[]}
        showUserMenu={false}
        trailing={(
          <Link href="/" className="text-sm text-gray-500 transition hover:text-blue-600">
            返回首页
          </Link>
        )}
      />
      <div className="flex min-h-[calc(100vh-81px)] items-center justify-center px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              {eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">
              {heading}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">{description}</p>
          </div>
          {children}
          {footer && <div className="mt-6 border-t border-gray-100 pt-5">{footer}</div>}
        </section>
      </div>
    </main>
  );
}

interface AuthFieldProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}

export function AuthField({ label, htmlFor, children }: AuthFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

interface AuthMessageProps {
  error?: string;
  info?: string;
}

export function AuthMessage({ error, info }: AuthMessageProps) {
  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-600">
        {error}
      </div>
    );
  }

  if (info) {
    return (
      <div role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm leading-5 text-green-600">
        {info}
      </div>
    );
  }

  return null;
}

interface VerificationCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => Promise<boolean>;
  disabled?: boolean;
  sending?: boolean;
}

export function VerificationCodeField({
  value,
  onChange,
  onSend,
  disabled = false,
  sending = false,
}: VerificationCodeFieldProps) {
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;

    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function handleSend() {
    const sent = await onSend();
    if (sent) setCountdown(60);
  }

  return (
    <AuthField label="邮件验证码" htmlFor="verification-code">
      <div className="flex gap-2">
        <input
          id="verification-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          placeholder="6位验证码"
          disabled={disabled}
          className="block min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-3 text-sm tracking-widest outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={countdown > 0 || sending || disabled}
          className="whitespace-nowrap rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {countdown > 0 ? `${countdown}s` : sending ? '发送中...' : '获取验证码'}
        </button>
      </div>
    </AuthField>
  );
}

export const authInputClassName =
  'block w-full rounded-xl border border-gray-300 px-3 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50';

export const authPrimaryButtonClassName =
  'w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
