import createMDX from '@next/mdx'
import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const withMDX = createMDX()

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  poweredByHeader: false,
  reactCompiler: true,
  transpilePackages: ['@fuma/brand', '@fuma/design-tokens', '@fuma/public-contracts'],
  typedRoutes: true,
  async headers() {
    const security = [
      { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://app.fuma.co.ke; upgrade-insecure-requests" },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ]
    return [{ source: '/:path*', headers: security }]
  },
}

export default withMDX(nextConfig)
