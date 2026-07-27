import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { readFumaConfig } from '../config'
import { logFumaRuntimeEvent, type FumaRuntimeEventLogger } from './events'
import { createRuntimeControlComponent } from './health'
import {
  FumaRuntimeLifecycle,
  type FumaRuntimeComponent,
  type FumaRuntimeRole,
} from './lifecycle'

export const FumaRuntimeSettingsSchema = Type.Object({
  healthPort: Type.Integer({ minimum: 0, maximum: 65_535 }),
  drainTimeoutMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
}, { additionalProperties: false })

export type FumaRuntimeSettings = Static<typeof FumaRuntimeSettingsSchema>
export type FumaRuntimeEnv = Readonly<Record<string, unknown>>

export interface FumaRuntimeComponentFactoryInput {
  id: string
  role: FumaRuntimeRole
  settings: FumaRuntimeSettings
  log: FumaRuntimeEventLogger
}

export type FumaRuntimeComponentFactory = (input: FumaRuntimeComponentFactoryInput) => FumaRuntimeComponent

export interface FumaRoleRootOptions {
  env?: FumaRuntimeEnv
  createComponent?: FumaRuntimeComponentFactory
  log?: FumaRuntimeEventLogger
}

export class FumaRuntimeConfigurationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'FumaRuntimeConfigurationError'
    this.path = path
  }
}

const DEFAULT_HEALTH_PORTS: Readonly<Record<FumaRuntimeRole, number>> = {
  web: 3101,
  worker: 3102,
  scheduler: 3103,
}

function integerSetting(env: FumaRuntimeEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined) return fallback
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new FumaRuntimeConfigurationError(name, `${name} must be an integer.`)
  }
  return Number(raw)
}

export function readFumaRuntimeSettings(
  env: FumaRuntimeEnv,
  role: FumaRuntimeRole,
  environment: 'local' | 'production',
): FumaRuntimeSettings {
  const candidate = {
    healthPort: integerSetting(env, 'FUMA_HEALTH_PORT', DEFAULT_HEALTH_PORTS[role]),
    drainTimeoutMs: integerSetting(env, 'FUMA_DRAIN_TIMEOUT_MS', 30_000),
  }
  const result = safeParseValue(FumaRuntimeSettingsSchema, candidate)
  if (!result.ok) {
    throw new FumaRuntimeConfigurationError('FUMA_RUNTIME', 'Fuma runtime settings are invalid.')
  }
  if (environment === 'production' && result.value.healthPort === 0) {
    throw new FumaRuntimeConfigurationError('FUMA_HEALTH_PORT', 'Production health ports cannot be ephemeral.')
  }
  return result.value
}

function defaultComponentFactory(input: FumaRuntimeComponentFactoryInput): FumaRuntimeComponent {
  return createRuntimeControlComponent({
    id: input.id,
    role: input.role,
    port: input.settings.healthPort,
    log: input.log,
  })
}

export async function startFumaRoleRoot(
  role: FumaRuntimeRole,
  ownedComponentIds: readonly string[],
  options: FumaRoleRootOptions = {},
): Promise<FumaRuntimeLifecycle> {
  const env = options.env ?? process.env
  const config = readFumaConfig(env)
  if (config.role !== role) {
    throw new FumaRuntimeConfigurationError(
      'FUMA_ROLE',
      `The ${role} composition root requires FUMA_ROLE=${role}.`,
    )
  }

  const settings = readFumaRuntimeSettings(env, role, config.environment)
  const log = options.log ?? logFumaRuntimeEvent
  const createComponent = options.createComponent ?? defaultComponentFactory
  const components = ownedComponentIds.map((id) => createComponent({ id, role, settings, log }))
  const runtime = new FumaRuntimeLifecycle({
    role,
    components,
    drainTimeoutMs: settings.drainTimeoutMs,
  })
  await runtime.start()
  log({ event: 'ready', ...runtime.snapshot() })
  return runtime
}

export async function runFumaRoleMain(
  role: FumaRuntimeRole,
  start: () => Promise<FumaRuntimeLifecycle>,
  log: FumaRuntimeEventLogger = logFumaRuntimeEvent,
): Promise<void> {
  let runtime: FumaRuntimeLifecycle | undefined
  let pendingSignal: 'SIGINT' | 'SIGTERM' | undefined
  let shuttingDown = false
  let resolveCompletion: (() => void) | undefined
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const removeSignalHandlers = (): void => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown || pendingSignal) return
    if (!runtime) {
      pendingSignal = signal
      return
    }
    shuttingDown = true
    removeSignalHandlers()
    const activeRuntime = runtime
    const shutdownPromise = activeRuntime.shutdown()
    log({ event: 'draining', signal, ...activeRuntime.snapshot() })
    void shutdownPromise.then(
      () => {
        log({ event: 'stopped', signal, ...activeRuntime.snapshot() })
        resolveCompletion?.()
      },
      (error: unknown) => {
        console.error(`[fuma:${role}] shutdown failed:`, error)
        process.exitCode = 1
        resolveCompletion?.()
      },
    )
  }
  const onSigint = (): void => shutdown('SIGINT')
  const onSigterm = (): void => shutdown('SIGTERM')

  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  try {
    runtime = await start()
    if (pendingSignal) {
      const signal = pendingSignal
      pendingSignal = undefined
      shutdown(signal)
    }
    await completion
  } catch (error) {
    removeSignalHandlers()
    throw error
  }
}
