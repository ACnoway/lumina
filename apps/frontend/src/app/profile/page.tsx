"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GetCurrentUserResponse } from "@lumina/shared";
import AppHeader from "@/components/AppHeader";
import { fetchCurrentUser } from "@/lib/auth";

function formatBalance(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function roleLabel(role: GetCurrentUserResponse["user"]["role"]): string {
  if (role === "SUPER_ADMIN") return "超级管理员";
  if (role === "ADMIN") return "管理员";
  return "普通用户";
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-gray-700">{value}</p>
    </div>
  );
}

function ExtensionCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-gray-700">{title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-400 ring-1 ring-gray-100">
          即将支持
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-gray-400">{description}</p>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<GetCurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = await fetchCurrentUser();
      if (!current) {
        router.replace("/login");
        return;
      }
      setProfile(current);
    } catch {
      setError("个人信息加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader title="个人中心" active="profile" />

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {loading && (
          <>
            <div className="h-44 animate-pulse rounded-2xl bg-gray-200" />
            <div className="h-64 animate-pulse rounded-2xl bg-gray-200" />
          </>
        )}

        {!loading && error && (
          <section className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-700"
            >
              重新加载
            </button>
          </section>
        )}

        {!loading && !error && profile && (
          <>
            <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-6 shadow-sm sm:p-8">
              <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-blue-100/70 blur-3xl" />
              <div className="relative">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Wallet
                </p>
                <p className="mt-4 text-sm text-gray-500">当前可用余额</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight text-gray-950">
                  {formatBalance(profile.wallet.balance)}
                </p>
                <p className="mt-3 text-sm text-gray-400">
                  余额将用于 AI 聊天和生图服务，后续可在此扩展充值与账单功能。
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Account
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">账户信息</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem label="邮箱" value={profile.user.email} />
                <InfoItem label="昵称" value={profile.user.nickname || "未设置"} />
                <InfoItem label="账户角色" value={roleLabel(profile.user.role)} />
                <InfoItem label="钱包编号" value={profile.wallet.id || "未创建"} />
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  More
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">更多功能</h2>
                <p className="mt-2 text-sm text-gray-400">
                  个人中心预留了扩展区域，后续可以继续加入账户和消费相关能力。
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <ExtensionCard title="消费记录" description="查看余额变动、聊天和生图消费明细。" />
                <ExtensionCard title="账户设置" description="管理昵称、头像和其他个人偏好。" />
                <ExtensionCard title="充值中心" description="支持更多余额充值方式和套餐。" />
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
