'use client';

import type { ChatSession } from '@/lib/chat-types';

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
    <aside className="flex min-h-[calc(100vh-148px)] w-full flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between px-2 pb-3 pt-1">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Workspace</p>
          <h2 className="mt-1 text-sm font-semibold text-gray-800">对话记录</h2>
        </div>
        <span className="text-xl text-blue-600">✦</span>
      </div>

      <div className="px-1 pb-3">
        <button
          onClick={onNewSession}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2"
        >
          <span className="mr-1.5 text-base">+</span>新建对话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-400">
            暂无会话
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <div
                  onClick={() => onSelectSession(session.id)}
                  className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    session.id === currentSessionId
                      ? 'border-blue-100 bg-blue-50 text-blue-700'
                      : 'border-transparent text-gray-600 hover:border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex-1 truncate">
                    {session.title || '新对话'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="ml-2 hidden rounded-md px-1 text-gray-400 hover:bg-red-50 hover:text-red-500 group-hover:block"
                    title="删除会话"
                  >
                    ×
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
