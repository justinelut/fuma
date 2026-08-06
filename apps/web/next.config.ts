import createMDX from '@next/mdx'
import { readFumaDeploymentProfile } from '@fuma/brand'
import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const withMDX = createMDX()
const deploymentProfile = readFumaDeploymentProfile(process.env, {
  required: process.env.NODE_ENV === 'production',
})

// React and the Next development client use eval-backed debugging helpers. Permit that source only
// in local/dev mode so interactive acceptance works; production keeps the strict script policy.
const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

const nextConfig: NextConfig = {
  env: {
    FUMA_DEPLOYMENT_ROOT_DOMAIN: deploymentProfile.rootDomain,
  },
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  poweredByHeader: false,
  reactCompiler: true,
  transpilePackages: ['@fuma/brand', '@fuma/design-tokens', '@fuma/public-contracts'],
  typedRoutes: true,
  async headers() {
    const security = [
      { key: 'Content-Security-Policy', value: `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptSource}; connect-src 'self' https://auth.trimly.co.ke; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'; upgrade-insecure-requests` },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    ]
    return [{ source: '/:path*', headers: security }]
  },
}

export default withMDX(nextConfig)
