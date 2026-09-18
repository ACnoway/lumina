'use client';

import { useEffect, useState } from 'react';

export interface PreviewImage {
  src: string;
  alt: string;
  filename: string;
}

async function downloadImage(src: string, filename: string): Promise<void> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`image download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function ImageDownloadButton({
  image,
  className = '',
  compact = false,
}: {
  image: PreviewImage;
  className?: string;
  compact?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadImage(image.src, image.filename);
    } catch {
      // Signed object URLs may reject fetch when the storage CORS policy is restrictive.
      // Opening the signed URL still lets the user save the original image from the browser.
      setDownloadError(true);
      window.open(image.src, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleDownload();
        }}
        disabled={downloading}
        aria-label={`下载${image.alt}`}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-white/70 bg-black/65 px-3 py-2 text-xs font-medium text-white shadow-sm backdrop-blur transition hover:bg-black/80 disabled:cursor-wait disabled:opacity-70 ${className}`}
      >
        <span aria-hidden="true">⇩</span>
        {downloading ? '保存中…' : compact ? '保存' : '下载/保存'}
      </button>
      {downloadError && (
        <span className="rounded bg-black/70 px-2 py-1 text-[10px] text-white">
          已打开原图，请右键保存
        </span>
      )}
    </span>
  );
}

export default function ImageLightbox({
  image,
  onClose,
}: {
  image: PreviewImage | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!image) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片大图预览"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col gap-3">
        <div className="flex items-center justify-between gap-4 text-white">
          <p className="truncate text-sm font-medium">{image.alt}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭大图预览"
            className="shrink-0 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm transition hover:bg-white/20"
          >
            关闭 <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-black/40 p-2 sm:p-4">
          {/* imageUrl is a dynamic, signed MinIO URL; it is not a static Next Image host. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.alt}
            className="max-h-[calc(100vh-170px)] max-w-full object-contain"
          />
        </div>
        <div className="flex justify-end">
          <ImageDownloadButton image={image} />
        </div>
      </div>
    </div>
  );
}
