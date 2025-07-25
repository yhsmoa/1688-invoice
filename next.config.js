/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
  // 외부 접속 허용 설정
  hostname: '0.0.0.0',
  port: 3000
}

module.exports = nextConfig 