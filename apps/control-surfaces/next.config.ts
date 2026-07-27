import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  reactCompiler: true,
  poweredByHeader: false,
  transpilePackages: ['@fuma/governance-launch'],
  typedRoutes: true,
}

export default config
