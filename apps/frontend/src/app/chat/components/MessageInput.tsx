'use client';

import { useState, useRef, useEffect } from 'react';
import UiIcon from '@/components/UiIcon';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface SelectedImage {
  file: File;
  previewUrl: string;
}

interface MessageInputProps {
  onSend: (content: string, images: File[]) => void;
  disabled: boolean;
  sending: boolean;
  placeholder: string;
  allowImages: boolean;
}

export default function MessageInput({
  onSend,
  disabled,
  sending,
  placeholder,
  allowImages,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [imageError, setImageError] = useState('');
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const attachmentsRef = useRef<HTMLDivElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentPanelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, [text]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => () => imagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl)), []);
  useEffect(() => {
    setImageError('');
  }, [allowImages]);
  useEffect(() => {
    if (disabled) setAttachmentsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!attachmentsOpen) return;
    attachmentPanelRef.current?.focus();
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !attachmentsRef.current?.contains(event.target))
        setAttachmentsOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAttachmentsOpen(false);
        attachmentButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [attachmentsOpen]);

  const uploadReason = sending
    ? '消息发送中，请稍候添加图片'
    : disabled
      ? '请先选择可用的对话模型'
      : !allowImages
        ? '当前模型不支持图片，请切换到标有“支持图片”的模型'
        : images.length >= MAX_IMAGES
          ? '已选满 4 张图片，可移除后重新添加'
          : '';

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    setImageError('');
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!chosen.length) return;
    if (!allowImages) {
      setImageError('当前模型未启用图片识别，请选择支持识图的模型');
      return;
    }
    if (images.length + chosen.length > MAX_IMAGES) {
      setImageError(`每条消息最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }
    const invalid = chosen.find(
      (file) => !ACCEPTED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_IMAGE_SIZE,
    );
    if (invalid) {
      setImageError(
        invalid.size === 0
          ? `${invalid.name} 是空文件`
          : invalid.size > MAX_IMAGE_SIZE
            ? `${invalid.name} 超过 5 MiB`
            : `${invalid.name} 格式不支持，请使用 JPEG、PNG 或 WebP`,
      );
      return;
    }
    setImages((current) => [
      ...current,
      ...chosen.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removeImage(index: number) {
    const image = images[index];
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setImageError('');
  }

  function handleSend() {
    const content = text.trim();
    if ((!content && images.length === 0) || disabled || (images.length > 0 && !allowImages)) return;
    onSend(
      content,
      images.map(({ file }) => file),
    );
    images.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
    setText('');
    setImages([]);
    setImageError('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="shrink-0 rounded-b-2xl border-t border-gray-100 bg-white p-3 sm:p-5">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-gray-300 bg-white p-2 shadow-sm transition focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
          {images.length > 0 && (
            <div className="px-2 pb-2 pt-1">
              <p className="ui-caption mb-2" role="status">
                已选 {images.length}/{MAX_IMAGES} 张 · 发送消息时一并上传
              </p>
              <div className="flex flex-wrap gap-3">
                {images.map(({ file, previewUrl }, index) => (
                  <div key={`${file.name}-${index}`} className="relative">
                    {/* Local attachment previews use temporary object URLs. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      aria-label={`移除 ${file.name}`}
                      disabled={sending}
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <UiIcon name="close" className="h-4 w-4" />
                    </button>
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                      {(file.size / 1024 / 1024).toFixed(1)} MiB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="聊天消息"
            aria-describedby="chat-input-hint"
            disabled={disabled}
            rows={2}
            className="block min-h-[72px] w-full resize-none rounded-xl border-0 bg-transparent px-3 py-2 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-500 focus-visible:outline-none disabled:opacity-60"
            style={{ maxHeight: '200px' }}
          />
          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={Boolean(uploadReason)}
              onChange={handleFiles}
              className="hidden"
              aria-label="选择图片"
            />
            <div
              ref={attachmentsRef}
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setAttachmentsOpen(false);
              }}
            >
              <button
                ref={attachmentButtonRef}
                type="button"
                onClick={() => setAttachmentsOpen((open) => !open)}
                disabled={sending}
                title="添加附件"
                aria-label="添加附件"
                aria-expanded={attachmentsOpen}
                aria-controls={attachmentsOpen ? 'chat-attachments' : undefined}
                className={`ui-icon-button ${attachmentsOpen ? 'bg-blue-50 text-blue-700' : ''}`}
              >
                <UiIcon name="plus" />
              </button>
              {attachmentsOpen && (
                <div
                  ref={attachmentPanelRef}
                  id="chat-attachments"
                  role="group"
                  aria-label="添加附件"
                  tabIndex={-1}
                  className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg outline-none"
                >
                  <button
                    type="button"
                    disabled={Boolean(uploadReason)}
                    onClick={() => {
                      fileInputRef.current?.click();
                      setAttachmentsOpen(false);
                      attachmentButtonRef.current?.focus();
                    }}
                    className="ui-button w-full justify-start text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <UiIcon name="image" />
                    上传图片
                  </button>
                  <p className="ui-caption px-3 pb-2">
                    {uploadReason || 'JPEG、PNG、WebP · 每张 ≤ 5 MiB · 最多 4 张'}
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={
                disabled || (!text.trim() && images.length === 0) || (images.length > 0 && !allowImages)
              }
              className="ui-button-primary"
            >
              <UiIcon name="send" className="h-4 w-4" />
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
        {imageError && (
          <div
            className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"
            role="alert"
          >
            <p className="min-w-0 break-words py-1">{imageError}；未添加本次所选图片。</p>
            <button
              type="button"
              onClick={() => setImageError('')}
              aria-label="关闭图片错误提示"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-red-100"
            >
              <UiIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}
        <p id="chat-input-hint" className="ui-caption mt-2 px-1">
          {images.length > 0 && !allowImages
            ? '已选图片需要支持图片的模型；请切换模型或移除图片后发送。'
            : uploadReason || '点击 ＋ 添加图片'}
          <span className="hidden sm:inline"> · Enter 发送，Shift + Enter 换行</span>
        </p>
      </div>
    </div>
  );
}
