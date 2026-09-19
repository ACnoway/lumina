'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/chat-types';
import { formatPhoton } from '@/lib/model-pricing';
import MarkdownContent from './MarkdownContent';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export default function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#fdfdfc]">
        <div className="text-sm text-gray-400">加载中...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#fdfdfc] px-5 py-10">
        <div className="w-full max-w-md rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-600">✦</div>
          <p className="font-medium text-gray-600">开始一段新对话</p>
          <p className="mt-2 text-sm text-gray-400">输入消息，按回车发送，Shift+回车换行</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#fdfdfc] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'USER';
  const isPending = message.content === '' && !isUser;
  const isError = message.content.startsWith('[错误]');

  // 用户消息：右对齐蓝色
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-white shadow-sm">
          <MarkdownContent content={message.content} />
        </div>
      </div>
    );
  }

  // AI 消息：左对齐灰色
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 ${
          isError
            ? 'border border-red-100 bg-red-50 text-red-600'
            : 'border border-gray-100 bg-white text-gray-800 shadow-sm'
        }`}
      >
        {isPending ? (
          <div className="flex items-center gap-1 py-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
          </div>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {/* token 和本次实际费用 */}
        {!isPending &&
          !isError &&
          (message.tokens !== null || message.cost !== null) && (
            <div className="mt-1.5 border-t border-gray-200 pt-1 text-xs text-gray-400">
              {message.tokens !== null && `${message.tokens} tokens`}
              {message.tokens !== null && message.cost != null && ' · '}
              {message.cost != null && `实际费用 ${formatPhoton(message.cost)}`}
            </div>
          )}
      </div>
    </div>
  );
}
