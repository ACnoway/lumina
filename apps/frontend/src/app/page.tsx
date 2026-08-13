import { redirect } from 'next/navigation';

// 首页暂时重定向到聊天
export default function Home() {
  redirect('/chat');
}
