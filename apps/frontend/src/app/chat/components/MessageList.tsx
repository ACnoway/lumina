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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[#fdfdfc] p-5" role="status">
        <div className="text-sm text-gray-500">正在加载对话…</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[#fdfdfc] px-4 py-6">
        <div className="w-full max-w-md px-4 py-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-600">✦</div>
          <p className="font-medium text-gray-600">开始一段新对话</p>
          <p className="mt-2 text-sm leading-6 text-gray-500">提一个问题，或分享你的灵感。<br />选择支持图片的模型，还可以一起聊聊图片。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fdfdfc] px-4 py-6 sm:px-6">
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
        <div className="min-w-0 max-w-[92%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-white shadow-sm sm:max-w-[85%]">
          {(message.attachments ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {(message.attachments ?? []).map((attachment) => (
                <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                  <img src={attachment.url} alt="用户上传的图片" className="max-h-72 max-w-full rounded-lg object-contain" />
                </a>
              ))}
            </div>
          )}
          <MarkdownContent content={message.content} />
        </div>
      </div>
    );
  }

  // AI 消息：左对齐灰色
  return (
    <div className="flex justify-start">
      <div
        className={`min-w-0 max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 sm:max-w-[85%] ${
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
            <div className="ui-caption mt-2 border-t border-gray-100 pt-2">
              {message.tokens !== null && `${message.tokens} tokens`}
              {message.tokens !== null && message.cost != null && ' · '}
              {message.cost != null && `实际费用 ${formatPhoton(message.cost)}`}
            </div>
          )}
      </div>
    </div>
  );
}
