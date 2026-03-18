import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // In dev mode, proxy API calls to the gateway on port 7600
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:7600/api/:path*' },
      { source: '/job', destination: 'http://localhost:7600/job' },
      { source: '/job/:path*', destination: 'http://localhost:7600/job/:path*' },
      { source: '/jobs', destination: 'http://localhost:7600/jobs' },
      { source: '/health', destination: 'http://localhost:7600/health' },
      { source: '/automation/:path*', destination: 'http://localhost:7600/automation/:path*' },
    ];
  },
};

export default nextConfig;
