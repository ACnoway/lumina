import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * 认证保护中间件
 * 未登录用户访问受保护页面时重定向到 /login
 */
const PROTECTED_PATHS = ['/chat', '/image', '/history', '/admin'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 检查是否是受保护路径
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // 从 cookie 或 localStorage 检查 token
  // 注意: middleware 运行在服务端，无法访问 localStorage
  // 这里通过检查 cookie 中的 token 来判断
  const token = request.cookies.get('lumina_token')?.value;

  // 如果没有 cookie token，检查 header 中的 Authorization
  // 最终方案: 前端登录时将 token 也写入 cookie
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*', '/image/:path*', '/history/:path*', '/admin/:path*'],
};
