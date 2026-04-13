import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.tiktok.com',
      },
      {
        protocol: 'https',
        hostname: '**.tiktokcdn.com',
      },
    ],
  },
};

export default nextConfig;
