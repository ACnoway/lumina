"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  AdminOverviewResponse,
  AdminUserDto,
  ApiFormat,
  AuditLogDto,
  ModelType,
  PlatformModelDto,
  ProviderDto,
  UpstreamModelDto,
  UserRole,
  UserStatus,
} from "@lumina/shared";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api-client";
import { fetchCurrentUser } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";

const PAGE_SIZE = 20;
const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN"];
const API_FORMATS: Array<{ value: ApiFormat; label: string }> = [
  { value: "openai_chat", label: "OpenAI Chat" },
  { value: "openai_compatible", label: "OpenAI 兼容" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
  { value: "openai_image", label: "OpenAI Images" },
  { value: "stability_image", label: "Stability Image" },
];

const PROVIDER_DEFAULTS: Record<
  ApiFormat,
  { baseUrl: string; timeout: string }
> = {
  openai_chat: {
    baseUrl: "https://api.openai.com/v1",
    timeout: "30000",
  },
  openai_compatible: {
    baseUrl: "https://api.openai.com/v1",
    timeout: "30000",
  },
  anthropic_messages: {
    baseUrl: "https://api.anthropic.com/v1",
    timeout: "30000",
  },
  openai_image: {
    baseUrl: "https://api.openai.com/v1",
    timeout: "60000",
  },
  stability_image: {
    baseUrl: "https://api.stability.ai",
    timeout: "120000",
  },
};

type Tab = "overview" | "users" | "config" | "audit";
type AccessState = "checking" | "allowed" | "forbidden" | "expired";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function formatPrice(value: number): string {
  return Number.isFinite(value)
    ? value.toFixed(4).replace(/\.?(0+)$/, "")
    : "—";
}

function formatModelPricing(model: PlatformModelDto): string {
  if (model.type === "CHAT") {
    return `输入 ¥${formatPrice(model.pricing.input)} / 千 token · 输出 ¥${formatPrice(model.pricing.output)} / 千 token`;
  }
  return `¥${formatPrice(model.pricing.perImage)} / 张`;
}

function formatProviderConfig(provider: ProviderDto): string {
  const config = provider.config;
  const baseUrl =
    typeof config.baseUrl === "string" && config.baseUrl.trim()
      ? config.baseUrl
      : "默认地址";
  const timeout = Number.isSafeInteger(config.timeout)
    ? `${config.timeout}ms`
    : "默认超时";
  const rateLimit = Number.isSafeInteger(config.rateLimit)
    ? `${config.rateLimit} 次/分钟`
    : "默认限流";
  return `${baseUrl} · 超时 ${timeout} · ${rateLimit}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已过期，请重新登录";
    if (error.status === 403) return "当前账号没有管理权限";
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label}必须是合法的 JSON 对象`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function parseNonNegativePrice(value: string, label: string): number {
  if (!value.trim()) {
    throw new Error(`${label}不能为空`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}必须是大于等于 0 的有限数字`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!value.trim()) {
    throw new Error(`${label}不能为空`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label}必须是大于 0 的整数`);
  }
  return parsed;
}

function parseHttpUrl(value: string, label: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error(`${label}必须是有效的 HTTP(S) 地址`);
  }
  return trimmed;
}

function statusLabel(status: UserStatus): string {
  if (status === "ACTIVE") return "正常";
  if (status === "SUSPENDED") return "已暂停";
  return "已删除";
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Pagination({
  page,
  total,
  limit,
  label,
  onPageChange,
}: {
  page: number;
  total: number;
  limit: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;

  return (
    <nav
      aria-label={`${label}分页`}
      className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4"
    >
      <span className="text-xs text-gray-400">
        第 {page} / {totalPages} 页，共 {total} 条
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </nav>
  );
}

export default function AdminPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [actor, setActor] = useState<{ email: string; role: UserRole } | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userSearchDraft, setUserSearchDraft] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState<UserStatus | "">("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserDto | null>(null);
  const [transactions, setTransactions] = useState<Awaited<
    ReturnType<typeof adminApi.getUserTransactions>
  > | null>(null);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [mutatingUserId, setMutatingUserId] = useState("");

  const [models, setModels] = useState<PlatformModelDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [upstreams, setUpstreams] = useState<UpstreamModelDto[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingUpstreams, setLoadingUpstreams] = useState(false);
  const [mutatingResource, setMutatingResource] = useState("");
  const [showModelForm, setShowModelForm] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [showUpstreamForm, setShowUpstreamForm] = useState(false);
  const [modelForm, setModelForm] = useState({
    name: "",
    displayName: "",
    type: "CHAT" as ModelType,
    pricing: {
      input: "0.001",
      output: "0.002",
      perImage: "0.50",
    },
    maxTokens: "",
    isActive: true,
  });
  const [providerForm, setProviderForm] = useState({
    name: "",
    apiFormat: "openai_chat" as ApiFormat,
    supportsStreaming: true,
    config: {
      apiKey: "",
      baseUrl: PROVIDER_DEFAULTS.openai_chat.baseUrl,
      timeout: PROVIDER_DEFAULTS.openai_chat.timeout,
      rateLimit: "60",
    },
    isActive: true,
  });
  const [upstreamForm, setUpstreamForm] = useState({
    providerId: "",
    upstreamModelId: "",
    priority: "1",
    weight: "1",
    upstreamPricing: "",
    maxTokens: "",
    isActive: true,
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogDto[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditDraft, setAuditDraft] = useState({
    userId: "",
    action: "",
    resource: "",
  });
  const [auditFilters, setAuditFilters] = useState({
    userId: "",
    action: "",
    resource: "",
  });
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      setOverview(await adminApi.getOverview());
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载管理概览失败"));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const result = await adminApi.getUsers({
        page: userPage,
        limit: PAGE_SIZE,
        search: userSearch,
        status: userStatus,
      });
      setUsers(result.items);
      setUserTotal(result.total);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载用户失败"));
    } finally {
      setLoadingUsers(false);
    }
  }, [userPage, userSearch, userStatus]);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const [nextModels, nextProviders] = await Promise.all([
        adminApi.getModels(),
        adminApi.getProviders(),
      ]);
      setModels(nextModels);
      setProviders(nextProviders);
      setSelectedModelId((current) =>
        nextModels.some((model) => model.id === current)
          ? current
          : (nextModels[0]?.id ?? ""),
      );
      setUpstreamForm((current) => ({
        ...current,
        providerId: current.providerId || nextProviders[0]?.id || "",
      }));
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载模型与供应商配置失败"));
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const loadUpstreams = useCallback(async () => {
    if (!selectedModelId) {
      setUpstreams([]);
      return;
    }
    setLoadingUpstreams(true);
    try {
      setUpstreams(await adminApi.getUpstreams(selectedModelId));
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载上游映射失败"));
    } finally {
      setLoadingUpstreams(false);
    }
  }, [selectedModelId]);

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const result = await adminApi.getAuditLogs({
        page: auditPage,
        limit: PAGE_SIZE,
        ...auditFilters,
      });
      setAuditLogs(result.items);
      setAuditTotal(result.total);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载审计日志失败"));
    } finally {
      setLoadingAudit(false);
    }
  }, [auditFilters, auditPage]);

  useEffect(() => {
    let cancelled = false;
    async function verifyAccess() {
      const current = await fetchCurrentUser();
      if (cancelled) return;
      if (!current) {
        setAccessState("expired");
        return;
      }
      setActor({ email: current.user.email, role: current.user.role });
      setAccessState(
        ADMIN_ROLES.includes(current.user.role) ? "allowed" : "forbidden",
      );
    }
    void verifyAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (accessState === "allowed") void loadOverview();
  }, [accessState, loadOverview]);

  useEffect(() => {
    if (accessState === "allowed" && tab === "users") void loadUsers();
  }, [accessState, loadUsers, tab]);

  useEffect(() => {
    if (accessState === "allowed" && tab === "config") void loadConfig();
  }, [accessState, loadConfig, tab]);

  useEffect(() => {
    if (accessState === "allowed" && tab === "config") void loadUpstreams();
  }, [accessState, loadUpstreams, tab]);

  useEffect(() => {
    if (accessState === "allowed" && tab === "audit") void loadAudit();
  }, [accessState, loadAudit, tab]);

  async function selectUser(user: AdminUserDto) {
    setSelectedUser(user);
    setTransactions(null);
    setAdjustmentAmount("");
    setAdjustmentReason("");
    setLoadingTransactions(true);
    try {
      setTransactions(await adminApi.getUserTransactions(user.id));
    } catch (loadError) {
      setError(getErrorMessage(loadError, "加载用户账本失败"));
    } finally {
      setLoadingTransactions(false);
    }
  }

  async function updateUserStatus(user: AdminUserDto, status: UserStatus) {
    setMutatingUserId(user.id);
    try {
      const updated = await adminApi.updateUserStatus(user.id, status);
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedUser((current) =>
        current?.id === updated.id ? updated : current,
      );
      setNotice(`已将 ${updated.email} 设为“${statusLabel(status)}”`);
    } catch (updateError) {
      setError(getErrorMessage(updateError, "更新用户状态失败"));
    } finally {
      setMutatingUserId("");
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("调整金额必须是非零数字");
      return;
    }
    if (!adjustmentReason.trim()) {
      setError("请填写调整原因");
      return;
    }
    setMutatingUserId(selectedUser.id);
    try {
      await adminApi.adjustUserBalance(
        selectedUser.id,
        amount,
        adjustmentReason.trim(),
      );
      setNotice("余额已调整，操作已写入审计日志");
      setAdjustmentAmount("");
      setAdjustmentReason("");
      await Promise.all([
        loadOverview(),
        loadUsers(),
        selectUser(selectedUser),
      ]);
    } catch (adjustError) {
      setError(getErrorMessage(adjustError, "调整余额失败"));
    } finally {
      setMutatingUserId("");
    }
  }

  async function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutatingResource("model-form");
    try {
      const maxTokens =
        modelForm.type === "CHAT" && modelForm.maxTokens
          ? Number(modelForm.maxTokens)
          : undefined;
      if (!modelForm.name.trim() || !modelForm.displayName.trim()) {
        throw new Error("请填写模型名称和展示名称");
      }
      if (
        maxTokens !== undefined &&
        (!Number.isInteger(maxTokens) || maxTokens < 1)
      ) {
        throw new Error("最大 Token 必须是大于 0 的整数");
      }
      const pricing =
        modelForm.type === "CHAT"
          ? {
              input: parseNonNegativePrice(modelForm.pricing.input, "输入价格"),
              output: parseNonNegativePrice(
                modelForm.pricing.output,
                "输出价格",
              ),
            }
          : {
              perImage: parseNonNegativePrice(
                modelForm.pricing.perImage,
                "生图价格",
              ),
            };
      await adminApi.createModel({
        name: modelForm.name.trim(),
        displayName: modelForm.displayName.trim(),
        type: modelForm.type,
        pricing,
        maxTokens,
        isActive: modelForm.isActive,
      });
      setNotice("平台模型已创建");
      setShowModelForm(false);
      setModelForm((current) => ({ ...current, name: "", displayName: "" }));
      await loadConfig();
    } catch (formError) {
      setError(getErrorMessage(formError, "创建模型失败"));
    } finally {
      setMutatingResource("");
    }
  }

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutatingResource("provider-form");
    try {
      if (!providerForm.name.trim()) throw new Error("请填写供应商名称");
      if (!providerForm.config.apiKey.trim()) {
        throw new Error("请填写供应商 API Key");
      }
      const baseUrl = parseHttpUrl(providerForm.config.baseUrl, "Base URL");
      const timeout = parsePositiveInteger(
        providerForm.config.timeout,
        "请求超时",
      );
      const rateLimit = parsePositiveInteger(
        providerForm.config.rateLimit,
        "限流",
      );
      await adminApi.createProvider({
        name: providerForm.name.trim(),
        apiFormat: providerForm.apiFormat,
        supportsStreaming: providerForm.supportsStreaming,
        config: {
          apiKey: providerForm.config.apiKey.trim(),
          baseUrl,
          timeout,
          rateLimit,
        },
        isActive: providerForm.isActive,
      });
      setNotice("供应商已创建");
      setShowProviderForm(false);
      setProviderForm({ ...providerForm, name: "" });
      await loadConfig();
    } catch (formError) {
      setError(getErrorMessage(formError, "创建供应商失败"));
    } finally {
      setMutatingResource("");
    }
  }

  async function submitUpstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedModelId) return;
    setMutatingResource("upstream-form");
    try {
      const priority = Number(upstreamForm.priority);
      const weight = Number(upstreamForm.weight);
      const maxTokens = upstreamForm.maxTokens
        ? Number(upstreamForm.maxTokens)
        : undefined;
      if (!upstreamForm.providerId || !upstreamForm.upstreamModelId.trim()) {
        throw new Error("请选择供应商并填写上游模型名");
      }
      if (!Number.isInteger(priority) || priority < 0)
        throw new Error("优先级必须是非负整数");
      if (!Number.isInteger(weight) || weight < 1)
        throw new Error("权重必须是大于 0 的整数");
      if (
        maxTokens !== undefined &&
        (!Number.isInteger(maxTokens) || maxTokens < 1)
      ) {
        throw new Error("最大 Token 必须是大于 0 的整数");
      }
      await adminApi.createUpstream(selectedModelId, {
        providerId: upstreamForm.providerId,
        upstreamModelId: upstreamForm.upstreamModelId.trim(),
        priority,
        weight,
        upstreamPricing: upstreamForm.upstreamPricing.trim()
          ? parseObject(upstreamForm.upstreamPricing, "上游计费规则")
          : undefined,
        maxTokens,
        isActive: upstreamForm.isActive,
      });
      setNotice("上游映射已创建");
      setShowUpstreamForm(false);
      setUpstreamForm((current) => ({ ...current, upstreamModelId: "" }));
      await loadUpstreams();
    } catch (formError) {
      setError(getErrorMessage(formError, "创建上游映射失败"));
    } finally {
      setMutatingResource("");
    }
  }

  async function toggleResource(
    type: "model" | "provider" | "upstream",
    resource: PlatformModelDto | ProviderDto | UpstreamModelDto,
  ) {
    const key = `${type}-${resource.id}`;
    setMutatingResource(key);
    try {
      if (type === "model")
        await adminApi.updateModel(resource.id, {
          isActive: !resource.isActive,
        });
      if (type === "provider")
        await adminApi.updateProvider(resource.id, {
          isActive: !resource.isActive,
        });
      if (type === "upstream")
        await adminApi.updateUpstream(resource.id, {
          isActive: !resource.isActive,
        });
      setNotice(
        `${type === "model" ? "模型" : type === "provider" ? "供应商" : "上游映射"}已${resource.isActive ? "停用" : "启用"}`,
      );
      if (type === "upstream") await loadUpstreams();
      else await loadConfig();
    } catch (toggleError) {
      setError(getErrorMessage(toggleError, "更新状态失败"));
    } finally {
      setMutatingResource("");
    }
  }

  function submitUserFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserPage(1);
    setUserSearch(userSearchDraft.trim());
  }

  function submitAuditFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuditPage(1);
    setAuditFilters({
      userId: auditDraft.userId.trim(),
      action: auditDraft.action.trim(),
      resource: auditDraft.resource.trim(),
    });
  }

  if (accessState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] text-sm text-gray-500">
        正在确认管理权限…
      </main>
    );
  }
  if (accessState === "expired") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-4">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">登录已过期</h1>
          <p className="mt-2 text-sm text-gray-500">
            请重新登录后再访问管理后台。
          </p>
          <Link
            href="/login?from=%2Fadmin"
            className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            前往登录
          </Link>
        </div>
      </main>
    );
  }
  if (accessState === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">
            Access denied
          </p>
          <h1 className="mt-2 text-xl font-semibold">当前账号没有管理权限</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            服务端会再次验证角色，普通用户不能读取或修改管理数据。
          </p>
          <Link
            href="/chat"
            className="mt-6 inline-flex rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700"
          >
            返回聊天
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader
        title="管理后台"
        maxWidth="7xl"
        trailing={(
          <span className="hidden rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 sm:inline">
            {actor?.role}
          </span>
        )}
      />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          {(
            [
              ["overview", "概览"],
              ["users", "用户与余额"],
              ["config", "模型与供应商"],
              ["audit", "审计日志"],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50 hover:text-blue-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <div className="mb-5 flex justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => setError("")}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="mb-5 flex justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <p>{notice}</p>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}

        {tab === "overview" && (
          <section>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Overview
                </p>
                <h2 className="mt-1 text-2xl font-semibold">运行概览</h2>
              </div>
              <button
                type="button"
                disabled={loadingOverview}
                onClick={() => void loadOverview()}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
              >
                {loadingOverview ? "刷新中…" : "刷新"}
              </button>
            </div>
            {loadingOverview && !overview ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-32 animate-pulse rounded-2xl bg-gray-200"
                  />
                ))}
              </div>
            ) : (
              overview && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <p className="text-sm text-gray-500">用户</p>
                      <p className="mt-2 text-3xl font-semibold">
                        {overview.users.total}
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        正常 {overview.users.active} · 暂停{" "}
                        {overview.users.suspended}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <p className="text-sm text-gray-500">钱包余额</p>
                      <p className="mt-2 text-3xl font-semibold">
                        {formatMoney(overview.wallets.totalBalance)}
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        所有钱包的当前余额合计
                      </p>
                    </article>
                    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <p className="text-sm text-gray-500">平台模型</p>
                      <p className="mt-2 text-3xl font-semibold">
                        {overview.models.total}
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        启用 {overview.models.active}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <p className="text-sm text-gray-500">供应商</p>
                      <p className="mt-2 text-3xl font-semibold">
                        {overview.providers.total}
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        启用 {overview.providers.active}
                      </p>
                    </article>
                  </div>
                  <p className="mt-4 text-xs text-gray-400">
                    数据生成于 {formatDate(overview.generatedAt)}
                    。此概览不替代基础设施健康检查。
                  </p>
                </>
              )
            )}
          </section>
        )}

        {tab === "users" && (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                    Users
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">用户与余额</h2>
                </div>
                <span className="text-sm text-gray-400">
                  共 {userTotal} 位用户
                </span>
              </div>
              <form
                className="mb-5 flex flex-col gap-3 sm:flex-row"
                onSubmit={submitUserFilters}
              >
                <input
                  value={userSearchDraft}
                  onChange={(event) => setUserSearchDraft(event.target.value)}
                  placeholder="搜索邮箱或昵称"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <select
                  value={userStatus}
                  onChange={(event) => {
                    setUserStatus(event.target.value as UserStatus | "");
                    setUserPage(1);
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">全部状态</option>
                  <option value="ACTIVE">正常</option>
                  <option value="SUSPENDED">已暂停</option>
                  <option value="DELETED">已删除</option>
                </select>
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  搜索
                </button>
              </form>
              {loadingUsers ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((item) => (
                    <div
                      key={item}
                      className="h-16 animate-pulse rounded-xl bg-gray-100"
                    />
                  ))}
                </div>
              ) : users.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400">
                  没有符合条件的用户
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-sm">
                      <thead className="border-b border-gray-100 text-xs text-gray-400">
                        <tr>
                          <th className="px-2 py-3 font-medium">用户</th>
                          <th className="px-2 py-3 font-medium">角色</th>
                          <th className="px-2 py-3 font-medium">状态</th>
                          <th className="px-2 py-3 font-medium">余额</th>
                          <th className="px-2 py-3 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr
                            key={user.id}
                            className="border-b border-gray-50 last:border-0"
                          >
                            <td className="px-2 py-3">
                              <p className="font-medium text-gray-800">
                                {user.email}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-400">
                                {user.nickname || user.id}
                              </p>
                            </td>
                            <td className="px-2 py-3 text-xs text-gray-500">
                              {user.role}
                            </td>
                            <td className="px-2 py-3">
                              <select
                                value={user.status}
                                disabled={mutatingUserId === user.id}
                                onChange={(event) =>
                                  void updateUserStatus(
                                    user,
                                    event.target.value as UserStatus,
                                  )
                                }
                                className="rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 outline-none"
                              >
                                <option value="ACTIVE">正常</option>
                                <option value="SUSPENDED">已暂停</option>
                                <option value="DELETED">已删除</option>
                              </select>
                            </td>
                            <td className="px-2 py-3 font-medium text-gray-700">
                              {user.wallet
                                ? formatMoney(user.wallet.balance)
                                : "无钱包"}
                            </td>
                            <td className="px-2 py-3">
                              <button
                                type="button"
                                onClick={() => void selectUser(user)}
                                className="text-sm font-medium text-blue-600 hover:text-blue-700"
                              >
                                查看账本
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    label="用户"
                    page={userPage}
                    total={userTotal}
                    limit={PAGE_SIZE}
                    onPageChange={setUserPage}
                  />
                </>
              )}
            </div>
            <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              {!selectedUser ? (
                <div className="flex min-h-60 items-center justify-center text-center text-sm text-gray-400">
                  从左侧选择用户后，可查看账本并调整余额。
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                        Wallet
                      </p>
                      <h2 className="mt-1 truncate text-lg font-semibold">
                        {selectedUser.email}
                      </h2>
                      <p className="mt-1 text-sm text-gray-500">
                        当前余额{" "}
                        {selectedUser.wallet
                          ? formatMoney(selectedUser.wallet.balance)
                          : "无钱包"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-gray-400 hover:text-gray-700"
                      onClick={() => setSelectedUser(null)}
                    >
                      关闭
                    </button>
                  </div>
                  <form
                    className="mt-5 space-y-3 border-y border-gray-100 py-5"
                    onSubmit={submitAdjustment}
                  >
                    <h3 className="text-sm font-semibold">调整余额</h3>
                    <input
                      value={adjustmentAmount}
                      onChange={(event) =>
                        setAdjustmentAmount(event.target.value)
                      }
                      type="number"
                      step="0.01"
                      placeholder="金额，例如 10 或 -5"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <textarea
                      value={adjustmentReason}
                      onChange={(event) =>
                        setAdjustmentReason(event.target.value)
                      }
                      placeholder="必填：调整原因"
                      rows={3}
                      className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <button
                      disabled={mutatingUserId === selectedUser.id}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {mutatingUserId === selectedUser.id
                        ? "提交中…"
                        : "确认调整并审计"}
                    </button>
                  </form>
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold">最近账本</h3>
                    {loadingTransactions ? (
                      <div className="mt-3 space-y-2">
                        {[1, 2, 3].map((item) => (
                          <div
                            key={item}
                            className="h-12 animate-pulse rounded-lg bg-gray-100"
                          />
                        ))}
                      </div>
                    ) : transactions?.items.length ? (
                      <div className="mt-3 space-y-3">
                        {transactions.items.map((transaction) => (
                          <article
                            key={transaction.id}
                            className="rounded-lg bg-gray-50 px-3 py-2.5"
                          >
                            <div className="flex justify-between gap-3 text-sm">
                              <span className="font-medium text-gray-700">
                                {transaction.type}
                              </span>
                              <span
                                className={
                                  transaction.amount >= 0
                                    ? "text-emerald-600"
                                    : "text-red-600"
                                }
                              >
                                {transaction.amount >= 0 ? "+" : ""}
                                {formatMoney(transaction.amount)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                              {transaction.reason}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              余额 {formatMoney(transaction.balance)} ·{" "}
                              {formatDate(transaction.createdAt)}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-gray-400">暂无账本记录</p>
                    )}
                  </div>
                </>
              )}
            </aside>
          </section>
        )}

        {tab === "config" && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Configuration
                </p>
                <h2 className="mt-1 text-2xl font-semibold">模型与供应商</h2>
                <p className="mt-2 text-sm text-gray-500">
                  修改会立即影响后端路由，并写入管理员审计日志。
                </p>
              </div>
              <button
                type="button"
                disabled={loadingConfig}
                onClick={() => void loadConfig()}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
              >
                {loadingConfig ? "刷新中…" : "刷新配置"}
              </button>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">平台模型</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      管理员可看到已停用模型。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModelForm((current) => !current)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    新建模型
                  </button>
                </div>
                {showModelForm && (
                  <form
                    className="mb-5 space-y-3 rounded-xl bg-gray-50 p-4"
                    onSubmit={submitModel}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={modelForm.name}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="平台模型名"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={modelForm.displayName}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                        placeholder="展示名称"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <select
                        value={modelForm.type}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            type: event.target.value as ModelType,
                          }))
                        }
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="CHAT">聊天模型</option>
                        <option value="IMAGE">生图模型</option>
                      </select>
                      {modelForm.type === "CHAT" && (
                        <input
                          value={modelForm.maxTokens}
                          onChange={(event) =>
                            setModelForm((current) => ({
                              ...current,
                              maxTokens: event.target.value,
                            }))
                          }
                          type="number"
                          min="1"
                          step="1"
                          placeholder="最大 Token（可选）"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      )}
                    </div>
                    {modelForm.type === "CHAT" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs text-gray-500">
                          <span className="block font-medium text-gray-700">
                            输入价格（元 / 千 token）
                          </span>
                          <input
                            value={modelForm.pricing.input}
                            onChange={(event) =>
                              setModelForm((current) => ({
                                ...current,
                                pricing: {
                                  ...current.pricing,
                                  input: event.target.value,
                                },
                              }))
                            }
                            type="number"
                            min="0"
                            step="0.0001"
                            required
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-gray-500">
                          <span className="block font-medium text-gray-700">
                            输出价格（元 / 千 token）
                          </span>
                          <input
                            value={modelForm.pricing.output}
                            onChange={(event) =>
                              setModelForm((current) => ({
                                ...current,
                                pricing: {
                                  ...current.pricing,
                                  output: event.target.value,
                                },
                              }))
                            }
                            type="number"
                            min="0"
                            step="0.0001"
                            required
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="block space-y-1 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">
                          生图价格（元 / 张）
                        </span>
                        <input
                          value={modelForm.pricing.perImage}
                          onChange={(event) =>
                            setModelForm((current) => ({
                              ...current,
                              pricing: {
                                ...current.pricing,
                                perImage: event.target.value,
                              },
                            }))
                          }
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>
                    )}
                    <p className="text-xs text-gray-400">
                      价格必须是非负数字；保存后会作为该平台模型的计费快照来源。
                    </p>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={modelForm.isActive}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                      />
                      创建后立即启用
                    </label>
                    <button
                      disabled={mutatingResource === "model-form"}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {mutatingResource === "model-form"
                        ? "保存中…"
                        : "创建模型"}
                    </button>
                  </form>
                )}
                <div className="space-y-3">
                  {loadingConfig ? (
                    <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
                  ) : models.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
                      还没有平台模型
                    </p>
                  ) : (
                    models.map((model) => (
                      <article
                        key={model.id}
                        className="rounded-xl border border-gray-200 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-gray-800">
                              {model.displayName}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {model.name} · {model.type}
                            </p>
                            <p className="mt-2 text-xs text-gray-500">
                              {formatModelPricing(model)}
                            </p>
                          </div>
                          <Toggle
                            checked={model.isActive}
                            disabled={mutatingResource === `model-${model.id}`}
                            label={`${model.name}${model.isActive ? "停用" : "启用"}`}
                            onChange={() => void toggleResource("model", model)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedModelId(model.id)}
                          className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          管理上游映射
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">供应商</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      密钥仅保存在配置数据库，审计详情不会存储密钥。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowProviderForm((current) => !current)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    新建供应商
                  </button>
                </div>
                {showProviderForm && (
                  <form
                    className="mb-5 space-y-3 rounded-xl bg-gray-50 p-4"
                    onSubmit={submitProvider}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={providerForm.name}
                        onChange={(event) =>
                          setProviderForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="供应商名称"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <select
                        value={providerForm.apiFormat}
                        onChange={(event) => {
                          const nextFormat = event.target.value as ApiFormat;
                          setProviderForm((current) => {
                            const previousDefaults = PROVIDER_DEFAULTS[
                              current.apiFormat
                            ];
                            const nextDefaults = PROVIDER_DEFAULTS[nextFormat];
                            return {
                              ...current,
                              apiFormat: nextFormat,
                              config: {
                                ...current.config,
                                baseUrl:
                                  !current.config.baseUrl.trim() ||
                                  current.config.baseUrl ===
                                    previousDefaults.baseUrl
                                    ? nextDefaults.baseUrl
                                    : current.config.baseUrl,
                                timeout:
                                  !current.config.timeout.trim() ||
                                  current.config.timeout === previousDefaults.timeout
                                    ? nextDefaults.timeout
                                    : current.config.timeout,
                              },
                            };
                          });
                        }}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        {API_FORMATS.map((format) => (
                          <option key={format.value} value={format.value}>
                            {format.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">
                          API Key
                        </span>
                        <input
                          value={providerForm.config.apiKey}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              config: {
                                ...current.config,
                                apiKey: event.target.value,
                              },
                            }))
                          }
                          type="password"
                          autoComplete="new-password"
                          required
                          placeholder="sk-…"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">
                          Base URL
                        </span>
                        <input
                          value={providerForm.config.baseUrl}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              config: {
                                ...current.config,
                                baseUrl: event.target.value,
                              },
                            }))
                          }
                          type="url"
                          required
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">
                          请求超时（毫秒）
                        </span>
                        <input
                          value={providerForm.config.timeout}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              config: {
                                ...current.config,
                                timeout: event.target.value,
                              },
                            }))
                          }
                          type="number"
                          min="1"
                          step="1"
                          required
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">
                          限流（次 / 分钟）
                        </span>
                        <input
                          value={providerForm.config.rateLimit}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              config: {
                                ...current.config,
                                rateLimit: event.target.value,
                              },
                            }))
                          }
                          type="number"
                          min="1"
                          step="1"
                          required
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <p className="text-xs text-gray-400">
                      API Key 只用于调用上游，不会显示在供应商列表或审计日志中。
                    </p>
                    <div className="flex gap-4 text-sm text-gray-600">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={providerForm.supportsStreaming}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              supportsStreaming: event.target.checked,
                            }))
                          }
                        />
                        支持流式
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={providerForm.isActive}
                          onChange={(event) =>
                            setProviderForm((current) => ({
                              ...current,
                              isActive: event.target.checked,
                            }))
                          }
                        />
                        启用
                      </label>
                    </div>
                    <button
                      disabled={mutatingResource === "provider-form"}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {mutatingResource === "provider-form"
                        ? "保存中…"
                        : "创建供应商"}
                    </button>
                  </form>
                )}
                <div className="space-y-3">
                  {loadingConfig ? (
                    <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
                  ) : providers.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
                      还没有供应商
                    </p>
                  ) : (
                    providers.map((provider) => (
                      <article
                        key={provider.id}
                        className="rounded-xl border border-gray-200 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-gray-800">
                              {provider.name}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {provider.apiFormat} ·{" "}
                              {provider.supportsStreaming
                                ? "支持流式"
                                : "非流式"}
                            </p>
                            <p className="mt-2 max-w-[28rem] truncate text-xs text-gray-500">
                              {formatProviderConfig(provider)}
                            </p>
                          </div>
                          <Toggle
                            checked={provider.isActive}
                            disabled={
                              mutatingResource === `provider-${provider.id}`
                            }
                            label={`${provider.name}${provider.isActive ? "停用" : "启用"}`}
                            onChange={() =>
                              void toggleResource("provider", provider)
                            }
                          />
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">上游映射</h3>
                  <p className="mt-1 text-xs text-gray-400">
                    按平台模型管理上游、优先级和权重。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedModelId}
                    onChange={(event) => setSelectedModelId(event.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    <option value="">选择平台模型</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName} ({model.name})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedModelId || providers.length === 0}
                    onClick={() => setShowUpstreamForm((current) => !current)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    新建映射
                  </button>
                </div>
              </div>
              {showUpstreamForm && (
                <form
                  className="mt-5 space-y-3 rounded-xl bg-gray-50 p-4"
                  onSubmit={submitUpstream}
                >
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <select
                      value={upstreamForm.providerId}
                      onChange={(event) =>
                        setUpstreamForm((current) => ({
                          ...current,
                          providerId: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <option value="">选择供应商</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={upstreamForm.upstreamModelId}
                      onChange={(event) =>
                        setUpstreamForm((current) => ({
                          ...current,
                          upstreamModelId: event.target.value,
                        }))
                      }
                      placeholder="上游模型名"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <input
                      value={upstreamForm.priority}
                      onChange={(event) =>
                        setUpstreamForm((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                      type="number"
                      min="0"
                      placeholder="优先级"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <input
                      value={upstreamForm.weight}
                      onChange={(event) =>
                        setUpstreamForm((current) => ({
                          ...current,
                          weight: event.target.value,
                        }))
                      }
                      type="number"
                      min="1"
                      placeholder="权重"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <textarea
                      value={upstreamForm.upstreamPricing}
                      onChange={(event) =>
                        setUpstreamForm((current) => ({
                          ...current,
                          upstreamPricing: event.target.value,
                        }))
                      }
                      rows={4}
                      spellCheck={false}
                      placeholder="上游计费 JSON（可选）"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
                    />
                    <div className="space-y-3">
                      <input
                        value={upstreamForm.maxTokens}
                        onChange={(event) =>
                          setUpstreamForm((current) => ({
                            ...current,
                            maxTokens: event.target.value,
                          }))
                        }
                        type="number"
                        min="1"
                        placeholder="最大 Token（可选）"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={upstreamForm.isActive}
                          onChange={(event) =>
                            setUpstreamForm((current) => ({
                              ...current,
                              isActive: event.target.checked,
                            }))
                          }
                        />
                        启用
                      </label>
                    </div>
                  </div>
                  <button
                    disabled={mutatingResource === "upstream-form"}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {mutatingResource === "upstream-form"
                      ? "保存中…"
                      : "创建映射"}
                  </button>
                </form>
              )}
              {!selectedModelId ? (
                <p className="mt-5 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
                  选择一个平台模型以查看上游映射
                </p>
              ) : loadingUpstreams ? (
                <div className="mt-5 h-24 animate-pulse rounded-xl bg-gray-100" />
              ) : upstreams.length === 0 ? (
                <p className="mt-5 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
                  此模型还没有上游映射
                </p>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="border-b border-gray-100 text-xs text-gray-400">
                      <tr>
                        <th className="px-2 py-3 font-medium">供应商</th>
                        <th className="px-2 py-3 font-medium">上游模型</th>
                        <th className="px-2 py-3 font-medium">优先级 / 权重</th>
                        <th className="px-2 py-3 font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upstreams.map((upstream) => (
                        <tr
                          key={upstream.id}
                          className="border-b border-gray-50 last:border-0"
                        >
                          <td className="px-2 py-3 font-medium text-gray-700">
                            {providers.find(
                              (provider) => provider.id === upstream.providerId,
                            )?.name || upstream.providerId}
                          </td>
                          <td className="px-2 py-3 text-gray-600">
                            {upstream.upstreamModelId}
                          </td>
                          <td className="px-2 py-3 text-gray-500">
                            {upstream.priority} / {upstream.weight}
                          </td>
                          <td className="px-2 py-3">
                            <Toggle
                              checked={upstream.isActive}
                              disabled={
                                mutatingResource === `upstream-${upstream.id}`
                              }
                              label={`${upstream.upstreamModelId}${upstream.isActive ? "停用" : "启用"}`}
                              onChange={() =>
                                void toggleResource("upstream", upstream)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {tab === "audit" && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Audit
                </p>
                <h2 className="mt-1 text-xl font-semibold">审计日志</h2>
                <p className="mt-2 text-sm text-gray-500">
                  记录管理员对用户、钱包、模型、供应商和上游映射的操作。
                </p>
              </div>
              <span className="text-sm text-gray-400">共 {auditTotal} 条</span>
            </div>
            <form
              className="mb-5 grid gap-3 md:grid-cols-4"
              onSubmit={submitAuditFilters}
            >
              <input
                value={auditDraft.userId}
                onChange={(event) =>
                  setAuditDraft((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                placeholder="操作者 ID"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <input
                value={auditDraft.action}
                onChange={(event) =>
                  setAuditDraft((current) => ({
                    ...current,
                    action: event.target.value,
                  }))
                }
                placeholder="动作，例如 provider.updated"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <input
                value={auditDraft.resource}
                onChange={(event) =>
                  setAuditDraft((current) => ({
                    ...current,
                    resource: event.target.value,
                  }))
                }
                placeholder="资源，例如 provider"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                筛选
              </button>
            </form>
            {loadingAudit ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded-xl bg-gray-100"
                  />
                ))}
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400">
                没有符合条件的审计日志
              </p>
            ) : (
              <>
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <article
                      key={log.id}
                      className="rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-800">
                            {log.action}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            资源：{log.resource} · 操作者：
                            {log.userId || "系统"}
                          </p>
                        </div>
                        <time
                          className="text-xs text-gray-400"
                          dateTime={log.createdAt}
                        >
                          {formatDate(log.createdAt)}
                        </time>
                      </div>
                      {log.details && (
                        <pre className="mt-3 max-h-44 overflow-auto rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                      <p className="mt-2 text-xs text-gray-400">
                        {log.ipAddress || "未记录 IP"} ·{" "}
                        {log.userAgent || "未记录 User-Agent"}
                      </p>
                    </article>
                  ))}
                </div>
                <Pagination
                  label="审计日志"
                  page={auditPage}
                  total={auditTotal}
                  limit={PAGE_SIZE}
                  onPageChange={setAuditPage}
                />
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
