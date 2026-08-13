import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ailou - AI 聊天生图平台',
  description: '开箱即用的 AI 聊天与 AI 生图',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
