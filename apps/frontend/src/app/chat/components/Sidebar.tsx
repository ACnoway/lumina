'use client';

import type { ChatSession } from '@/lib/chat-types';
import UiIcon from '@/components/UiIcon';

interface SidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({
  sessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: SidebarProps) {
  return (
    <aside
      aria-label="对话记录"
      className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-center justify-between px-2 pb-3 pt-1">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">对话记录</h2>
          <p className="ui-caption mt-1">继续之前的灵感</p>
        </div>
        <span className="text-xl text-blue-600">✦</span>
      </div>

      <div className="px-1 pb-3">
        <button onClick={onNewSession} className="ui-button-primary w-full">
          <UiIcon name="plus" className="h-4 w-4" />
          新建对话
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {sessions.length === 0 ? (
          <div className="ui-upload-card px-3 py-8 text-center text-sm text-gray-500">
            暂无对话，点击上方开始
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <div
                  className={`flex items-center justify-between rounded-xl border text-sm transition-colors ${
                    session.id === currentSessionId
                      ? 'border-blue-100 bg-blue-50 text-blue-700'
                      : 'border-transparent text-gray-600 hover:border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    aria-current={session.id === currentSessionId ? 'true' : undefined}
                    title={session.title || '新对话'}
                    className="min-w-0 flex-1 truncate rounded-xl px-3 py-3 text-left"
                  >
                    {session.title || '新对话'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label={`删除对话：${session.title || '新对话'}`}
                    className="mr-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-red-50 hover:text-red-600"
                    title="删除会话"
                  >
                    <UiIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
