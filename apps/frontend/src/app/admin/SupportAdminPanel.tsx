"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SupportConversationDto,
  SupportConversationStatus,
  SupportMessageDto,
} from "@lumina/shared";
import { supportApi } from "@/lib/support-api";

const statusLabels: Record<SupportConversationStatus, string> = {
  WAITING_FOR_AGENT: "等待客服",
  WAITING_FOR_USER: "等待用户",
  CLOSED: "已结束",
};

const SSE_CONNECT_TIMEOUT_MS = 35_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

type SupportAdminPanelProps = {
  onUnreadCountChange?: (count: number) => void;
};

function formatDate(value: string | null): string {
  if (!value) return "暂无消息";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function displayName(conversation: SupportConversationDto): string {
  return conversation.user.nickname || conversation.user.email || conversation.user.phone || "未命名客户";
}

function appendMessage(current: SupportMessageDto[], message: SupportMessageDto) {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export default function SupportAdminPanel({ onUnreadCountChange }: SupportAdminPanelProps) {
  const [conversations, setConversations] = useState<SupportConversationDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConversationSnapshot, setSelectedConversationSnapshot] =
    useState<SupportConversationDto | null>(null);
  const [messages, setMessages] = useState<SupportMessageDto[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<SupportConversationStatus | "">("");
  const [unread, setUnread] = useState<"USER" | "ADMIN" | "">("ADMIN");
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [realtimeState, setRealtimeState] = useState<"connecting" | "connected" | "fallback">("connecting");
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRequestRef = useRef(0);
  const reconnectDelayRef = useRef(1500);

  const selectedConversation = useMemo(
    () =>
      conversations.find((item) => item.id === selectedId) ||
      (selectedConversationSnapshot?.id === selectedId ? selectedConversationSnapshot : null),
    [conversations, selectedConversationSnapshot, selectedId],
  );

  const applyUnreadCount = useCallback(
    (count: number) => {
      const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      setUnreadCount(normalized);
      onUnreadCountChange?.(normalized);
    },
    [onUnreadCountChange],
  );

  const loadConversations = useCallback(async () => {
    const requestId = ++conversationsRequestRef.current;
    const result = await supportApi.listConversations({
      page: 1,
      limit: 100,
      keyword,
      status,
      unread,
    });
    const unreadResult = await supportApi.getUnreadCount();
    if (requestId !== conversationsRequestRef.current) return;
    const currentSelectedId = selectedIdRef.current;
    const selectedFromResult = result.items.find((item) => item.id === currentSelectedId);
    if (selectedFromResult) {
      setSelectedConversationSnapshot(selectedFromResult);
    } else if (!currentSelectedId) {
      setSelectedConversationSnapshot(result.items[0] || null);
    }
    setConversations(result.items);
    applyUnreadCount(unreadResult.unreadCount);
    setSelectedId((current) => {
      if (current) return current;
      return result.items[0]?.id || null;
    });
  }, [applyUnreadCount, keyword, status, unread]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const result = await supportApi.getAdminMessages(conversationId, 1, 100);
      setMessages(result.messages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载客服消息失败");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const updateConversation = useCallback((conversation: SupportConversationDto) => {
    setConversations((current) =>
      current.map((item) => (item.id === conversation.id ? conversation : item)),
    );
    setSelectedConversationSnapshot((current) =>
      current?.id === conversation.id ? conversation : current,
    );
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) void loadMessages(selectedId);
    else setMessages([]);
  }, [loadMessages, selectedId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadConversations()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载客服队列失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadConversations]);

  useEffect(() => {
    let cancelled = false;
    async function consumeEvents() {
      while (!cancelled) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), SSE_CONNECT_TIMEOUT_MS);
        try {
          for await (const event of supportApi.adminEvents(controller.signal)) {
            if (cancelled) return;
            if (event.type === "ready") {
              window.clearTimeout(timeoutId);
              setRealtimeState("connected");
              reconnectDelayRef.current = 1500;
              continue;
            }
            if ("conversation" in event && event.conversation) {
              // Re-query the filtered/sorted queue so unread filters and
              // server-side ordering remain authoritative after an event.
              void loadConversations().catch(() => undefined);
            }
            if (event.type === "message" && event.message.conversationId === selectedIdRef.current) {
              setMessages((current) => appendMessage(current, event.message));
            }
          }
        } catch {
          if (!cancelled) {
            setRealtimeState("fallback");
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
  }, [loadConversations, loadMessages]);

  useEffect(() => {
    if (realtimeState !== "fallback") return undefined;
    let active = true;
    let syncing = false;
    const sync = async () => {
      if (!active || syncing) return;
      syncing = true;
      await loadConversations().catch(() => undefined);
      if (selectedIdRef.current) await loadMessages(selectedIdRef.current);
      syncing = false;
    };
    void sync();
    const intervalId = window.setInterval(() => void sync(), 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadConversations, loadMessages, realtimeState]);

  async function sendReply() {
    if (!selectedId || !draft.trim() || sending || selectedConversation?.status === "CLOSED") return;
    setSending(true);
    setError("");
    try {
      const result = await supportApi.sendAdminMessage(selectedId, draft.trim());
      setMessages((current) => appendMessage(current, result.message));
      updateConversation(result.conversation);
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送回复失败");
    } finally {
      setSending(false);
    }
  }

  async function markSelectedRead() {
    if (!selectedId || !selectedConversation || selectedConversation.adminUnreadCount <= 0 || markingRead) return;
    setMarkingRead(true);
    setError("");
    try {
      const result = await supportApi.markAdminRead(selectedId);
      updateConversation(result.conversation);
      applyUnreadCount((await supportApi.getUnreadCount()).unreadCount);
      await loadConversations();
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "标记已读失败");
    } finally {
      setMarkingRead(false);
    }
  }

  async function changeStatus(nextStatus: SupportConversationStatus) {
    if (!selectedId) return;
    try {
      const result = await supportApi.updateStatus(selectedId, nextStatus);
      updateConversation(result.conversation);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "更新会话状态失败");
    }
  }

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Support queue</p>
          <h2 className="mt-1 text-2xl font-semibold">客服</h2>
          <p className="mt-2 text-sm text-gray-500">所有管理员共享客服队列，管理员回复和状态变更会写入审计日志。</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          未读客户消息 <strong>{unreadCount}</strong>
        </div>
      </div>

      {realtimeState === "fallback" && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          实时连接暂时不可用，正在自动同步客服队列…
        </div>
      )}

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid min-h-[680px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-b border-gray-100 lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-gray-100 p-4">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索昵称、邮箱、手机号或消息"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <div className="flex gap-2">
              <select value={status} onChange={(event) => setStatus(event.target.value as SupportConversationStatus | "")} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm">
                <option value="">全部状态</option>
                <option value="WAITING_FOR_AGENT">等待客服</option>
                <option value="WAITING_FOR_USER">等待用户</option>
                <option value="CLOSED">已结束</option>
              </select>
              <select value={unread} onChange={(event) => setUnread(event.target.value as "USER" | "ADMIN" | "")} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm">
                <option value="ADMIN">有未读</option>
                <option value="">全部未读</option>
                <option value="USER">客户未读</option>
              </select>
            </div>
          </div>
          <div className="max-h-[580px] overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-sm text-gray-400">加载中…</p>
            ) : conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">暂无匹配的客服会话</p>
            ) : conversations.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setSelectedConversationSnapshot(item);
                }}
                className={`w-full border-b border-gray-100 px-4 py-4 text-left transition ${selectedId === item.id ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-gray-800">{displayName(item)}</span>
                  <span className="shrink-0 text-[11px] text-gray-400">{formatDate(item.lastMessageAt)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-gray-500">{item.user.email || item.user.phone || "未提供联系方式"}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-gray-600">{item.lastMessagePreview || "暂无消息"}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.adminUnreadCount > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">{item.adminUnreadCount}</span>}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{statusLabels[item.status]}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[620px] flex-col">
          {!selectedConversation ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">从左侧选择一个客服会话</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
                <div>
                  <h3 className="font-semibold text-gray-800">{displayName(selectedConversation)}</h3>
                  <p className="mt-1 text-xs text-gray-400">{selectedConversation.user.email || selectedConversation.user.phone || "未提供联系方式"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{statusLabels[selectedConversation.status]}</span>
                  {selectedConversation.adminUnreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markSelectedRead()}
                      disabled={markingRead}
                      className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {markingRead ? "标记中…" : "标记已读"}
                    </button>
                  )}
                  {selectedConversation.status === "CLOSED" ? (
                    <button type="button" onClick={() => void changeStatus("WAITING_FOR_AGENT")} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">重新打开</button>
                  ) : (
                    <button type="button" onClick={() => void changeStatus("CLOSED")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-red-200 hover:text-red-600">结束会话</button>
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto bg-[#fbfbfa] px-5 py-5">
                {loadingMessages ? <p className="text-center text-sm text-gray-400">加载消息中…</p> : messages.length === 0 ? <p className="text-center text-sm text-gray-400">暂无消息</p> : messages.map((message) => (
                  <div key={message.id} className={`flex ${message.senderType === "ADMIN" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] ${message.senderType === "ADMIN" ? "rounded-2xl rounded-br-md bg-blue-600 text-white" : "rounded-2xl rounded-bl-md border border-gray-200 bg-white text-gray-700"} px-4 py-3`}>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                      <p className={`mt-1 text-[11px] ${message.senderType === "ADMIN" ? "text-blue-100" : "text-gray-400"}`}>{message.senderType === "ADMIN" ? "管理员" : "客户"} · {formatDate(message.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 p-4">
                <div className="flex gap-3">
                  <textarea
                    value={draft}
                    maxLength={2000}
                    disabled={sending || selectedConversation.status === "CLOSED"}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendReply();
                      }
                    }}
                    rows={3}
                    placeholder={selectedConversation.status === "CLOSED" ? "重新打开会话后才能回复" : "输入回复，回车发送"}
                    className="min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                  />
                  <button type="button" onClick={() => void sendReply()} disabled={sending || !draft.trim() || selectedConversation.status === "CLOSED"} className="self-end rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{sending ? "发送中…" : "回复"}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
