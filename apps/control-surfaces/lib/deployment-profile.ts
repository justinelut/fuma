import { readFumaDeploymentProfile } from '@fuma/brand'

export const FUMA_CONTROL_DEPLOYMENT = readFumaDeploymentProfile({
  FUMA_DEPLOYMENT_ROOT_DOMAIN: process.env.FUMA_DEPLOYMENT_ROOT_DOMAIN,
}, {
  required: process.env.NODE_ENV === 'production',
})
