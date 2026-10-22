'use client';

import type { ChatModel } from '@/lib/chat-types';
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
}: TopBarProps) {
  const selectedModelInfo = models.find((model) => model.name === selectedModel);

  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-t-2xl border-b border-gray-100 bg-white p-4 sm:px-5">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="chat-model" className="text-xs font-medium text-gray-600">
            对话模型
          </label>
          <button type="button" onClick={onOpenSessions} className="ui-button-secondary px-3 lg:hidden">
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
              disabled={loadingModels || models.length === 0}
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
