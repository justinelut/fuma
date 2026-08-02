import { readFumaDeploymentProfile } from '@fuma/brand'
import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const deploymentProfile = readFumaDeploymentProfile(process.env, {
  required: process.env.NODE_ENV === 'production',
})

const config: NextConfig = {
  env: {
    FUMA_DEPLOYMENT_ROOT_DOMAIN: deploymentProfile.rootDomain,
  },
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  reactCompiler: true,
  poweredByHeader: false,
  allowedDevOrigins: ['5174.blyss.co.ke'],
  transpilePackages: ['@fuma/brand', '@fuma/governance-launch'],
  typedRoutes: true,
}

export default config
