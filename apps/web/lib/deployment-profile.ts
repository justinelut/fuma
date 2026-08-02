import { readFumaDeploymentProfile } from '@fuma/brand'

/** One immutable host profile for a Web build/process; production requires an explicit root. */
export const FUMA_WEB_DEPLOYMENT = readFumaDeploymentProfile({
  FUMA_DEPLOYMENT_ROOT_DOMAIN: process.env.FUMA_DEPLOYMENT_ROOT_DOMAIN,
}, {
  required: process.env.NODE_ENV === 'production',
})
