import {
  runFumaRoleMain,
  startFumaRoleRoot,
  type FumaRoleRootOptions,
} from './boot'

import { createPublicationWorkerComponentFactory } from '../publication/workerComposition'

export const FUMA_WORKER_COMPONENTS = ['worker-runtime'] as const
const FUMA_PRODUCTION_WORKER_COMPONENTS = ['worker-runtime','durable-job-worker'] as const

export function startFumaWorkerRuntime(options: FumaRoleRootOptions = {}) {
  const production=(options.env??process.env).FUMA_ENV==='production'
  const components=production?FUMA_PRODUCTION_WORKER_COMPONENTS:FUMA_WORKER_COMPONENTS
  return startFumaRoleRoot('worker', components, options.createComponent||!production ? options : { ...options, createComponent: createPublicationWorkerComponentFactory(options.env) })
}

if (import.meta.main) await runFumaRoleMain('worker', () => startFumaWorkerRuntime())
