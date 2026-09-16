import type {
  AdminOverviewResponse,
  AdminUserDto,
  AdminUsersResponse,
  ApiFormat,
  AuditLogsResponse,
  CreatePlatformModelDto,
  CreateProviderDto,
  CreateUpstreamModelDto,
  GetTransactionsResponse,
  ModelType,
  PlatformModelDto,
  ProviderDto,
  UpstreamModelDto,
  UserStatus,
} from "@lumina/shared";
import { apiClient } from "./api-client";

export interface ListAdminUsersOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus | "";
}

export interface ListAuditLogsOptions {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resource?: string;
}

export interface ProviderPayload {
  name: string;
  apiFormat: ApiFormat;
  supportsStreaming: boolean;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface PlatformModelPayload {
  name: string;
  displayName: string;
  type: ModelType;
  pricing: Record<string, unknown>;
  maxTokens?: number;
  isActive: boolean;
}

export interface UpstreamModelPayload {
  providerId: string;
  upstreamModelId: string;
  priority: number;
  weight: number;
  isActive: boolean;
  upstreamPricing?: Record<string, unknown>;
  maxTokens?: number;
}

function queryString(
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();

  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export const adminApi = {
  getOverview(): Promise<AdminOverviewResponse> {
    return apiClient.get("/admin/overview");
  },

  getUsers(options: ListAdminUsersOptions = {}): Promise<AdminUsersResponse> {
    return apiClient.get(
      `/admin/users${queryString({
        page: options.page ?? 1,
        limit: options.limit ?? 20,
        search: options.search,
        status: options.status,
      })}`,
    );
  },

  getUser(userId: string): Promise<AdminUserDto> {
    return apiClient.get(`/admin/users/${encodeURIComponent(userId)}`);
  },

  getUserTransactions(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<GetTransactionsResponse> {
    return apiClient.get(
      `/admin/users/${encodeURIComponent(userId)}/transactions${queryString({ page, limit })}`,
    );
  },

  updateUserStatus(userId: string, status: UserStatus): Promise<AdminUserDto> {
    return apiClient.patch(
      `/admin/users/${encodeURIComponent(userId)}/status`,
      {
        status,
      },
    );
  },

  adjustUserBalance(userId: string, amount: number, reason: string) {
    return apiClient.post("/admin/wallet/adjustments", {
      userId,
      amount,
      reason,
    });
  },

  getAuditLogs(options: ListAuditLogsOptions = {}): Promise<AuditLogsResponse> {
    return apiClient.get(
      `/admin/audit-logs${queryString({
        page: options.page ?? 1,
        limit: options.limit ?? 20,
        userId: options.userId,
        action: options.action,
        resource: options.resource,
      })}`,
    );
  },

  getModels(type?: ModelType): Promise<PlatformModelDto[]> {
    return apiClient.get(`/providers/models${queryString({ type })}`);
  },

  createModel(data: PlatformModelPayload): Promise<PlatformModelDto> {
    return apiClient.post(
      "/providers/models",
      data satisfies CreatePlatformModelDto,
    );
  },

  updateModel(
    id: string,
    data: Partial<PlatformModelPayload>,
  ): Promise<PlatformModelDto> {
    return apiClient.patch(`/providers/models/${encodeURIComponent(id)}`, data);
  },

  deleteModel(id: string): Promise<void> {
    return apiClient.delete(`/providers/models/${encodeURIComponent(id)}`);
  },

  getProviders(): Promise<ProviderDto[]> {
    return apiClient.get("/providers");
  },

  createProvider(data: ProviderPayload): Promise<ProviderDto> {
    return apiClient.post("/providers", data satisfies CreateProviderDto);
  },

  updateProvider(
    id: string,
    data: Partial<ProviderPayload>,
  ): Promise<ProviderDto> {
    return apiClient.patch(`/providers/${encodeURIComponent(id)}`, data);
  },

  deleteProvider(id: string): Promise<void> {
    return apiClient.delete(`/providers/${encodeURIComponent(id)}`);
  },

  getUpstreams(platformModelId: string): Promise<UpstreamModelDto[]> {
    return apiClient.get(
      `/providers/models/${encodeURIComponent(platformModelId)}/upstreams`,
    );
  },

  createUpstream(
    platformModelId: string,
    data: UpstreamModelPayload,
  ): Promise<UpstreamModelDto> {
    return apiClient.post(
      `/providers/models/${encodeURIComponent(platformModelId)}/upstreams`,
      data satisfies CreateUpstreamModelDto,
    );
  },

  updateUpstream(
    id: string,
    data: Partial<UpstreamModelPayload>,
  ): Promise<UpstreamModelDto> {
    return apiClient.patch(
      `/providers/upstreams/${encodeURIComponent(id)}`,
      data,
    );
  },

  deleteUpstream(id: string): Promise<void> {
    return apiClient.delete(`/providers/upstreams/${encodeURIComponent(id)}`);
  },
};
