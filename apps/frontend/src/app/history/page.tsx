"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  GetSessionsResponse,
  ImageStatus,
  ImageTaskDto,
} from "@lumina/shared";
import { ApiError } from "@/lib/api-client";
import { chatApi } from "@/lib/chat-api";
import { imageApi, type ImageTaskResponse } from "@/lib/image-api";
import AppHeader from "@/components/AppHeader";
import ImageLightbox, {
  ImageDownloadButton,
  type PreviewImage,
} from "@/components/ImageLightbox";

const PAGE_SIZE = 12;

type ImageTask = Omit<ImageTaskDto, "cost"> & { cost: number | null };

interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

function normalizeImageTask(task: ImageTaskResponse | ImageTaskDto): ImageTask {
  return {
    ...task,
    cost: task.cost === null ? null : Number(task.cost),
    images: (task.images || []).map((image) => ({
      ...image,
      cost: image.cost === null ? null : Number(image.cost),
    })),
  };
}

function getPreviewImage(task: ImageTask): PreviewImage | null {
  const image = task.images?.find((item) => Boolean(item.imageUrl));
  const src = image?.imageUrl || task.imageUrl;
  if (!src) return null;

  return {
    src,
    alt: task.prompt,
    filename: `lumina-${task.id}-${(image?.sequence ?? 0) + 1}.png`,
  };
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard copy failed");
}

function PromptCopyField({
  label,
  value,
  copyKey,
  copiedPrompt,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copiedPrompt: string;
  onCopy: (copyKey: string, value: string) => void;
}) {
  const hasValue = Boolean(value);

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <button
          type="button"
          onClick={() => onCopy(copyKey, value)}
          disabled={!hasValue}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copiedPrompt === copyKey ? "已复制" : "复制"}
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-5 text-gray-700">
        {hasValue ? value : "未填写"}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.status === 401 ? "登录已过期，请重新登录" : error.message;
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

function statusLabel(status: ImageStatus): string {
  switch (status) {
    case "PENDING":
      return "等待处理";
    case "PROCESSING":
      return "生成中";
    case "SUCCESS":
      return "已完成";
    case "FAILED":
      return "生成失败";
  }
}

function statusClassName(status: ImageStatus): string {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-50 text-emerald-700";
    case "FAILED":
      return "bg-red-50 text-red-700";
    case "PENDING":
    case "PROCESSING":
      return "bg-blue-50 text-blue-700";
  }
}

function Pagination({
  label,
  page,
  limit,
  total,
  onPageChange,
}: {
  label: string;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (total <= limit) return null;

  return (
    <nav
      className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4"
      aria-label={`${label}分页`}
    >
      <p className="text-xs text-gray-400">
        第 {page} / {totalPages} 页，共 {total} 条
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </nav>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center">
      <p className="text-sm text-red-700">{message}</p>
      <div className="mt-3 flex justify-center gap-3 text-sm">
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-red-700 hover:text-red-800"
        >
          重试
        </button>
        {message.includes("登录已过期") && (
          <Link
            href="/login?from=%2Fhistory"
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            重新登录
          </Link>
        )}
      </div>
    </div>
  );
}

function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="h-28 animate-pulse rounded-xl bg-gray-100"
        />
      ))}
    </div>
  );
}

export default function HistoryPage() {
  const [chatPage, setChatPage] = useState(1);
  const [imagePage, setImagePage] = useState(1);
  const [chatData, setChatData] = useState<
    PaginatedData<GetSessionsResponse["sessions"][number]>
  >({
    items: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
  });
  const [imageData, setImageData] = useState<PaginatedData<ImageTask>>({
    items: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
  });
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingImages, setLoadingImages] = useState(true);
  const [chatError, setChatError] = useState("");
  const [imageError, setImageError] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [lightboxImage, setLightboxImage] = useState<PreviewImage | null>(null);
  const chatRequestRef = useRef(0);
  const imageRequestRef = useRef(0);

  const loadChats = useCallback(async () => {
    const requestId = ++chatRequestRef.current;
    setLoadingChats(true);
    setChatError("");

    try {
      const response = await chatApi.getSessions(chatPage, PAGE_SIZE);
      if (requestId !== chatRequestRef.current) return;

      setChatData({
        items: response.sessions,
        total: response.total,
        page: response.page,
        limit: response.limit,
      });
    } catch (error) {
      if (requestId === chatRequestRef.current) {
        setChatError(getErrorMessage(error, "加载聊天记录失败"));
      }
    } finally {
      if (requestId === chatRequestRef.current) setLoadingChats(false);
    }
  }, [chatPage]);

  const loadImages = useCallback(async () => {
    const requestId = ++imageRequestRef.current;
    setLoadingImages(true);
    setImageError("");

    try {
      const response = await imageApi.getHistory(imagePage, PAGE_SIZE);
      if (requestId !== imageRequestRef.current) return;

      setImageData({
        items: response.items.map(normalizeImageTask),
        total: response.total,
        page: response.page,
        limit: response.limit,
      });
    } catch (error) {
      if (requestId === imageRequestRef.current) {
        setImageError(getErrorMessage(error, "加载生图记录失败"));
      }
    } finally {
      if (requestId === imageRequestRef.current) setLoadingImages(false);
    }
  }, [imagePage]);

  async function handleCopyPrompt(copyKey: string, value: string) {
    if (!value) return;

    try {
      await copyText(value);
      setCopiedPrompt(copyKey);
      window.setTimeout(() => setCopiedPrompt(""), 1500);
    } catch {
      setImageError("复制失败，请检查浏览器剪贴板权限");
    }
  }

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader title="历史记录" active="history" />

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                Chat
              </p>
              <h2 className="mt-1 text-xl font-semibold">聊天会话</h2>
            </div>
            <Link
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
              href="/chat"
            >
              开始新对话
            </Link>
          </div>

          {loadingChats ? (
            <LoadingCards />
          ) : chatError ? (
            <ErrorState message={chatError} onRetry={() => void loadChats()} />
          ) : chatData.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-5 py-10 text-center">
              <p className="font-medium text-gray-600">还没有聊天记录</p>
              <p className="mt-1 text-sm text-gray-400">
                开始一段对话后，会话会显示在这里。
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {chatData.items.map((session) => (
                  <Link
                    key={session.id}
                    href={`/chat?session=${encodeURIComponent(session.id)}`}
                    className="group rounded-xl border border-gray-200 p-4 transition hover:border-blue-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="line-clamp-2 font-medium text-gray-800 group-hover:text-blue-700">
                        {session.title || "未命名对话"}
                      </h3>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatDate(session.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-gray-400">继续这段对话</p>
                  </Link>
                ))}
              </div>
              <Pagination
                label="聊天会话"
                page={chatData.page}
                limit={chatData.limit}
                total={chatData.total}
                onPageChange={setChatPage}
              />
            </>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                Images
              </p>
              <h2 className="mt-1 text-xl font-semibold">生图记录</h2>
            </div>
            <Link
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
              href="/image"
            >
              创作新图片
            </Link>
          </div>

          {loadingImages ? (
            <LoadingCards />
          ) : imageError ? (
            <ErrorState
              message={imageError}
              onRetry={() => void loadImages()}
            />
          ) : imageData.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-5 py-10 text-center">
              <p className="font-medium text-gray-600">还没有生图记录</p>
              <p className="mt-1 text-sm text-gray-400">
                生成的图片、进行中的任务和失败原因都会保留在这里。
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {imageData.items.map((task) => (
                  <article
                    key={task.id}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                  >
                    {task.status === "SUCCESS" &&
                    (task.images?.[0]?.imageUrl || task.imageUrl) ? (
                      <div className="group relative aspect-[4/3] bg-gray-100">
                        <button
                          type="button"
                          className="block h-full w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                          onClick={() =>
                            setLightboxImage(getPreviewImage(task))
                          }
                          aria-label="查看图片大图"
                        >
                          {/* imageUrl is a signed MinIO URL returned by the authenticated history API. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              task.images?.[0]?.imageUrl ||
                              task.imageUrl ||
                              undefined
                            }
                            alt={task.prompt}
                            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.01]"
                          />
                        </button>
                        {getPreviewImage(task) && (
                          <div className="absolute right-2 top-2">
                            <ImageDownloadButton
                              image={getPreviewImage(task)!}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 text-center">
                        <span
                          className={`rounded-full px-3 py-1.5 text-sm font-medium ${statusClassName(task.status)}`}
                        >
                          {statusLabel(task.status)}
                        </span>
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName(task.status)}`}
                        >
                          {statusLabel(task.status)}
                        </span>
                        <time
                          className="shrink-0 text-xs text-gray-400"
                          dateTime={task.createdAt}
                        >
                          {formatDate(task.createdAt)}
                        </time>
                      </div>
                      <PromptCopyField
                        label="正面提示词"
                        value={task.prompt}
                        copyKey={`${task.id}:prompt`}
                        copiedPrompt={copiedPrompt}
                        onCopy={(copyKey, value) =>
                          void handleCopyPrompt(copyKey, value)
                        }
                      />
                      <PromptCopyField
                        label="反面提示词"
                        value={task.negativePrompt || ""}
                        copyKey={`${task.id}:negativePrompt`}
                        copiedPrompt={copiedPrompt}
                        onCopy={(copyKey, value) =>
                          void handleCopyPrompt(copyKey, value)
                        }
                      />
                      {task.originalPrompt && (
                        <PromptCopyField
                          label="原始提示词"
                          value={task.originalPrompt}
                          copyKey={`${task.id}:originalPrompt`}
                          copiedPrompt={copiedPrompt}
                          onCopy={(copyKey, value) =>
                            void handleCopyPrompt(copyKey, value)
                          }
                        />
                      )}
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-gray-400">
                          {task.model}
                        </span>
                        {task.cost !== null && (
                          <span className="shrink-0 text-gray-500">
                            ¥{task.cost.toFixed(4)}
                          </span>
                        )}
                      </div>
                      {task.images && task.images.length > 1 && (
                        <p className="mt-2 text-xs text-blue-600">
                          本次生成 {task.images.length} 张图片
                        </p>
                      )}
                      {task.status === "FAILED" && task.errorMessage && (
                        <p className="mt-3 line-clamp-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-700">
                          {task.errorMessage}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <Pagination
                label="生图记录"
                page={imageData.page}
                limit={imageData.limit}
                total={imageData.total}
                onPageChange={setImagePage}
              />
            </>
          )}
        </section>
      </div>
      <ImageLightbox
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </main>
  );
}
