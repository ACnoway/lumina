"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { chatApi } from "@/lib/chat-api";
import type { ChatSession, ChatMessage, ChatModel } from "@/lib/chat-types";
import { getStoredUser } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import Sidebar from "./components/Sidebar";
import MessageList from "./components/MessageList";
import MessageInput from "./components/MessageInput";
import TopBar from "./components/TopBar";

const MODEL_STORAGE_KEY = "lumina_chat_model";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const handledSessionParamRef = useRef<string | null>(null);

  // 会话状态
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // 模型状态
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  // 余额
  const [balance, setBalance] = useState<number | null>(null);

  // 发送状态
  const [sending, setSending] = useState(false);

  // 错误提示
  const [error, setError] = useState("");

  // AbortController 用于取消流式请求
  const abortRef = useRef<AbortController | null>(null);

  // 防止旧的会话/消息请求在新状态上落地
  const sessionListRequestRef = useRef(0);
  const messageListRequestRef = useRef(0);
  const skipNextSessionLoadRef = useRef<string | null>(null);
  const interactionVersionRef = useRef(0);

  // 初始化：加载会话列表、模型列表、余额
  useEffect(() => {
    loadSessions();
    loadModels();
    loadBalance();
  }, []);

  // 历史记录页通过 ?session=<id> 进入时，只在参数首次出现时定位会话，
  // 之后用户在侧边栏切换会话不会再被旧参数覆盖。
  useEffect(() => {
    if (
      !requestedSessionId ||
      handledSessionParamRef.current === requestedSessionId
    ) {
      return;
    }

    handledSessionParamRef.current = requestedSessionId;
    abortRef.current?.abort();
    setCurrentSessionId(requestedSessionId);
  }, [requestedSessionId]);

  // 切换会话时加载历史消息
  useEffect(() => {
    if (currentSessionId) {
      if (skipNextSessionLoadRef.current === currentSessionId) {
        skipNextSessionLoadRef.current = null;
        messageListRequestRef.current += 1;
        setLoadingMessages(false);
        return;
      }
      loadMessages(currentSessionId);
    } else {
      messageListRequestRef.current += 1;
      setLoadingMessages(false);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // 组件卸载时取消进行中的请求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function loadSessions() {
    const requestId = ++sessionListRequestRef.current;
    try {
      const res = await chatApi.getSessions(1, 50);
      if (requestId !== sessionListRequestRef.current) return;
      setSessions(res.sessions);
    } catch {
      if (requestId !== sessionListRequestRef.current) return;
      setError("加载会话列表失败");
    }
  }

  async function loadModels() {
    try {
      const list = await chatApi.getChatModels();
      setModels(list);
      // 从 localStorage 恢复上次选择的模型
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && list.some((m) => m.name === saved)) {
        setSelectedModel(saved);
      } else if (list.length > 0) {
        setSelectedModel(list[0].name);
      }
    } catch {
      setError("加载模型列表失败");
    }
  }

  async function loadBalance() {
    try {
      const res = await chatApi.getBalance();
      setBalance(res.balance);
    } catch {
      // 静默失败
    }
  }

  async function loadMessages(sessionId: string) {
    const requestId = ++messageListRequestRef.current;
    setLoadingMessages(true);
    setError("");
    try {
      const res = await chatApi.getMessages(sessionId, 1, 50);
      if (requestId !== messageListRequestRef.current) return;
      setMessages(res.messages);
    } catch {
      if (requestId !== messageListRequestRef.current) return;
      setError("加载历史消息失败");
    } finally {
      if (requestId === messageListRequestRef.current) {
        setLoadingMessages(false);
      }
    }
  }

  // 创建新会话
  async function handleNewSession() {
    // 中止当前流式请求
    abortRef.current?.abort();
    interactionVersionRef.current += 1;
    messageListRequestRef.current += 1;
    skipNextSessionLoadRef.current = null;
    setCurrentSessionId(null);
    setMessages([]);
    setLoadingMessages(false);
    setError("");
  }

  // 切换会话
  function handleSelectSession(sessionId: string) {
    if (sessionId === currentSessionId) return;
    abortRef.current?.abort();
    interactionVersionRef.current += 1;
    setCurrentSessionId(sessionId);
  }

  // 删除会话
  async function handleDeleteSession(sessionId: string) {
    try {
      await chatApi.deleteSession(sessionId);
      sessionListRequestRef.current += 1;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (sessionId === currentSessionId) {
        interactionVersionRef.current += 1;
        messageListRequestRef.current += 1;
        setCurrentSessionId(null);
        setMessages([]);
        setLoadingMessages(false);
      }
    } catch {
      setError("删除会话失败");
    }
  }

  // 切换模型
  function handleModelChange(modelName: string) {
    setSelectedModel(modelName);
    localStorage.setItem(MODEL_STORAGE_KEY, modelName);
  }

  // 发送消息
  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || sending) return;

      const interactionVersion = interactionVersionRef.current;

      if (!selectedModel) {
        setError("请先选择模型");
        return;
      }

      setError("");
      setSending(true);

      // 如果没有当前会话，先创建一个
      let sessionId = currentSessionId;
      if (!sessionId) {
        try {
          const session = await chatApi.createSession();
          if (interactionVersion !== interactionVersionRef.current) {
            setSending(false);
            return;
          }
          sessionId = session.id;
          // 懒创建的新会话暂时没有历史消息，跳过这一次空历史加载，
          // 避免覆盖下面即将写入的乐观消息。
          skipNextSessionLoadRef.current = sessionId;
          sessionListRequestRef.current += 1;
          setCurrentSessionId(sessionId);
          setSessions((prev) => [session, ...prev]);
        } catch {
          setError("创建会话失败");
          setSending(false);
          return;
        }
      }

      // 乐观更新：立即显示用户消息
      const tempUserMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "USER",
        content,
        tokens: null,
        cost: null,
        createdAt: new Date().toISOString(),
      };

      // 空的 AI 消息占位（流式填充）
      const tempAiMsg: ChatMessage = {
        id: `temp-ai-${Date.now()}`,
        role: "ASSISTANT",
        content: "",
        tokens: null,
        cost: null,
        createdAt: new Date().toISOString(),
      };

      // 发送时使当前历史加载失效，避免其返回结果覆盖乐观消息。
      messageListRequestRef.current += 1;
      setLoadingMessages(false);
      setMessages((prev) => [...prev, tempUserMsg, tempAiMsg]);

      // 创建 AbortController
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = chatApi.sendMessageStream(
          sessionId,
          content,
          selectedModel,
          { signal: controller.signal },
        );

        let aiContent = "";

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case "content":
              aiContent += event.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAiMsg.id ? { ...m, content: aiContent } : m,
                ),
              );
              break;

            case "done":
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAiMsg.id
                    ? {
                        ...m,
                        content: aiContent,
                        tokens: event.usage.totalTokens,
                        cost: event.cost,
                      }
                    : m,
                ),
              );
              // 刷新余额
              loadBalance();
              break;

            case "error":
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAiMsg.id
                    ? { ...m, content: `[错误] ${event.message}` }
                    : m,
                ),
              );
              setError(event.message);
              break;
          }
        }

        // 刷新会话列表（标题可能被自动更新了）
        if (!controller.signal.aborted) {
          loadSessions();
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "发送失败";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAiMsg.id ? { ...m, content: `[错误] ${msg}` } : m,
          ),
        );
        setError(msg);
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSessionId, selectedModel, sending],
  );

  const user = getStoredUser();

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader title="AI 聊天" active="chat" />

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <Sidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>

        <section className="flex min-h-[calc(100vh-148px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <TopBar
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            balance={balance}
            userEmail={user?.email ?? null}
          />

          {error && (
            <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          <MessageList messages={messages} loading={loadingMessages} />

          <MessageInput
            onSend={handleSend}
            disabled={sending || !selectedModel}
            placeholder={
              !selectedModel
                ? "请先选择模型"
                : "输入消息，回车发送，Shift+回车换行"
            }
          />
        </section>
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] text-sm text-gray-400">
          正在加载聊天…
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
