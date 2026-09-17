// ==================== 用户角色 ====================
export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

// ==================== 用户状态 ====================
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

// ==================== 交易类型 ====================
export type TransactionType = 'RECHARGE' | 'CONSUME' | 'REFUND' | 'ADMIN_ADJUST';

// ==================== 消息角色 ====================
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

// ==================== 生图状态 ====================
export type ImageStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

// ==================== 错误码 ====================
export type ErrorCode =
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'CIRCUIT_BREAKER_OPEN';

// ==================== API 通用响应 ====================
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

// ==================== 认证相关 DTO ====================
export interface SendCodeDto {
  email: string;
}

export interface LoginDto {
  email: string;
  code: string;
}

export interface LoginResponse {
  accessToken: string;
  user: UserInfo;
}

export interface GetCurrentUserResponse {
  user: UserInfo;
  wallet: WalletInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  nickname: string | null;
  avatar: string | null;
  role: UserRole;
  status: UserStatus;
}

// ==================== 钱包相关 DTO ====================
export interface WalletInfo {
  id: string;
  balance: number;
}

export interface WalletTransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  balance: number;
  reason: string;
  createdAt: string;
}

export interface GetBalanceResponse {
  balance: number;
  walletId: string;
}

export interface TransactionItem {
  id: string;
  type: TransactionType;
  amount: number;
  balance: number;
  reason: string;
  createdAt: string;
  metadata?: any;
}

export interface GetTransactionsResponse {
  items: TransactionItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ==================== 聊天相关 DTO ====================
export interface ChatSessionDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: string;
  role: MessageRole;
  content: string;
  tokens: number | null;
  cost: number | null;
  createdAt: string;
}

export interface CreateChatMessageDto {
  sessionId: string;
  content: string;
}

export interface GetSessionsResponse {
  sessions: ChatSessionDto[];
  total: number;
  page: number;
  limit: number;
}

export interface GetMessagesResponse {
  messages: ChatMessageDto[];
  total: number;
  page: number;
  limit: number;
}

// ==================== 生图相关 DTO ====================
export interface OptimizePromptDto {
  prompt: string;
}

export interface OptimizePromptResponse {
  optimizedPrompt: string;
  cost: number;
}

export interface CreateImageTaskDto {
  prompt: string;
  originalPrompt?: string;
  negativePrompt?: string;
  model: string;
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
}

export interface ImageTaskDto {
  id: string;
  prompt: string;
  originalPrompt: string | null;
  negativePrompt: string | null;
  model: string;
  status: ImageStatus;
  imageUrl: string | null;
  cost: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageHistoryResponse {
  items: ImageTaskDto[];
  total: number;
  page: number;
  limit: number;
}

// ==================== 管理端 DTO ====================
export interface AdminAdjustBalanceDto {
  userId: string;
  amount: number;
  reason: string;
}

export interface AdminUpdateUserStatusDto {
  userId: string;
  status: UserStatus;
}

export interface AdminUserDto extends UserInfo {
  wallet: WalletInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUsersResponse {
  items: AdminUserDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminOverviewResponse {
  users: {
    total: number;
    active: number;
    suspended: number;
  };
  wallets: {
    totalBalance: number;
  };
  models: {
    total: number;
    active: number;
  };
  providers: {
    total: number;
    active: number;
  };
  generatedAt: string;
}

export interface AuditLogDto {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  items: AuditLogDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PromptOptimizerSettingDto {
  modelId: string | null;
  modelName: string | null;
}

// ==================== 供应商/模型相关类型 ====================
export type ApiFormat =
  | 'openai_chat'
  | 'openai_compatible'
  | 'anthropic_messages'
  | 'openai_image'
  | 'stability_image';

export type ModelType = 'CHAT' | 'IMAGE';

export interface ChatModelPricing {
  input: number;
  output: number;
}

export interface ImageModelPricing {
  perImage: number;
}

export type PlatformModelPricing = ChatModelPricing | ImageModelPricing;

interface PlatformModelDtoBase {
  id: string;
  name: string;
  displayName: string;
  isActive: boolean;
  maxTokens?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PlatformModelDto =
  | (PlatformModelDtoBase & {
      type: 'CHAT';
      pricing: ChatModelPricing;
    })
  | (PlatformModelDtoBase & {
      type: 'IMAGE';
      pricing: ImageModelPricing;
    });

export interface ProviderDto {
  id: string;
  name: string;
  apiFormat: ApiFormat;
  supportsStreaming: boolean;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamModelDto {
  id: string;
  platformModelId: string;
  providerId: string;
  upstreamModelId: string;
  priority: number;
  weight: number;
  isActive: boolean;
  upstreamPricing?: Record<string, any> | null;
  maxTokens?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderDto {
  name: string;
  apiFormat: ApiFormat;
  supportsStreaming?: boolean;
  config: Record<string, any>;
  isActive?: boolean;
}

export interface CreatePlatformModelDto {
  name: string;
  displayName: string;
  type: ModelType;
  pricing: Record<string, any>;
  maxTokens?: number;
  isActive?: boolean;
}

export interface CreateUpstreamModelDto {
  providerId: string;
  upstreamModelId: string;
  priority?: number;
  weight?: number;
  isActive?: boolean;
  upstreamPricing?: Record<string, any>;
  maxTokens?: number;
}
