"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SupportConversationDto,
  SupportConversationStatus,
  SupportMessageDto,
} from "@lumina/shared";
import AppHeader from "@/components/AppHeader";
import { supportApi } from "@/lib/support-api";

const statusLabels: Record<SupportConversationStatus, string> = {
  WAITING_FOR_AGENT: "等待客服",
  WAITING_FOR_USER: "等待你回复",
  CLOSED: "已结束",
};

const SSE_CONNECT_TIMEOUT_MS = 35_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function appendMessage(current: SupportMessageDto[], message: SupportMessageDto) {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export default function SupportPage() {
  const [conversation, setConversation] = useState<SupportConversationDto | null>(null);
  const [messages, setMessages] = useState<SupportMessageDto[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [realtimeState, setRealtimeState] = useState<"connecting" | "connected" | "fallback">("connecting");
  const bottomRef = useRef<HTMLDivElement>(null);
  const reconnectDelayRef = useRef(1500);

  const loadMessages = useCallback(async () => {
    const result = await supportApi.getMessages(1, 100);
    setMessages(result.messages);
    await supportApi.markRead();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await supportApi.getConversation();
        if (cancelled) return;
        setConversation(result.conversation);
        await loadMessages();
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载客服会话失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  useEffect(() => {
    let cancelled = false;
    async function consumeEvents() {
      while (!cancelled) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), SSE_CONNECT_TIMEOUT_MS);
        try {
          for await (const event of supportApi.events(controller.signal)) {
            if (cancelled) return;
            if (event.type === "ready") {
              setRealtimeState("connected");
              reconnectDelayRef.current = 1500;
              continue;
            }
            if ("conversation" in event && event.conversation) setConversation(event.conversation);
            if (event.type === "message") {
              setMessages((current) => appendMessage(current, event.message));
              if (event.message.senderType === "ADMIN") {
                void supportApi.markRead().catch(() => undefined);
              }
            }
          }
        } catch {
          if (!cancelled) {
            setRealtimeState("fallback");
            await loadMessages().catch(() => undefined);
            await new Promise((resolve) => window.setTimeout(resolve, reconnectDelayRef.current));
            reconnectDelayRef.current = Math.min(
              MAX_RECONNECT_DELAY_MS,
              reconnectDelayRef.current * 2,
            );
          }
        } finally {
          window.clearTimeout(timeoutId);
          controller.abort();
        }
      }
    }
    void consumeEvents();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  useEffect(() => {
    if (realtimeState !== "fallback") return undefined;
    let active = true;
    let syncing = false;
    const syncMessages = async () => {
      if (!active || syncing) return;
      syncing = true;
      await loadMessages().catch(() => undefined);
      syncing = false;
    };
    void syncMessages();
    const intervalId = window.setInterval(() => void syncMessages(), 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadMessages, realtimeState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await supportApi.sendMessage(trimmed);
      setMessages((current) => appendMessage(current, result.message));
      setConversation(result.conversation);
      setContent("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader title="联系客服" active="support" />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <section className="flex min-h-[calc(100vh-150px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Support</p>
              <h2 className="mt-1 text-xl font-semibold">在线客服</h2>
            </div>
            {conversation && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {statusLabels[conversation.status]}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-[#fbfbfa] px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-2xl space-y-4">
              {loading ? (
                <p className="py-12 text-center text-sm text-gray-400">正在加载会话…</p>
              ) : messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">
                  <p className="font-medium text-gray-700">有什么可以帮你？</p>
                  <p className="mt-2">请描述遇到的问题，我们会尽快回复。</p>
                </div>
              ) : (
                messages.map((message) => {
                  const isMine = message.senderType === "USER";
                  return (
                    <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] ${isMine ? "items-end" : "items-start"}`}>
                        <div
                          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
                            isMine
                              ? "rounded-br-md bg-blue-600 text-white"
                              : "rounded-bl-md border border-gray-200 bg-white text-gray-700"
                          }`}
                        >
                          {message.content}
                        </div>
                        <p className={`mt-1 text-[11px] text-gray-400 ${isMine ? "text-right" : ""}`}>
                          {message.senderType === "ADMIN" ? "客服" : "我"} · {formatDate(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {realtimeState === "fallback" && (
            <p className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
              实时连接暂时不可用，正在自动同步消息…
            </p>
          )}
          {error && <p className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}
          <div className="border-t border-gray-100 bg-white p-4 sm:p-5">
            <div className="mx-auto flex max-w-2xl gap-3">
              <textarea
                value={content}
                maxLength={2000}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={3}
                disabled={sending}
                placeholder="输入消息，回车发送，Shift+回车换行"
                className="min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sending || !content.trim()}
                className="self-end rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "发送中…" : "发送"}
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-2xl text-right text-xs text-gray-400">纯文本消息 · {content.length}/2000</p>
          </div>
        </section>
      </div>
    </main>
  );
}
