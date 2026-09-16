import Link from 'next/link';

export type AppNavKey = 'home' | 'image' | 'chat' | 'history';

interface AppNavItem {
  href: string;
  label: string;
  key: Exclude<AppNavKey, 'home'>;
}

interface AppHeaderProps {
  title: string;
  eyebrow?: string;
  active?: AppNavKey;
  items?: AppNavItem[];
  trailing?: React.ReactNode;
  maxWidth?: '6xl' | '7xl';
}

const defaultItems: AppNavItem[] = [
  { href: '/image', label: 'AI 生图', key: 'image' },
  { href: '/chat', label: 'AI 聊天', key: 'chat' },
  { href: '/history', label: '历史记录', key: 'history' },
];

export default function AppHeader({
  title,
  eyebrow = 'Lumina Studio',
  active,
  items = defaultItems,
  trailing,
  maxWidth = '6xl',
}: AppHeaderProps) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div
        className={`mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 ${
          maxWidth === '7xl' ? 'max-w-7xl' : 'max-w-6xl'
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
          <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="主导航">
            {items.map((item) => {
              const isActive = active === item.key;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-1.5 transition ${
                    isActive
                      ? 'bg-blue-50 font-medium text-blue-700'
                      : 'hover:bg-gray-50 hover:text-blue-600'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {trailing}
        </div>
      </div>
    </header>
  );
}
