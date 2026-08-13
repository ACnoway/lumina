// ==================== 用户角色 ====================
export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

// ==================== 用户状态 ====================
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

// ==================== 交易类型 ====================
export enum TransactionType {
  RECHARGE = 'RECHARGE',
  CONSUME = 'CONSUME',
  REFUND = 'REFUND',
  ADMIN_ADJUST = 'ADMIN_ADJUST',
}

// ==================== 消息角色 ====================
export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM',
}

// ==================== 生图状态 ====================
export enum ImageStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

// ==================== 错误码 ====================
export enum ErrorCode {
  // 通用
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  // 钱包
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  // 供应商
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
}

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
