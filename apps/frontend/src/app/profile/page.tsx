"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  GetTransactionsResponse,
  GetCurrentUserResponse,
  PaymentChannelDto,
  PaymentMethod,
  PaymentOrderDto,
  PaymentScene,
  TransactionItem,
  TransactionType,
} from "@lumina/shared";
import AppHeader from "@/components/AppHeader";
import {
  AuthField,
  AuthMessage,
  authInputClassName,
  authPrimaryButtonClassName,
} from "@/components/AuthLayout";
import { apiClient } from "@/lib/api-client";
import { fetchCurrentUser } from "@/lib/auth";
import { formatPhoton } from "@/lib/model-pricing";
import { paymentsApi } from "@/lib/payments-api";
import { walletApi } from "@/lib/wallet-api";

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).+$/;

const profileTabs = [
  {
    id: "overview",
    label: "账户概览",
    icon: "overview",
    eyebrow: "Overview",
    description: "集中查看账号状态，常用操作一键进入。",
  },
  {
    id: "wallet",
    label: "充值与钱包",
    icon: "wallet",
    eyebrow: "Wallet",
    description: "管理光子余额和充值订单，后续可继续扩展账单能力。",
  },
  {
    id: "security",
    label: "安全设置",
    icon: "security",
    eyebrow: "Security",
    description: "集中处理密码和后续的登录安全能力。",
  },
  {
    id: "usage",
    label: "账单",
    icon: "usage",
    eyebrow: "Usage",
    description: "查看充值、消费和其他余额变化。",
  },
  {
    id: "preferences",
    label: "个性化设置",
    icon: "preferences",
    eyebrow: "Preferences",
    description: "为昵称、头像和其他个人偏好保留稳定位置。",
  },
] as const;

type ProfileTab = (typeof profileTabs)[number]["id"];
type ProfileIconName = (typeof profileTabs)[number]["icon"] | "arrow-right";

function isProfileTab(value: string | null): value is ProfileTab {
  return profileTabs.some((tab) => tab.id === value);
}

function ProfileIcon({
  name,
  className = "h-4 w-4",
}: {
  name: ProfileIconName;
  className?: string;
}) {
  const paths: Record<ProfileIconName, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v3H7a3 3 0 0 0 0 6h13v5a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5z" />
        <path d="M7 8h13v6H7a3 3 0 0 1 0-6Z" />
        <path d="M16 11h.01" />
      </>
    ),
    security: (
      <>
        <path d="M12 3 20 6v5c0 5.1-3.4 8.7-8 10-4.6-1.3-8-4.9-8-10V6z" />
        <path d="m8.5 12 2.2 2.2 4.8-4.8" />
      </>
    ),
    usage: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    preferences: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <path d="M8 4v4M16 10v4M11 16v4" />
      </>
    ),
    "arrow-right": <path d="M5 12h14m-6-6 6 6-6 6" />,
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function formatBalance(value: number): string {
  return formatPhoton(value, 2);
}

const transactionTypeLabels: Record<TransactionType, string> = {
  RECHARGE: "充值",
  CONSUME: "消费",
  REFUND: "退款",
  ADMIN_ADJUST: "管理员调整",
};

type TransactionFilter = "ALL" | TransactionType;

const transactionFilters: Array<{ value: TransactionFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "RECHARGE", label: "充值" },
  { value: "CONSUME", label: "消费" },
  { value: "REFUND", label: "退款" },
  { value: "ADMIN_ADJUST", label: "管理员调整" },
];

function formatTransactionDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getDisplayedTransactionAmount(transaction: TransactionItem): number {
  if (transaction.type === "CONSUME") return -Math.abs(transaction.amount);
  return transaction.amount;
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

function EmptyFeatureState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center sm:p-12">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-xl text-gray-300">
        ···
      </div>
      <h3 className="mt-4 font-medium text-gray-700">{title}即将支持</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-400">{description}</p>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<GetCurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordInfo, setPasswordInfo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ALIPAY");
  const [paymentScene, setPaymentScene] = useState<PaymentScene>("QR");
  const [paymentAmount, setPaymentAmount] = useState("10.00");
  const [paymentChannels, setPaymentChannels] = useState<PaymentChannelDto[]>([]);
  const [selectedPaymentChannelId, setSelectedPaymentChannelId] = useState("");
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderDto | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [transactions, setTransactions] = useState<GetTransactionsResponse | null>(null);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("ALL");
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");

  const loadPaymentChannels = useCallback(async () => {
    setPaymentError("");
    try {
      const channels = await paymentsApi.getChannels(paymentMethod, paymentScene);
      setPaymentChannels(channels);
      setSelectedPaymentChannelId((current) =>
        channels.some((channel) => channel.id === current) ? current : channels[0]?.id || "",
      );
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "支付渠道加载失败");
    }
  }, [paymentMethod, paymentScene]);

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

  const loadTransactions = useCallback(async () => {
    if (!profile || activeTab !== "usage") return;

    setTransactionsLoading(true);
    setTransactionsError("");
    try {
      const response = await walletApi.getTransactions({
        page: transactionPage,
        limit: 10,
        type: transactionFilter === "ALL" ? undefined : transactionFilter,
      });
      setTransactions(response);
    } catch (err: unknown) {
      setTransactionsError(err instanceof Error ? err.message : "账单加载失败，请稍后重试");
    } finally {
      setTransactionsLoading(false);
    }
  }, [activeTab, profile, transactionFilter, transactionPage]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile) void loadPaymentChannels();
  }, [loadPaymentChannels, profile]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!paymentOrder || paymentOrder.status !== "PENDING") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const current = await paymentsApi.syncOrder(paymentOrder.orderNo);
        if (cancelled) return;
        setPaymentOrder(current);
        if (current.status === "SUCCEEDED") {
          window.clearInterval(timer);
          await loadProfile();
        }
      } catch {
        // The next polling attempt can recover a transient request failure.
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadProfile, paymentOrder]);

  useEffect(() => {
    const syncTabFromUrl = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      setActiveTab(isProfileTab(tab) ? tab : "overview");
    };

    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  function handleTabChange(tab: ProfileTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    router.replace(`/profile?${params.toString()}`, { scroll: false });
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordInfo("");

    if (!currentPassword) {
      setPasswordError("请输入当前密码");
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 72 || !passwordPattern.test(newPassword)) {
      setPasswordError("新密码长度需为8-72位，且至少包含一个字母和一个数字");
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setPasswordLoading(true);
    try {
      await apiClient.patch<{ message: string }>("/users/me/password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordInfo("密码修改成功，请妥善保管新密码");
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "密码修改失败，请稍后重试");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentError("");
    setPaymentOrder(null);
    if (!selectedPaymentChannelId) {
      setPaymentError("请选择支付渠道");
      return;
    }
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(paymentAmount) || Number(paymentAmount) < 0.01) {
      setPaymentError("请输入有效的充值金额，最低 0.01 元");
      return;
    }
    setPaymentLoading(true);
    try {
      const order = await paymentsApi.createOrder(
        {
          amount: paymentAmount,
          paymentMethod,
          scene: paymentScene,
          channelId: selectedPaymentChannelId,
        },
        crypto.randomUUID(),
      );
      setPaymentOrder(order);
      if (order.action?.type === "REDIRECT_URL" && order.action.url) {
        window.location.assign(order.action.url);
      } else if (order.action?.type === "HTML_FORM" && order.action.html) {
        const popup = window.open("", "_blank");
        if (popup) {
          popup.document.write(order.action.html);
          popup.document.close();
        } else {
          setPaymentError("浏览器拦截了支付窗口，请允许弹窗后重试");
        }
      }
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "创建支付订单失败");
    } finally {
      setPaymentLoading(false);
    }
  }

  const activeTabInfo = profileTabs.find((tab) => tab.id === activeTab) ?? profileTabs[0];

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader title="个人中心" active="profile" />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {loading && (
          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="h-72 animate-pulse rounded-2xl bg-gray-200" />
            <div className="space-y-6">
              <div className="h-44 animate-pulse rounded-2xl bg-gray-200" />
              <div className="h-64 animate-pulse rounded-2xl bg-gray-200" />
            </div>
          </div>
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
          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden h-fit rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                Account center
              </p>
              <div className="mt-4 border-b border-gray-100 pb-4">
                <p className="truncate text-sm font-medium text-gray-700">{profile.user.email}</p>
                <p className="mt-1 text-xs text-gray-400">{roleLabel(profile.user.role)}</p>
              </div>
              <nav className="mt-4 space-y-1" aria-label="个人中心分组导航">
                {profileTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={activeTab === tab.id ? "page" : undefined}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                      activeTab === tab.id
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-500 hover:bg-gray-50 hover:text-blue-700"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProfileIcon name={tab.icon} className="h-4 w-4 shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </span>
                    {tab.id === "preferences" && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400">
                        规划中
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 space-y-6">
              <nav
                className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm sm:grid-cols-3 lg:hidden"
                aria-label="个人中心分组导航"
              >
                {profileTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={activeTab === tab.id ? "page" : undefined}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                      activeTab === tab.id
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-500 hover:bg-gray-50 hover:text-blue-700"
                    }`}
                  >
                    <ProfileIcon name={tab.icon} className="h-4 w-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>

              <header>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  {activeTabInfo.eyebrow}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{activeTabInfo.label}</h2>
                <p className="mt-2 text-sm text-gray-400">{activeTabInfo.description}</p>
              </header>

            {activeTab === "overview" && (
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
                  余额将用于 AI 聊天和生图服务，可通过下方充值中心补充光子。
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleTabChange("wallet")}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2"
                  >
                    去充值
                    <ProfileIcon name="arrow-right" className="h-4 w-4" />
                  </button>
                  <span className="text-xs text-gray-400">进入充值与钱包</span>
                </div>
              </div>
            </section>
              </>
            )}

            {activeTab === "wallet" && (
              <>
            <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Recharge
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">充值中心</h2>
                <p className="mt-2 text-sm text-gray-400">
                  请选择支付方式、场景和具体渠道。支付成功以服务端回调或订单同步结果为准。
                </p>
              </div>
              <form onSubmit={handleCreatePayment} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-xs text-gray-500">
                    <span className="block font-medium text-gray-700">支付方式</span>
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                      disabled={paymentLoading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <option value="ALIPAY">支付宝</option>
                      <option value="WECHAT">微信支付</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-500">
                    <span className="block font-medium text-gray-700">支付场景</span>
                    <select
                      value={paymentScene}
                      onChange={(event) => setPaymentScene(event.target.value as PaymentScene)}
                      disabled={paymentLoading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <option value="QR">二维码</option>
                      <option value="WEB">电脑网站</option>
                      <option value="H5">H5</option>
                      {paymentMethod === "WECHAT" && <option value="JSAPI">公众号/小程序</option>}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-500">
                    <span className="block font-medium text-gray-700">充值金额（人民币）</span>
                    <input
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      inputMode="decimal"
                      placeholder="10.00"
                      disabled={paymentLoading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-700">选择具体支付渠道</p>
                  {paymentChannels.length === 0 ? (
                    <p className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-400">
                      当前支付方式和场景暂无可用渠道，请联系管理员配置。
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {paymentChannels.map((channel) => (
                        <label
                          key={channel.id}
                          className={`cursor-pointer rounded-xl border p-4 transition ${selectedPaymentChannelId === channel.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}
                        >
                          <input
                            type="radio"
                            name="payment-channel"
                            value={channel.id}
                            checked={selectedPaymentChannelId === channel.id}
                            onChange={() => setSelectedPaymentChannelId(channel.id)}
                            className="sr-only"
                          />
                          <p className="font-medium text-gray-800">{channel.name}</p>
                          <p className="mt-1 text-xs text-gray-400">{channel.type}</p>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {paymentError && <p className="text-sm text-red-600">{paymentError}</p>}
                {paymentOrder?.action?.type === "QR_CODE" && paymentOrder.action.content && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
                    <p className="font-medium text-blue-800">请使用对应 App 扫描或打开以下支付地址</p>
                    <a className="mt-2 block break-all text-xs text-blue-600 underline" href={paymentOrder.action.content} target="_blank" rel="noreferrer">
                      {paymentOrder.action.content}
                    </a>
                  </div>
                )}
                {paymentOrder && (
                  <p className="text-sm text-gray-500">
                    订单 {paymentOrder.orderNo} · 状态：{paymentOrder.status === "SUCCEEDED" ? "支付成功" : paymentOrder.status === "PENDING" ? "等待支付" : paymentOrder.status}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={paymentLoading || paymentChannels.length === 0}
                  className={authPrimaryButtonClassName}
                >
                  {paymentLoading ? "创建订单中…" : "创建充值订单"}
                </button>
              </form>
            </section>
              </>
            )}

            {activeTab === "overview" && (
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
            )}

            {activeTab === "security" && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Security
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">修改密码</h2>
                <p className="mt-2 text-sm text-gray-400">
                  修改密码前需要验证当前密码，新密码需包含字母和数字。
                </p>
              </div>

              <form onSubmit={handleChangePassword} className="max-w-2xl space-y-4">
                <AuthField label="当前密码" htmlFor="current-password">
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="请输入当前密码"
                    disabled={passwordLoading}
                    className={authInputClassName}
                  />
                </AuthField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <AuthField label="新密码" htmlFor="new-password">
                    <input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="8-72位，含字母和数字"
                      disabled={passwordLoading}
                      className={authInputClassName}
                    />
                  </AuthField>

                  <AuthField label="确认新密码" htmlFor="confirm-password">
                    <input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="请再次输入新密码"
                      disabled={passwordLoading}
                      className={authInputClassName}
                    />
                  </AuthField>
                </div>

                <AuthMessage error={passwordError} info={passwordInfo} />

                <button type="submit" disabled={passwordLoading} className={authPrimaryButtonClassName}>
                  {passwordLoading ? "保存中..." : "保存新密码"}
                </button>
              </form>
            </section>
            )}

            {activeTab === "usage" && (
              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                      Billing
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">账单</h2>
                    <p className="mt-2 text-sm text-gray-400">
                      查看充值、消费、退款和管理员调整带来的全部余额变化。
                    </p>
                  </div>
                  <div className="rounded-xl bg-blue-50 px-4 py-3 text-right">
                    <p className="text-xs text-blue-500">当前余额</p>
                    <p className="mt-1 text-lg font-semibold text-blue-700">
                      {formatBalance(profile.wallet.balance)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2" aria-label="账单类型筛选">
                  {transactionFilters.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => {
                        setTransactionFilter(filter.value);
                        setTransactionPage(1);
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${
                        transactionFilter === filter.value
                          ? "bg-blue-600 font-medium text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-700"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                {transactionsLoading ? (
                  <div className="mt-5 space-y-3">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-20 animate-pulse rounded-xl bg-gray-100" />
                    ))}
                  </div>
                ) : transactionsError ? (
                  <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="text-sm text-red-600">{transactionsError}</p>
                    <button
                      type="button"
                      onClick={() => void loadTransactions()}
                      className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      重新加载
                    </button>
                  </div>
                ) : transactions?.items.length ? (
                  <>
                    <div className="mt-5 space-y-3">
                      {transactions.items.map((transaction) => {
                        const displayedAmount = getDisplayedTransactionAmount(transaction);
                        const amountPrefix = displayedAmount > 0 ? "+" : "";
                        const amountColor = displayedAmount < 0 ? "text-red-600" : "text-emerald-600";

                        return (
                          <article
                            key={transaction.id}
                            className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="font-medium text-gray-700">
                                  {transactionTypeLabels[transaction.type]}
                                </p>
                                <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                                  {transaction.reason}
                                </p>
                              </div>
                              <p className={`shrink-0 text-base font-semibold ${amountColor}`}>
                                {amountPrefix}{formatBalance(Math.abs(displayedAmount))}
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-gray-400">
                              余额 {formatBalance(transaction.balance)} · {formatTransactionDate(transaction.createdAt)}
                            </p>
                          </article>
                        );
                      })}
                    </div>

                    {transactions.totalPages > 1 && (
                      <div className="mt-5 flex items-center justify-between gap-3 text-sm text-gray-500">
                        <span>
                          第 {transactions.page} / {transactions.totalPages} 页
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={transactions.page <= 1}
                            onClick={() => setTransactionPage((page) => Math.max(1, page - 1))}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            上一页
                          </button>
                          <button
                            type="button"
                            disabled={transactions.page >= transactions.totalPages}
                            onClick={() => setTransactionPage((page) => page + 1)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            下一页
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-5 rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
                    <p className="text-sm font-medium text-gray-500">暂无账单记录</p>
                    <p className="mt-1 text-xs text-gray-400">充值或使用服务后，余额变化会显示在这里。</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === "preferences" && (
              <EmptyFeatureState
                title="个性化设置"
                description="后续可在这里管理昵称、头像和其他个人偏好。"
              />
            )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
