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

// ==================== 生图相关 DTO ====================
export interface CreateImageDto {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
}

export interface ImageGenerationDto {
  id: string;
  prompt: string;
  status: ImageStatus;
  imageUrl: string | null;
  cost: number | null;
  createdAt: string;
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
