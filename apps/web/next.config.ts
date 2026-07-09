import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@opspilot/types'],
  output: 'standalone', // self-contained server for the Docker image
};

export default nextConfig;
