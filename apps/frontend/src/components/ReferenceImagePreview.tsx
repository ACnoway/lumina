'use client';

import type { ImageTaskDto } from '@lumina/shared';
import type { PreviewImage } from './ImageLightbox';

export default function ReferenceImagePreview({ image, onPreview }: {
  image: ImageTaskDto['referenceImage'];
  onPreview: (image: PreviewImage) => void;
}) {
  if (!image) return null;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold text-gray-600">参考图</p>
      <button
        type="button"
        aria-label="查看参考图"
        onClick={() => onPreview({ src: image.url, alt: '参考图', filename: `reference.${image.mimeType.split('/')[1]}` })}
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="参考图" className="h-24 max-w-full rounded-lg object-contain" />
      </button>
    </div>
  );
}
