"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  GetTransactionsResponse,
  GetPaymentOrdersResponse,
  GetTransactionDetailResponse,
  GetCurrentUserResponse,
  CurrencySettingsDto,
  PaymentMethod,
  PaymentOrderDto,
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
import { formatPhoton, formatPhotonTruncated } from "@/lib/model-pricing";
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

function formatBillAmount(value: number): string {
  return formatPhotonTruncated(value, 4);
}

function formatCny(value: number | null): string {
  return value === null ? "暂无" : `¥${value.toFixed(2)}`;
}

function formatCount(value: number | null): string {
  return value === null ? "暂无" : value.toLocaleString("zh-CN");
}

function paymentStatusLabel(value: string | null): string {
  const labels: Record<string, string> = {
    CREATED: "待创建",
    PENDING: "待支付",
    SUCCEEDED: "支付成功",
    FAILED: "支付失败",
    CLOSED: "已关闭",
    EXPIRED: "已过期",
    REFUNDED: "已退款",
  };
  return value ? labels[value] || value : "暂无";
}

function paymentMethodLabel(value: PaymentMethod): string {
  return value === "ALIPAY" ? "支付宝" : "微信支付";
}

function formatPaymentOrderAmount(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : `¥${value}`;
}

function isPayablePaymentOrder(order: PaymentOrderDto): boolean {
  return order.status === "CREATED" || order.status === "PENDING";
}

function closePaymentWindow(paymentWindow: Window | null): void {
  try {
    if (paymentWindow && !paymentWindow.closed) paymentWindow.close();
  } catch {
    // A navigation race must not hide the original payment error.
  }
}

function openPaymentWindow(): Window | null {
  const paymentWindow = window.open("", "_blank");
  if (!paymentWindow) return null;

  try {
    // The external payment document must not be able to navigate the still
    // authenticated profile page through window.opener.
    paymentWindow.opener = null;
    paymentWindow.document.title = "Lumina 支付";
    if (paymentWindow.document.body) {
      paymentWindow.document.body.textContent = "正在准备支付…";
    }
    paymentWindow.focus();
  } catch {
    // The window can still receive a redirect or HTML form below.
  }
  return paymentWindow;
}

function showQrPaymentAction(paymentWindow: Window, content: string): void {
  const paymentDocument = paymentWindow.document;
  paymentDocument.open();
  paymentDocument.write("<!doctype html><html><head><title>Lumina 支付</title></head><body></body></html>");
  paymentDocument.close();

  const heading = paymentDocument.createElement("h1");
  heading.textContent = "请使用对应 App 扫描支付码";
  const code = paymentDocument.createElement("code");
  // QR actions are legacy fallback only. Render their opaque content as text
  // rather than making an untrusted custom URL executable in this same-origin
  // helper page.
  code.textContent = content;
  code.style.display = "block";
  code.style.marginTop = "16px";
  code.style.overflowWrap = "anywhere";
  paymentDocument.body.replaceChildren(heading, code);
}

type PaymentFormPayload = {
  action: string;
  method: "get" | "post";
  fields: Array<{ name: string; value: string }>;
};

function safePaymentUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Provider HTML must never be written into the same-origin blank payment
 * window. Parse it inertly, retain only an HTTPS GET/POST form and hidden
 * fields, then rebuild it with DOM APIs below.
 */
function parsePaymentForm(html: string): PaymentFormPayload {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const forms = Array.from(parsedDocument.querySelectorAll("form"));
  if (forms.length !== 1) throw new Error("支付渠道返回的表单不合法");

  const sourceForm = forms[0];
  const action = safePaymentUrl(sourceForm.getAttribute("action") ?? "");
  if (!action) throw new Error("支付渠道返回的表单地址不安全");

  const method = (sourceForm.getAttribute("method") ?? "get").toLowerCase();
  if (method !== "get" && method !== "post") {
    throw new Error("支付渠道返回的表单方法不支持");
  }

  const fields = Array.from(sourceForm.querySelectorAll("input")).flatMap((input) => {
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    if (type !== "hidden") return [];
    const name = input.getAttribute("name");
    if (!name) {
      throw new Error("支付渠道返回的表单字段不安全");
    }
    return [{ name, value: input.getAttribute("value") ?? "" }];
  });
  if (fields.length > 200) throw new Error("支付渠道返回的表单字段过多");

  return { action, method, fields };
}

function submitPaymentForm(paymentWindow: Window, html: string): void {
  const payload = parsePaymentForm(html);
  const paymentDocument = paymentWindow.document;
  paymentDocument.open();
  paymentDocument.write("<!doctype html><html><head><title>Lumina 支付</title></head><body></body></html>");
  paymentDocument.close();
  if (!paymentDocument.body) throw new Error("无法打开支付窗口");

  const form = paymentDocument.createElement("form");
  form.action = payload.action;
  form.method = payload.method;
  form.target = "_self";
  form.setAttribute("referrerpolicy", "no-referrer");
  for (const field of payload.fields) {
    const input = paymentDocument.createElement("input");
    input.type = "hidden";
    input.name = field.name;
    input.value = field.value;
    form.append(input);
  }
  paymentDocument.body.append(form);
  // An untrusted field name such as `submit` must not shadow this call.
  HTMLFormElement.prototype.submit.call(form);
}

function sendPaymentActionToWindow(
  paymentWindow: Window,
  action: PaymentOrderDto["action"],
): void {
  if (action?.type === "REDIRECT_URL" && action.url) {
    const url = safePaymentUrl(action.url);
    if (!url) throw new Error("支付渠道返回的跳转地址不安全");
    paymentWindow.location.assign(url);
    return;
  }

  if (action?.type === "HTML_FORM" && action.html) {
    submitPaymentForm(paymentWindow, action.html);
    return;
  }

  if (action?.type === "QR_CODE" && action.content) {
    showQrPaymentAction(paymentWindow, action.content);
    return;
  }

  throw new Error("支付渠道未返回可用的跳转支付动作");
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

function getTransactionDisplay(transaction: TransactionItem): {
  amount: number;
  prefix: "+" | "-";
  colorClass: string;
} {
  if (transaction.type === "CONSUME") {
    return { amount: Math.abs(transaction.amount), prefix: "-", colorClass: "text-red-600" };
  }

  if (transaction.type === "RECHARGE" || transaction.type === "REFUND") {
    return { amount: Math.abs(transaction.amount), prefix: "+", colorClass: "text-emerald-600" };
  }

  const isDeduction = transaction.amount < 0;
  return {
    amount: Math.abs(transaction.amount),
    prefix: isDeduction ? "-" : "+",
    colorClass: isDeduction ? "text-red-600" : "text-emerald-600",
  };
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-gray-700">{value}</p>
    </div>
  );
}

function TransactionDetailView({ detail }: { detail: GetTransactionDetailResponse }) {
  if (detail.kind === "CHAT" || detail.kind === "PROMPT_OPTIMIZATION") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <DetailItem label="使用模型" value={detail.model || "未知模型"} />
        <DetailItem label="输入 Token" value={formatCount(detail.inputTokens)} />
        <DetailItem label="输出 Token" value={formatCount(detail.outputTokens)} />
        <DetailItem label="总 Token" value={formatCount(detail.totalTokens)} />
        {detail.sessionId && <DetailItem label="会话编号" value={detail.sessionId} />}
        {detail.messageId && <DetailItem label="消息编号" value={detail.messageId} />}
      </div>
    );
  }

  if (detail.kind === "IMAGE") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <DetailItem label="使用模型" value={detail.model || "未知模型"} />
        <DetailItem label="本次任务张数" value={formatCount(detail.requestedImageCount)} />
        <DetailItem label="本笔计费张数" value={formatCount(detail.chargedImageCount)} />
        <DetailItem label="单张价格" value={detail.perImageCost === null ? "暂无" : `${formatBillAmount(detail.perImageCost)} 光子`} />
        <DetailItem label="本笔消耗" value={`${formatBillAmount(detail.amount)} 光子`} />
        <DetailItem label="任务总消耗" value={detail.taskCost === null ? "暂无" : `${formatBillAmount(detail.taskCost)} 光子`} />
        {detail.taskId && <DetailItem label="任务编号" value={detail.taskId} />}
        {detail.imageId && <DetailItem label="图片编号" value={detail.imageId} />}
        {detail.sequence !== null && <DetailItem label="图片序号" value={String(detail.sequence + 1)} />}
      </div>
    );
  }

  if (detail.kind === "RECHARGE") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <DetailItem label="实付人民币" value={formatCny(detail.paidAmountCny)} />
        <DetailItem label="下单金额" value={formatCny(detail.orderAmountCny)} />
        <DetailItem label="充值汇率" value={detail.exchangeRate === null ? "暂无" : `1 人民币 = ${detail.exchangeRate} 光子`} />
        <DetailItem label="实际到账光子" value={`${formatBillAmount(detail.creditedPhotonAmount)} 光子`} />
        <DetailItem label="支付方式" value={detail.paymentMethod === "ALIPAY" ? "支付宝" : detail.paymentMethod === "WECHAT" ? "微信支付" : "未知"} />
        <DetailItem label="支付渠道" value={detail.channelName || "暂无"} />
        <DetailItem label="Lumina 订单号" value={detail.orderNo || "暂无"} />
        <DetailItem label="支付平台订单号" value={detail.providerTradeNo || "暂无"} />
        <DetailItem label="支付状态" value={paymentStatusLabel(detail.status)} />
        <DetailItem label="支付时间" value={detail.paidAt ? formatTransactionDate(detail.paidAt) : "暂无"} />
      </div>
    );
  }

  return <p className="text-sm text-gray-500">暂无可展示的附加详情。</p>;
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
  const [paymentAmount, setPaymentAmount] = useState("10.00");
  const [currencySettings, setCurrencySettings] = useState<CurrencySettingsDto | null>(null);
  const [rechargeSettingsLoading, setRechargeSettingsLoading] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderDto | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [pendingOrders, setPendingOrders] = useState<GetPaymentOrdersResponse | null>(null);
  const [pendingOrdersLoading, setPendingOrdersLoading] = useState(false);
  const [pendingOrdersError, setPendingOrdersError] = useState("");
  const [resumingOrderNo, setResumingOrderNo] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState("");
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [transactions, setTransactions] = useState<GetTransactionsResponse | null>(null);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("ALL");
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [transactionDetail, setTransactionDetail] = useState<GetTransactionDetailResponse | null>(null);
  const [transactionDetailId, setTransactionDetailId] = useState<string | null>(null);
  const [transactionDetailLoading, setTransactionDetailLoading] = useState(false);
  const [transactionDetailError, setTransactionDetailError] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [phoneInfo, setPhoneInfo] = useState("");

  const loadRechargeSettings = useCallback(async () => {
    setRechargeSettingsLoading(true);
    setPaymentError("");
    try {
      const settings = await paymentsApi.getRechargeSettings();
      setCurrencySettings(settings);
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "充值汇率加载失败，请稍后重试");
    } finally {
      setRechargeSettingsLoading(false);
    }
  }, []);

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

  const loadTransactions = useCallback(async (force = false) => {
    if (!profile || (!force && activeTab !== "usage")) return;

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

  const loadPendingOrders = useCallback(async () => {
    if (!profile) return;

    setPendingOrdersLoading(true);
    setPendingOrdersError("");
    try {
      setPendingOrders(await paymentsApi.listPendingOrders());
    } catch (err: unknown) {
      setPendingOrdersError(err instanceof Error ? err.message : "待支付订单加载失败，请稍后重试");
    } finally {
      setPendingOrdersLoading(false);
    }
  }, [profile]);

  async function handleTransactionDetail(id: string) {
    if (transactionDetailId === id) {
      setTransactionDetailId(null);
      setTransactionDetail(null);
      setTransactionDetailError("");
      return;
    }

    setTransactionDetailId(id);
    setTransactionDetail(null);
    setTransactionDetailError("");
    setTransactionDetailLoading(true);
    try {
      setTransactionDetail(await walletApi.getTransactionDetail(id));
    } catch (err: unknown) {
      setTransactionDetailError(err instanceof Error ? err.message : "账单详情加载失败，请稍后重试");
    } finally {
      setTransactionDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile) void loadRechargeSettings();
  }, [loadRechargeSettings, profile]);

  useEffect(() => {
    if (profile) void loadPendingOrders();
  }, [loadPendingOrders, profile]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!paymentOrder || !isPayablePaymentOrder(paymentOrder)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        // The browser only observes the order. Wallet crediting is performed
        // by the backend after a verified callback; an automatic client-side
        // sync must never be the trigger for a balance change.
        const current = await paymentsApi.getOrder(paymentOrder.orderNo);
        if (cancelled) return;
        setPaymentOrder(current);
        if (current.status === "SUCCEEDED") {
          window.clearInterval(timer);
          await Promise.all([loadProfile(), loadPendingOrders(), loadTransactions(true)]);
        }
      } catch {
        // The next polling attempt can recover a transient request failure.
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadPendingOrders, loadProfile, loadTransactions, paymentOrder]);

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

  async function handleSendPhoneCode() {
    setPhoneError("");
    setPhoneInfo("");
    if (!/^\+?\d{7,15}$/.test(phoneDraft.trim().replace(/[\s()-]/g, ""))) {
      setPhoneError("请输入有效的手机号");
      return;
    }
    setPhoneSending(true);
    try {
      await apiClient.post("/auth/phone/send-code", { phone: phoneDraft.trim() });
      setPhoneInfo("绑定短信验证码已发送");
    } catch (err: unknown) {
      setPhoneError(err instanceof Error ? err.message : "验证码发送失败");
    } finally {
      setPhoneSending(false);
    }
  }

  async function handleBindPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhoneError("");
    setPhoneInfo("");
    if (!/^\d{6}$/.test(phoneCode)) {
      setPhoneError("请输入6位数字验证码");
      return;
    }
    setPhoneLoading(true);
    try {
      const user = await apiClient.patch<GetCurrentUserResponse["user"]>("/auth/me/phone", {
        phone: phoneDraft.trim(),
        code: phoneCode,
      });
      setProfile((current) => current ? { ...current, user } : current);
      setPhoneDraft("");
      setPhoneCode("");
      setPhoneInfo("手机号绑定成功");
    } catch (err: unknown) {
      setPhoneError(err instanceof Error ? err.message : "手机号绑定失败");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentError("");
    setResumeError("");
    setPaymentOrder(null);
    if (!currencySettings) {
      setPaymentError("充值汇率加载中，请稍后重试");
      return;
    }
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(paymentAmount) || Number(paymentAmount) < 0.1) {
      setPaymentError("请输入有效的充值金额，最低 0.1 元");
      return;
    }

    // This must happen before the first await so browsers retain the user
    // gesture and do not block the payment tab as a popup.
    const paymentWindow = openPaymentWindow();
    if (!paymentWindow) {
      setPaymentError("浏览器拦截了支付窗口，请允许弹窗后重试");
      return;
    }

    setPaymentLoading(true);
    try {
      const order = await paymentsApi.createOrder(
        {
          amount: paymentAmount,
          paymentMethod,
        },
        crypto.randomUUID(),
      );
      setPaymentOrder(order);
      sendPaymentActionToWindow(paymentWindow, order.action);
    } catch (err: unknown) {
      closePaymentWindow(paymentWindow);
      setPaymentError(err instanceof Error ? err.message : "创建支付订单失败");
    } finally {
      setPaymentLoading(false);
      void loadPendingOrders();
    }
  }

  async function handleResumePayment(orderNo: string) {
    setResumeError("");

    // As with creation, open the blank tab synchronously inside the click
    // handler before awaiting the API response.
    const paymentWindow = openPaymentWindow();
    if (!paymentWindow) {
      setResumeError("浏览器拦截了支付窗口，请允许弹窗后重试");
      return;
    }

    setResumingOrderNo(orderNo);
    try {
      const order = await paymentsApi.resumeOrder(orderNo);
      setPaymentOrder(order);
      sendPaymentActionToWindow(paymentWindow, order.action);
    } catch (err: unknown) {
      closePaymentWindow(paymentWindow);
      setResumeError(err instanceof Error ? err.message : "恢复支付失败，请稍后重试");
    } finally {
      setResumingOrderNo(null);
      void loadPendingOrders();
    }
  }

  const activeTabInfo = profileTabs.find((tab) => tab.id === activeTab) ?? profileTabs[0];
  const latestPendingOrder = pendingOrders?.items[0] ?? null;
  const paymentAmountNumber = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(paymentAmount)
    ? Number(paymentAmount)
    : null;
  const estimatedPhotonAmount = currencySettings && paymentAmountNumber !== null
    ? paymentAmountNumber * currencySettings.photonPerCny
    : null;

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
                <p className="truncate text-sm font-medium text-gray-700">{profile.user.email || profile.user.phone || "未绑定账号"}</p>
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
            {pendingOrdersLoading ? (
              <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
                <div className="h-5 w-36 animate-pulse rounded bg-amber-50" />
                <div className="mt-3 h-4 w-60 animate-pulse rounded bg-gray-100" />
              </section>
            ) : pendingOrdersError ? (
              <section className="rounded-2xl border border-red-100 bg-red-50 p-5">
                <p className="text-sm text-red-600">待支付订单加载失败：{pendingOrdersError}</p>
                <button
                  type="button"
                  onClick={() => void loadPendingOrders()}
                  className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  重新加载
                </button>
              </section>
            ) : latestPendingOrder ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Pending payment</p>
                    <h3 className="mt-1 text-lg font-semibold text-amber-950">有待支付的充值订单</h3>
                    <p className="mt-2 text-sm text-amber-800">
                      共 {pendingOrders?.total ?? 0} 笔待支付订单，最近一笔为 {formatPaymentOrderAmount(latestPendingOrder.amount)}。
                    </p>
                    {latestPendingOrder.expireAt && (
                      <p className="mt-1 text-xs text-amber-700">
                        请在 {formatTransactionDate(latestPendingOrder.expireAt)} 前完成支付。
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleTabChange("usage")}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                    >
                      查看账单
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResumePayment(latestPendingOrder.orderNo)}
                      disabled={resumingOrderNo !== null || !isPayablePaymentOrder(latestPendingOrder)}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resumingOrderNo === latestPendingOrder.orderNo ? "正在打开…" : "去支付"}
                    </button>
                  </div>
                </div>
                {resumeError && <p className="mt-3 text-sm text-red-600">{resumeError}</p>}
              </section>
            ) : null}
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
                  选择支付方式并填写充值金额，支付成功以服务端回调或订单同步结果为准。
                </p>
              </div>
              <form onSubmit={handleCreatePayment} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
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
                    <span className="block font-medium text-gray-700">充值金额（人民币）</span>
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      inputMode="decimal"
                      min="0.1"
                      step="0.01"
                      placeholder="10.00"
                      disabled={paymentLoading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  {currencySettings
                    ? `当前汇率：1 人民币 = ${currencySettings.photonPerCny} 光子`
                    : rechargeSettingsLoading
                      ? "正在加载充值汇率…"
                      : "充值汇率暂时不可用"}
                </p>
                <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-700">订单确认</p>
                    <p className="text-xs text-gray-400">创建后将在新标签页打开支付页面</p>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <InfoItem label="当前光子余额" value={formatBillAmount(profile.wallet.balance)} />
                    <InfoItem label="本次充值金额" value={paymentAmountNumber === null ? "请输入金额" : formatPaymentOrderAmount(paymentAmount)} />
                    <InfoItem label="支付方式" value={paymentMethodLabel(paymentMethod)} />
                    <InfoItem label="预计到账光子" value={estimatedPhotonAmount === null ? "等待汇率或金额" : formatBillAmount(estimatedPhotonAmount)} />
                    <InfoItem
                      label="充值后预计余额"
                      value={estimatedPhotonAmount === null ? "等待汇率或金额" : formatBillAmount(profile.wallet.balance + estimatedPhotonAmount)}
                    />
                    <InfoItem label="支付有效期" value="创建后约 30 分钟，以订单提示为准" />
                  </div>
                </section>
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
                  <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-500">
                    <p>订单 {paymentOrder.orderNo} · 状态：{paymentStatusLabel(paymentOrder.status)}</p>
                    {paymentOrder.expireAt && (
                      <p className="mt-1 text-xs text-gray-400">
                        请在 {formatTransactionDate(paymentOrder.expireAt)} 前完成支付。
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={paymentLoading || rechargeSettingsLoading || !currencySettings}
                  className={authPrimaryButtonClassName}
                >
                  {paymentLoading ? "创建订单中…" : rechargeSettingsLoading ? "加载配置中…" : "创建充值订单"}
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
                <InfoItem label="邮箱" value={profile.user.email || "未绑定"} />
                <InfoItem label="手机号" value={profile.user.phone || "未绑定"} />
                <InfoItem label="昵称" value={profile.user.nickname || "未设置"} />
                <InfoItem label="账户角色" value={roleLabel(profile.user.role)} />
                <InfoItem label="钱包编号" value={profile.wallet.id || "未创建"} />
              </div>
              <div className="mt-6 border-t border-gray-100 pt-5">
                <h3 className="font-medium text-gray-800">绑定或更换手机号</h3>
                <p className="mt-1 text-sm text-gray-400">绑定后可以使用手机号密码或短信验证码登录，页面只展示脱敏手机号。</p>
                <form onSubmit={handleBindPhone} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input type="tel" value={phoneDraft} onChange={(event) => setPhoneDraft(event.target.value)} placeholder="手机号" disabled={phoneLoading || phoneSending} className={authInputClassName} />
                  <input type="text" inputMode="numeric" maxLength={6} value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} placeholder="短信验证码" disabled={phoneLoading} className={authInputClassName} />
                  <button type="button" onClick={() => void handleSendPhoneCode()} disabled={phoneLoading || phoneSending} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">{phoneSending ? "发送中…" : "发送验证码"}</button>
                  <button type="submit" disabled={phoneLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:col-span-3">{phoneLoading ? "保存中…" : "保存手机号"}</button>
                </form>
                <AuthMessage error={phoneError} info={phoneInfo} />
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
                      {formatBillAmount(profile.wallet.balance)}
                    </p>
                  </div>
                </div>

                {resumeError && (
                  <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="text-sm text-red-600">{resumeError}</p>
                  </div>
                )}

                {pendingOrdersLoading ? (
                  <div className="mt-5 space-y-3">
                    {[1, 2].map((item) => (
                      <div key={item} className="h-32 animate-pulse rounded-xl bg-amber-50" />
                    ))}
                  </div>
                ) : pendingOrdersError ? (
                  <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="text-sm text-red-600">待支付订单加载失败：{pendingOrdersError}</p>
                    <button
                      type="button"
                      onClick={() => void loadPendingOrders()}
                      className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      重新加载
                    </button>
                  </div>
                ) : pendingOrders?.items.length ? (
                  <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-amber-950">待支付充值订单</p>
                        <p className="mt-1 text-xs text-amber-800">支付成功后会生成实际到账流水，不会在这里重复显示为余额变化。</p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                        {pendingOrders.total} 笔待支付
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {pendingOrders.items.map((order) => (
                        <article key={order.orderNo} className="rounded-xl border border-amber-100 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800">
                                {formatPaymentOrderAmount(order.amount)} · 预计到账 {formatBillAmount(Number(order.photonAmount))}
                              </p>
                              <p className="mt-1 text-sm text-gray-500">
                                {paymentMethodLabel(order.paymentMethod)} · {order.channel.name}
                              </p>
                            </div>
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                              {paymentStatusLabel(order.status)}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-1 text-xs text-gray-400 sm:grid-cols-2">
                            <p>创建时间：{formatTransactionDate(order.createdAt)}</p>
                            <p>{order.expireAt ? `过期时间：${formatTransactionDate(order.expireAt)}` : "支付有效期以渠道为准"}</p>
                            <p className="break-all sm:col-span-2">Lumina 订单号：{order.orderNo}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleResumePayment(order.orderNo)}
                            disabled={resumingOrderNo !== null || !isPayablePaymentOrder(order)}
                            className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {resumingOrderNo === order.orderNo ? "正在打开支付页面…" : "去支付"}
                          </button>
                        </article>
                      ))}
                    </div>
                    {pendingOrders.total > pendingOrders.items.length && (
                      <p className="mt-3 text-xs text-amber-700">当前展示最近 {pendingOrders.items.length} 笔订单。</p>
                    )}
                  </section>
                ) : null}

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
                        const display = getTransactionDisplay(transaction);

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
                              <p className={`shrink-0 text-base font-semibold ${display.colorClass}`}>
                                {display.prefix}{formatBillAmount(display.amount)}
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-gray-400">
                              余额 {formatBillAmount(transaction.balance)} · {formatTransactionDate(transaction.createdAt)}
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleTransactionDetail(transaction.id)}
                              className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {transactionDetailId === transaction.id ? "收起详情" : "查看详情"}
                            </button>
                            {transactionDetailId === transaction.id && (
                              <div className="mt-3 border-t border-gray-200 pt-3">
                                {transactionDetailLoading ? (
                                  <p className="text-sm text-gray-400">正在加载详情…</p>
                                ) : transactionDetailError ? (
                                  <p className="text-sm text-red-600">{transactionDetailError}</p>
                                ) : transactionDetail ? (
                                  <TransactionDetailView detail={transactionDetail} />
                                ) : null}
                              </div>
                            )}
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
