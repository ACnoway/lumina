import Link from 'next/link';
import AppHeader from '@/components/AppHeader';

const entryCards = [
  {
    href: '/image',
    eyebrow: '01 / IMAGE',
    title: 'AI 生图',
    description: '把灵感变成画面。描述一个场景，选择模型与比例，生成属于你的图片。',
    action: '开始创作',
    symbol: '✦',
    accent: 'from-blue-50 via-white to-indigo-50',
  },
  {
    href: '/chat',
    eyebrow: '02 / CHAT',
    title: 'AI 聊天',
    description: '和 Lumina 一起思考、写作与探索，让每一次对话都从一个好问题开始。',
    action: '开始对话',
    symbol: '◌',
    accent: 'from-sky-50 via-white to-blue-50',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] text-gray-900">
      <AppHeader
        title="AI 创作空间"
        active="home"
        items={entryCards.map(({ href, title }, index) => ({
          href,
          label: title,
          key: index === 0 ? 'image' : 'chat',
        }))}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white px-6 py-10 shadow-sm sm:px-10 sm:py-14">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-blue-100/70 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 right-24 h-56 w-56 rounded-full bg-indigo-100/50 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="mb-4 inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              Make room for ideas
            </p>
            <h2 className="max-w-2xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-gray-950 sm:text-5xl">
              让想法有一个
              <span className="text-blue-600"> 更清晰的出口。</span>
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-gray-500 sm:text-lg">
              Lumina 把 AI 聊天和 AI 生图放在同一个简单、安静的创作空间里。选一个入口，现在就开始。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/image"
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2"
              >
                创作一张图片
              </Link>
              <Link
                href="/chat"
                className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2"
              >
                开始一段对话
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Choose your flow</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">从这里开始</h2>
            </div>
            <span className="hidden text-sm text-gray-400 sm:block">两个入口，一个创作空间</span>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {entryCards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className={`group overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br ${card.accent} p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2 sm:p-7`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{card.eyebrow}</span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-2xl text-blue-600 shadow-sm ring-1 ring-gray-100 transition group-hover:scale-105">
                    {card.symbol}
                  </span>
                </div>
                <h3 className="mt-10 text-2xl font-semibold tracking-tight text-gray-900">{card.title}</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">{card.description}</p>
                <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                  {card.action}
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
