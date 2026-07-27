import {
  runFumaRoleMain,
  startFumaRoleRoot,
  type FumaRoleRootOptions,
} from './boot'

import { createFumaJobSchedulerComponentFactory } from '../jobs'

export const FUMA_SCHEDULER_COMPONENTS = ['scheduler-runtime'] as const
const FUMA_PRODUCTION_SCHEDULER_COMPONENTS = ['scheduler-runtime','durable-job-scheduler'] as const

export function startFumaSchedulerRuntime(options: FumaRoleRootOptions = {}) {
  const production=(options.env??process.env).FUMA_ENV==='production'
  const components=production?FUMA_PRODUCTION_SCHEDULER_COMPONENTS:FUMA_SCHEDULER_COMPONENTS
  return startFumaRoleRoot('scheduler', components, options.createComponent||!production ? options : { ...options, createComponent: createFumaJobSchedulerComponentFactory(options.env ? { env: options.env } : {}) })
}

if (import.meta.main) await runFumaRoleMain('scheduler', () => startFumaSchedulerRuntime())
