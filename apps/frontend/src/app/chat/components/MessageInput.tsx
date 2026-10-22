'use client';

import { useState, useRef, useEffect } from 'react';

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
  placeholder: string;
  allowImages: boolean;
}

export default function MessageInput({ onSend, disabled, placeholder, allowImages }: MessageInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [imageError, setImageError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, [text]);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => imagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl)), []);

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
    const invalid = chosen.find((file) => !ACCEPTED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_IMAGE_SIZE);
    if (invalid) {
      setImageError(invalid.size === 0 ? `${invalid.name} 是空文件` : invalid.size > MAX_IMAGE_SIZE
        ? `${invalid.name} 超过 5 MiB`
        : `${invalid.name} 格式不支持，请使用 JPEG、PNG 或 WebP`);
      return;
    }
    setImages((current) => [...current, ...chosen.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removeImage(index: number) {
    const image = images[index];
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function handleSend() {
    const content = text.trim();
    if ((!content && images.length === 0) || disabled || imageError || (images.length > 0 && !allowImages)) return;
    onSend(content, images.map(({ file }) => file));
    images.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
    setText('');
    setImages([]);
    setImageError('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        {images.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {images.map(({ file, previewUrl }, index) => (
              <div key={`${file.name}-${index}`} className="relative">
                <img src={previewUrl} alt={file.name} className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  aria-label={`移除 ${file.name}`}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-sm text-white"
                >×</button>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            ))}
          </div>
        )}
        {(imageError || !allowImages) && (
          <p className={`mb-2 text-xs ${imageError ? 'text-red-600' : 'text-gray-400'}`} role={imageError ? 'alert' : undefined}>
            {imageError || '上传图片需选择已启用识图能力的模型'}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleFiles}
            className="hidden"
            aria-label="选择图片"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || !allowImages || images.length >= MAX_IMAGES}
            title="上传 JPEG、PNG 或 WebP 图片，每张不超过 5 MiB"
            className="rounded-xl border border-gray-300 px-3 py-3 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >图片</button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
            style={{ maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={disabled || (!text.trim() && images.length === 0) || Boolean(imageError) || (images.length > 0 && !allowImages)}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >{disabled ? '发送中...' : '发送'}</button>
        </div>
      </div>
    </div>
  );
}
