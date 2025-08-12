/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
  images: {
    domains: ['cbu01.alicdn.com', 'img.alicdn.com', 'ae01.alicdn.com'],
    unoptimized: true,
  }
}

module.exports = nextConfig 