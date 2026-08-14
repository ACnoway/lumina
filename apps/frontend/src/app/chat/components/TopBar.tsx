'use client';

import type { ChatModel } from '@/lib/chat-types';

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
  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      {/* 模型选择 */}
      <div className="flex items-center gap-3">
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 focus:border-blue-500 focus:outline-none"
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
      </div>

      {/* 余额和用户信息 */}
      <div className="flex items-center gap-4 text-sm">
        {balance !== null && (
          <div className="flex items-center gap-1">
            <span className="text-gray-400">余额</span>
            <span className={`font-medium ${balance < 1 ? 'text-red-500' : 'text-gray-700'}`}>
              ¥{balance.toFixed(2)}
            </span>
          </div>
        )}
        {userEmail && (
          <span className="hidden text-gray-400 sm:inline">{userEmail}</span>
        )}
      </div>
    </div>
  );
}
