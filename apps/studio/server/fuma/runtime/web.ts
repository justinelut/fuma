import {
  runFumaRoleMain,
  startFumaRoleRoot,
  type FumaRoleRootOptions,
} from './boot'

export const FUMA_WEB_COMPONENTS = ['web-runtime'] as const

export function startFumaWebRuntime(options?: FumaRoleRootOptions) {
  return startFumaRoleRoot('web', FUMA_WEB_COMPONENTS, options)
}

if (import.meta.main) await runFumaRoleMain('web', () => startFumaWebRuntime())
