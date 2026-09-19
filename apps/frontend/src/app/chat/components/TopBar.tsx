'use client';

import type { ChatModel } from '@/lib/chat-types';
import { formatChatModelPricing, formatPhoton } from '@/lib/model-pricing';

interface TopBarProps {
  models: ChatModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  balance: number | null;
  userEmail: string | null;
}

export default function TopBar({
  models,
  selectedModel,
  onModelChange,
  balance,
  userEmail,
}: TopBarProps) {
  const selectedModelInfo = models.find((model) => model.name === selectedModel);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Model</p>
          <p className="mt-0.5 text-sm font-medium text-gray-700">选择对话模型</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            aria-describedby={selectedModelInfo ? 'chat-model-pricing' : undefined}
            className="max-w-[190px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {models.length === 0 ? (
              <option value="">加载模型中...</option>
            ) : (
              models.map((model) => (
                <option key={model.id} value={model.name}>
                  {model.displayName}
                </option>
              ))
            )}
          </select>
          {selectedModelInfo && (
            <p
              id="chat-model-pricing"
              className="max-w-[280px] text-[11px] leading-4 text-gray-400"
            >
              {formatChatModelPricing(selectedModelInfo.pricing)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {balance !== null && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="mr-2 text-xs text-gray-400">余额</span>
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
