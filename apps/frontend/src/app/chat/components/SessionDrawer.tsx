'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import UiIcon from '@/components/UiIcon';

export default function SessionDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) onClose();
    };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [open, onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="session-drawer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX > bounds.right || event.clientX < bounds.left)
        )
          onClose();
      }}
      className="fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[calc(100%-2rem)] max-w-sm rounded-r-2xl border-0 bg-[#f7f7f5] p-3 text-gray-900 shadow-xl backdrop:bg-gray-900/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between pl-2">
          <h2 id="session-drawer-title" className="text-sm font-semibold">
            管理对话
          </h2>
          <button type="button" onClick={onClose} aria-label="关闭对话记录" className="ui-icon-button">
            <UiIcon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </dialog>
  );
}
