"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  GetCurrentUserResponse,
  PaymentChannelDto,
  PaymentMethod,
  PaymentOrderDto,
  PaymentScene,
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

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).+$/;

function formatBalance(value: number): string {
  return formatPhoton(value, 2);
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

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile) void loadPaymentChannels();
  }, [loadPaymentChannels, profile]);

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
                  余额将用于 AI 聊天和生图服务，可通过下方充值中心补充光子。
                </p>
              </div>
            </section>

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
                <ExtensionCard title="个性化设置" description="管理头像和其他个人偏好。" />
                <ExtensionCard title="更多充值方式" description="后续可继续扩展套餐、优惠券和账单导出。" />
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
