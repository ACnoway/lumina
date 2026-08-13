/** @type {import('next').NextConfig} */
const nextConfig = {
  // 后端 API 代理，避免浏览器跨域问题
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
