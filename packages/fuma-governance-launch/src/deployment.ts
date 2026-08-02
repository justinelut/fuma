import { readFumaDeploymentProfile } from '@fuma/brand'

export const FUMA_GOVERNANCE_DEPLOYMENT = readFumaDeploymentProfile(process.env, {
  required: process.env.NODE_ENV === 'production' || process.env.CI === 'true',
})
