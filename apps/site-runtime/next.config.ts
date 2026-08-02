import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
  reactCompiler: true,
  typedRoutes: true,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }]
  },
}

export default nextConfig
