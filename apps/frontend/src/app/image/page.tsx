'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ImageStatus, ImageTaskDto, PlatformModelDto } from '@lumina/shared';
import { ApiError } from '@/lib/api-client';
import { imageApi, type ImageTaskResponse } from '@/lib/image-api';

const MODEL_STORAGE_KEY = 'lumina_image_model';
const ACTIVE_TASK_STORAGE_KEY = 'lumina_image_active_task';
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 120;
const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 正方形' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '4:3', label: '4:3 横向' },
  { value: '3:4', label: '3:4 竖向' },
] as const;

type AspectRatio = (typeof ASPECT_RATIOS)[number]['value'];
type ImageTask = Omit<ImageTaskDto, 'cost'> & { cost: number | null };

function normalizeTask(task: ImageTaskResponse | ImageTaskDto): ImageTask {
  return {
    ...task,
    cost: task.cost === null ? null : Number(task.cost),
  };
}

function statusLabel(status: ImageStatus): string {
  switch (status) {
    case 'PENDING':
      return '等待处理';
    case 'PROCESSING':
      return '生成中';
    case 'SUCCESS':
      return '已完成';
    case 'FAILED':
      return '生成失败';
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已过期，请重新登录';
    if (error.message.includes('余额不足')) return '余额不足，请充值后重试';
    if (
      error.status === 502 ||
      error.status === 503 ||
      error.message.includes('上游') ||
      error.message.includes('供应商')
    ) {
      return '当前生图服务暂不可用，请稍后重试';
    }
    return error.message;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function ImagePage() {
  const [models, setModels] = useState<PlatformModelDto[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [task, setTask] = useState<ImageTask | null>(null);
  const [history, setHistory] = useState<ImageTask[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pollRunRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await imageApi.getHistory();
      setHistory(response.items.map(normalizeTask));
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载生图历史失败'));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const pollTask = useCallback(
    async (taskId: string): Promise<void> => {
      pollRunRef.current += 1;
      const runId = pollRunRef.current;
      setPolling(true);
      setError('');

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        if (runId !== pollRunRef.current) return;

        try {
          const currentTask = normalizeTask(await imageApi.getTask(taskId));
          if (runId !== pollRunRef.current) return;

          setTask(currentTask);

          if (currentTask.status === 'SUCCESS') {
            localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
            setNotice('图片生成完成');
            setPolling(false);
            void loadHistory();
            return;
          }

          if (currentTask.status === 'FAILED') {
            localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
            setError(currentTask.errorMessage || '图片生成失败，请稍后重试');
            setPolling(false);
            void loadHistory();
            return;
          }
        } catch (pollError) {
          if (runId !== pollRunRef.current) return;
          localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
          setError(getErrorMessage(pollError, '查询生图任务失败'));
          setPolling(false);
          return;
        }

        await new Promise<void>((resolve) => {
          pollTimerRef.current = setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }

      if (runId === pollRunRef.current) {
        setError('任务处理时间较长，请稍后在历史记录中查看结果');
        setPolling(false);
      }
    },
    [loadHistory],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setLoadingModels(true);
      try {
        const availableModels = await imageApi.getModels();
        if (cancelled) return;

        setModels(availableModels);
        const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
        const nextModel =
          savedModel && availableModels.some((model) => model.name === savedModel)
            ? savedModel
            : availableModels[0]?.name || '';
        setSelectedModel(nextModel);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, '加载生图模型失败'));
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }

    void loadModels();
    void loadHistory();

    const activeTaskId = localStorage.getItem(ACTIVE_TASK_STORAGE_KEY);
    if (activeTaskId) {
      void pollTask(activeTaskId);
    }

    return () => {
      cancelled = true;
      pollRunRef.current += 1;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [loadHistory, pollTask]);

  function handleModelChange(modelName: string) {
    setSelectedModel(modelName);
    localStorage.setItem(MODEL_STORAGE_KEY, modelName);
  }

  async function handleOptimize() {
    const input = prompt.trim();
    if (!input || optimizing || submitting || polling) return;

    setOptimizing(true);
    setError('');
    setNotice('');
    try {
      const response = await imageApi.optimizePrompt(input);
      setOriginalPrompt(input);
      setPrompt(response.optimizedPrompt);
      setNotice(`提示词已优化，本次费用 ¥${response.cost.toFixed(4)}`);
    } catch (optimizeError) {
      setError(getErrorMessage(optimizeError, '提示词优化失败'));
    } finally {
      setOptimizing(false);
    }
  }

  async function handleGenerate() {
    const input = prompt.trim();
    if (!input || !selectedModel || submitting || polling) return;

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const createdTask = normalizeTask(
        await imageApi.generate({
          prompt: input,
          originalPrompt: originalPrompt || undefined,
          negativePrompt: negativePrompt.trim() || undefined,
          model: selectedModel,
          aspectRatio,
        }),
      );
      setTask(createdTask);
      localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, createdTask.id);
      await pollTask(createdTask.id);
    } catch (generateError) {
      setError(getErrorMessage(generateError, '创建生图任务失败'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleHistorySelect(historyTask: ImageTask) {
    setError('');
    setNotice('');
    setTask(historyTask);
    if (historyTask.status === 'PENDING' || historyTask.status === 'PROCESSING') {
      localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, historyTask.id);
      void pollTask(historyTask.id);
    }
  }

  const busy = submitting || optimizing || polling;
  const hasModels = models.length > 0;

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              Lumina Studio
            </p>
            <h1 className="mt-1 text-xl font-semibold">AI 生图</h1>
          </div>
          <nav className="flex items-center gap-4 text-sm text-gray-500">
            <Link className="hover:text-blue-600" href="/chat">
              聊天
            </Link>
            <Link className="hover:text-blue-600" href="/history">
              历史记录
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-6">
            <p className="text-sm text-gray-500">Describe a scene and let Lumina make it real.</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">创作一张新图片</h2>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700" role="status">
              {notice}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700" htmlFor="image-prompt">
                  提示词
                </label>
                <span className="text-xs text-gray-400">{prompt.length}/4000</span>
              </div>
              <textarea
                id="image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={4000}
                rows={7}
                placeholder="例如：雨后的上海街头，一家温暖的小书店，电影感灯光，细腻写实"
                className="w-full resize-y rounded-xl border border-gray-300 px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                disabled={busy}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">可以先用中文描述，再让优化器扩展成英文提示词。</p>
                <button
                  type="button"
                  onClick={() => void handleOptimize()}
                  disabled={!prompt.trim() || busy || !hasModels}
                  className="shrink-0 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {optimizing ? '优化中...' : '优化提示词'}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="negative-prompt">
                反向提示词 <span className="font-normal text-gray-400">（可选）</span>
              </label>
              <input
                id="negative-prompt"
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                maxLength={2000}
                placeholder="例如：模糊、低质量、文字、水印"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                disabled={busy}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="image-model">
                  模型
                </label>
                <select
                  id="image-model"
                  value={selectedModel}
                  onChange={(event) => handleModelChange(event.target.value)}
                  disabled={busy || loadingModels || !hasModels}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                >
                  {loadingModels ? (
                    <option value="">加载模型中...</option>
                  ) : hasModels ? (
                    models.map((model) => (
                      <option key={model.id} value={model.name}>
                        {model.displayName}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无可用模型</option>
                  )}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="aspect-ratio">
                  画面比例
                </label>
                <select
                  id="aspect-ratio"
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
                  disabled={busy}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                >
                  {ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio.value} value={ratio.value}>
                      {ratio.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!hasModels && !loadingModels && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                当前没有可用的生图模型，请联系管理员配置后再试。
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!prompt.trim() || !selectedModel || busy || !hasModels}
              className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? '提交任务中...' : polling ? '图片生成中...' : '生成图片'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Latest result</p>
              <h2 className="mt-1 text-xl font-semibold">生成结果</h2>
            </div>
            {task && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  task.status === 'SUCCESS'
                    ? 'bg-emerald-50 text-emerald-700'
                    : task.status === 'FAILED'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-blue-50 text-blue-700'
                }`}
              >
                {statusLabel(task.status)}
              </span>
            )}
          </div>

          {task?.status === 'SUCCESS' && task.imageUrl ? (
            <div className="overflow-hidden rounded-xl bg-gray-100">
              {/* imageUrl is a dynamic, signed MinIO URL; it is not a static Next Image host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={task.imageUrl} alt={task.prompt} className="h-auto w-full object-contain" />
            </div>
          ) : task && (task.status === 'PENDING' || task.status === 'PROCESSING') ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-gray-50 px-6 text-center">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
              <p className="font-medium text-gray-700">{task.status === 'PENDING' ? '任务排队中' : '正在绘制你的图片'}</p>
              <p className="mt-2 text-sm text-gray-400">可以离开页面，回来后会自动恢复任务状态。</p>
            </div>
          ) : task?.status === 'FAILED' ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-red-50 px-6 text-center">
              <p className="font-medium text-red-700">这次生成没有完成</p>
              <p className="mt-2 text-sm text-red-600">{task.errorMessage || '上游服务返回失败，请稍后重试。'}</p>
            </div>
          ) : (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-6 text-center">
              <div className="mb-4 text-4xl">✦</div>
              <p className="font-medium text-gray-600">你的下一张图片会出现在这里</p>
              <p className="mt-2 text-sm text-gray-400">提交提示词后，任务状态和结果会实时更新。</p>
            </div>
          )}

          {task && (
            <div className="mt-4 space-y-2 text-xs text-gray-500">
              <div className="flex justify-between gap-4">
                <span>模型</span>
                <span className="font-medium text-gray-700">{task.model}</span>
              </div>
              {task.cost !== null && (
                <div className="flex justify-between gap-4">
                  <span>费用</span>
                  <span className="font-medium text-gray-700">¥{task.cost.toFixed(4)}</span>
                </div>
              )}
              <p className="line-clamp-3 pt-1 text-gray-400">{task.prompt}</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:col-span-2 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">History</p>
              <h2 className="mt-1 text-xl font-semibold">最近生成</h2>
            </div>
            <Link className="text-sm font-medium text-blue-600 hover:text-blue-700" href="/history">
              查看全部
            </Link>
          </div>

          {loadingHistory ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-32 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">还没有生图记录</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {history.map((historyTask) => (
                <button
                  type="button"
                  key={historyTask.id}
                  onClick={() => handleHistorySelect(historyTask)}
                  className="group overflow-hidden rounded-xl border border-gray-200 text-left transition hover:border-blue-300 hover:shadow-sm"
                >
                  {historyTask.imageUrl ? (
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={historyTask.imageUrl} alt={historyTask.prompt} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="flex h-32 items-center justify-center bg-gray-50 text-xs text-gray-400">
                      {statusLabel(historyTask.status)}
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-gray-700">{historyTask.model}</span>
                      <span className="shrink-0 text-gray-400">{formatDate(historyTask.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-400">{historyTask.prompt}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
