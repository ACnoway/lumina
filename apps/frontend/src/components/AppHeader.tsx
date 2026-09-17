"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UserInfo } from "@lumina/shared";
import { getStoredUser, logout } from "@/lib/auth";

export type AppNavKey = "home" | "image" | "chat" | "history" | "profile";

interface AppNavItem {
  href: string;
  label: string;
  key: Exclude<AppNavKey, "home">;
}

interface AppHeaderProps {
  title: string;
  eyebrow?: string;
  active?: AppNavKey;
  items?: AppNavItem[];
  trailing?: ReactNode;
  maxWidth?: "6xl" | "7xl";
  showUserMenu?: boolean;
}

const defaultItems: AppNavItem[] = [
  { href: "/image", label: "AI 生图", key: "image" },
  { href: "/chat", label: "AI 聊天", key: "chat" },
  { href: "/history", label: "历史记录", key: "history" },
];

export default function AppHeader({
  title,
  eyebrow = "Lumina Studio",
  active,
  items = defaultItems,
  trailing,
  maxWidth = "6xl",
  showUserMenu = true,
}: AppHeaderProps) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncUser = () => setUser(getStoredUser());
    syncUser();
    window.addEventListener("storage", syncUser);
    return () => window.removeEventListener("storage", syncUser);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="border-b border-gray-200 bg-white">
      <div
        className={`mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 ${
          maxWidth === "7xl" ? "max-w-7xl" : "max-w-6xl"
        }`}
      >
        <div>
          <Link
            href="/"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 transition hover:text-blue-700"
          >
            {eyebrow}
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <nav
            className="flex flex-wrap items-center gap-1 text-sm text-gray-500"
            aria-label="主导航"
          >
            {items.map((item) => {
              const isActive = active === item.key;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-1.5 transition ${
                    isActive
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "hover:bg-gray-50 hover:text-blue-600"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {trailing}
          {showUserMenu &&
            (user ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label={`${user.email} 用户菜单`}
                  onClick={() => setMenuOpen((current) => !current)}
                  className={`inline-flex max-w-[15rem] items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2 ${
                    active === "profile"
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-blue-700"
                  }`}
                >
                  <span className="max-w-[12rem] truncate">{user.email}</span>
                  <span
                    aria-hidden="true"
                    className={`text-xs transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  >
                    ▼
                  </span>
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="用户菜单"
                    className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <div className="border-b border-gray-100 px-4 py-3">
                      <p className="text-xs text-gray-400">当前账号</p>
                      <p className="mt-1 truncate text-sm font-medium text-gray-700">
                        {user.email}
                      </p>
                    </div>
                    <Link
                      href="/profile"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm text-gray-600 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      个人中心
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={logout}
                      className="block w-full px-4 py-2.5 text-left text-sm text-gray-600 transition hover:bg-red-50 hover:text-red-600"
                    >
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                登录
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
