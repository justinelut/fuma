import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  reactCompiler: true,
  poweredByHeader: false,
  allowedDevOrigins: ['5174.blyss.co.ke'],
  transpilePackages: ['@fuma/governance-launch'],
  typedRoutes: true,
}

export default config
