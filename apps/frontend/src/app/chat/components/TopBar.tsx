'use client';

import type { ChatModel } from '@/lib/chat-types';
import type { ChatContextUsage } from '@/lib/chat-types';
import { formatChatModelPricing, formatPhoton } from '@/lib/model-pricing';
import UiIcon from '@/components/UiIcon';

interface TopBarProps {
  models: ChatModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  balance: number | null;
  userEmail: string | null;
  loadingModels: boolean;
  modelError: boolean;
  onRetryModels: () => void;
  onOpenSessions: () => void;
  contextUsage: ChatContextUsage | null;
  contextLoading: boolean;
  contextError: boolean;
  compacting: boolean;
  canCompact: boolean;
  hasSession: boolean;
  onCompact: () => void;
}

export default function TopBar({
  models,
  selectedModel,
  onModelChange,
  balance,
  userEmail,
  loadingModels,
  modelError,
  onRetryModels,
  onOpenSessions,
  contextUsage,
  contextLoading,
  contextError,
  compacting,
  canCompact,
  hasSession,
  onCompact,
}: TopBarProps) {
  const selectedModelInfo = models.find((model) => model.name === selectedModel);
  const contextWindowTokens = contextUsage?.contextWindowTokens ?? selectedModelInfo?.contextWindowTokens ?? 8192;
  const reservedOutputTokens = contextUsage?.reservedOutputTokens ?? Math.min(
    selectedModelInfo?.maxTokens ?? 1000,
    Math.max(1, contextWindowTokens - 1),
  );
  const inputBudgetTokens = contextUsage?.inputBudgetTokens ?? Math.max(1, contextWindowTokens - reservedOutputTokens);
  const estimatedInputTokens = contextUsage?.estimatedInputTokens ?? 0;
  const utilizationPercent = contextUsage?.utilizationPercent ?? 0;
  const progressColor = utilizationPercent >= 90
    ? 'bg-red-500'
    : utilizationPercent >= 70
      ? 'bg-amber-500'
      : 'bg-blue-500';

  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-t-2xl border-b border-gray-100 bg-white p-4 sm:px-5">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="chat-model" className="text-xs font-medium text-gray-600">
            对话模型
          </label>
          <button type="button" onClick={onOpenSessions} disabled={compacting} className="ui-button-secondary px-3 lg:hidden disabled:cursor-not-allowed disabled:opacity-50">
            <UiIcon name="sessions" className="h-4 w-4" />
            对话记录
          </button>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="chat-model"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={loadingModels || models.length === 0 || compacting}
              aria-describedby={selectedModelInfo ? 'chat-model-pricing' : undefined}
              className="min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500 sm:w-auto sm:max-w-xs"
            >
              {models.length === 0 ? (
                <option value="">
                  {loadingModels ? '正在加载模型…' : modelError ? '模型加载失败' : '暂无可用模型'}
                </option>
              ) : (
                models.map((model) => (
                  <option key={model.id} value={model.name}>
                    {model.displayName}
                    {model.supportsVision ? ' · 支持图片' : ''}
                  </option>
                ))
              )}
            </select>
            {selectedModelInfo && (
              <span className={selectedModelInfo.supportsVision ? 'ui-badge' : 'ui-caption'}>
                {selectedModelInfo.supportsVision ? '支持图片' : '仅文字'}
              </span>
            )}
            {modelError && (
              <button type="button" onClick={onRetryModels} className="ui-button-secondary">
                重新加载
              </button>
            )}
          </div>
          {selectedModelInfo && (
            <p id="chat-model-pricing" className="ui-caption max-w-md">
              {formatChatModelPricing(selectedModelInfo.pricing)}
            </p>
          )}
          {selectedModelInfo && (
            <div className="mt-2 max-w-xl rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                    <span className="font-medium">上下文估算</span>
                    <span className="tabular-nums">
                      {contextLoading
                        ? '正在计算…'
                        : contextError
                          ? '暂时无法读取用量'
                          : `${estimatedInputTokens.toLocaleString()} / ${inputBudgetTokens.toLocaleString()} 输入 Token`}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200"
                    role="progressbar"
                    aria-label="上下文用量估算"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={utilizationPercent}
                    aria-valuetext={`${estimatedInputTokens} / ${inputBudgetTokens} 输入 Token；上下文窗口 ${contextWindowTokens} Token`}
                  >
                    <div className={`h-full rounded-full transition-[width] duration-300 ${progressColor}`} style={{ width: `${utilizationPercent}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-gray-400">
                    模型窗口 {contextWindowTokens.toLocaleString()} Token · 已预留最多 {reservedOutputTokens.toLocaleString()} Token 输出
                    {contextUsage?.omittedMessageCount
                      ? ` · ${contextUsage.omittedMessageCount} 条较早消息本轮未带入`
                      : ''}
                    {contextUsage?.compactedMessageCount
                      ? ` · 已压缩 ${contextUsage.compactedMessageCount} 条`
                      : ''}
                    {contextUsage?.hasSummary ? ' · 已包含压缩摘要' : ''}
                  </p>
                  {contextUsage && !contextUsage.fits && (
                    <p className="mt-1 text-[10px] font-medium text-red-600" role="status">
                      最新一轮超过输入预算，请缩短内容后重试。
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onCompact}
                  disabled={!hasSession || !canCompact || compacting || contextLoading}
                  title={!hasSession ? '先发送消息后即可压缩上下文' : undefined}
                  className="shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {compacting ? '压缩中…' : '压缩上下文'}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">用量为估算；压缩会调用当前模型并按 Token 计费。</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {balance !== null && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 sm:mt-6">
            <span className="mr-2 text-xs text-gray-500">余额</span>
            <span className={`font-semibold ${balance < 1 ? 'text-red-500' : 'text-gray-700'}`}>
              {formatPhoton(balance, 2)}
            </span>
          </div>
        )}
        {userEmail && (
          <span className="hidden max-w-44 truncate text-xs text-gray-400 sm:inline">{userEmail}</span>
        )}
      </div>
    </div>
  );
}
