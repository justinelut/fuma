import { describe, expect, it } from 'bun:test'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { safeParseJson } from '@core/utils/jsonValidate'
import type { FumaRuntimeComponentFactory } from '../../../server/fuma/runtime/boot'
import { FumaRuntimeHealthSchema, runtimeControlHostname } from '../../../server/fuma/runtime/health'
import { FumaRuntimeLifecycle, type FumaRuntimeRole } from '../../../server/fuma/runtime/lifecycle'
import {
  FUMA_SCHEDULER_COMPONENTS,
  startFumaSchedulerRuntime,
} from '../../../server/fuma/runtime/scheduler'
import { FUMA_WEB_COMPONENTS, startFumaWebRuntime } from '../../../server/fuma/runtime/web'
import { FUMA_WORKER_COMPONENTS, startFumaWorkerRuntime } from '../../../server/fuma/runtime/worker'

const ROOT = join(import.meta.dir, '../../..')
const ENTRYPOINTS: Readonly<Record<FumaRuntimeRole, string>> = {
  web: 'server/fuma/runtime/web.ts',
  worker: 'server/fuma/runtime/worker.ts',
  scheduler: 'server/fuma/runtime/scheduler.ts',
}

async function waitForText(stream: ReadableStream<Uint8Array>, needle: string): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const timeout = setTimeout(() => void reader.cancel('timed out'), 3_000)
  try {
    while (!text.includes(needle)) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error(`Process exited before emitting ${needle}. Output: ${text}`)
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
}

function eventPort(output: string): number {
  const match = output.match(/"event":"control-listening"[^\n]*"port":(\d+)/)
  if (!match) throw new Error(`Missing control-listening port in: ${output}`)
  return Number(match[1])
}

interface HttpProbeResult {
  status: number
  body: string
}

function httpGet(url: string): Promise<HttpProbeResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

function spawnRole(role: FumaRuntimeRole, entrypoint = ENTRYPOINTS[role]): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  return Bun.spawn([process.execPath, 'run', entrypoint], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      FUMA_ENV: 'local',
      FUMA_ROLE: role,
      FUMA_HEALTH_PORT: '0',
      FUMA_DRAIN_TIMEOUT_MS: '2000',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

const ROLE_CASES = [
  ['web', FUMA_WEB_COMPONENTS, startFumaWebRuntime],
  ['worker', FUMA_WORKER_COMPONENTS, startFumaWorkerRuntime],
  ['scheduler', FUMA_SCHEDULER_COMPONENTS, startFumaSchedulerRuntime],

] as const

describe('FUMA-005 role composition', () => {
  it('binds health locally by default and only allows the explicit Kubernetes all-interface host', () => {
    expect(runtimeControlHostname({})).toBe('127.0.0.1')
    expect(runtimeControlHostname({ FUMA_HEALTH_HOST: '0.0.0.0' })).toBe('0.0.0.0')
    expect(() => runtimeControlHostname({ FUMA_HEALTH_HOST: 'example.com' })).toThrow('FUMA_HEALTH_HOST')
  })
  it.each(ROLE_CASES)('%s starts only its owned components', async (role, expectedComponents, start) => {
    const started: string[] = []
    const createComponent: FumaRuntimeComponentFactory = ({ id }) => ({
      id,
      start() {
        started.push(id)
      },
    })

    const runtime = await start({
      env: { FUMA_ROLE: role },
      createComponent,
      log() {},
    })
    expect(started).toEqual([...expectedComponents])
    expect(runtime.snapshot().ownedComponents).toEqual([...expectedComponents])
    await runtime.shutdown()
  })

  it('rejects duplicate long-running component ownership', () => {
    expect(() => new FumaRuntimeLifecycle({
      role: 'web',
      drainTimeoutMs: 100,
      components: [
        { id: 'duplicate', start() {} },
        { id: 'duplicate', start() {} },
      ],
    })).toThrow('owned more than once')
  })

  it.each(['web', 'worker', 'scheduler'] as const)('%s exposes distinct health and exits cleanly on SIGTERM', async (role) => {
    const child = spawnRole(role)
    try {
      const startup = await waitForText(child.stderr, '"event":"control-listening"')
      const port = eventPort(startup)
      const healthResponse = await httpGet(`http://127.0.0.1:${port}/healthz`)
      const parsedHealth = safeParseJson(healthResponse.body, FumaRuntimeHealthSchema)
      if (!parsedHealth.ok) throw parsedHealth.error
      const health = parsedHealth.value
      const readinessResponse = await httpGet(`http://127.0.0.1:${port}/readyz`)

      expect(healthResponse.status).toBe(200)
      expect(readinessResponse.status).toBe(200)
      expect(health).toEqual({
        service: 'fuma',
        topology: 'pooled',
        role,
        state: 'ready',
        ownedComponents: [`${role}-runtime`],
        inFlight: 0,
      })

      child.kill('SIGTERM')
      const shutdown = await new Response(child.stderr).text()
      expect(await child.exited).toBe(0)
      expect(shutdown).toContain('"event":"stopped"')
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 8_000)

  it('stops intake and drains in-flight work before SIGTERM shutdown completes', async () => {
    const child = spawnRole('worker', 'src/__tests__/fuma/fixtures/runtimeSignalFixture.ts')
    try {
      const startup = await waitForText(child.stderr, '[fixture] work-started')
      expect(startup).toContain('[fixture] work-started')
      child.kill('SIGTERM')
      const shutdown = await new Response(child.stderr).text()
      expect(await child.exited).toBe(0)

      const intakeStopped = shutdown.indexOf('[fixture] intake-stopped')
      const workFinished = shutdown.indexOf('[fixture] work-finished')
      const componentStopped = shutdown.indexOf('[fixture] component-stopped')
      const runtimeStopped = shutdown.indexOf('"event":"stopped"')
      expect(intakeStopped).toBeGreaterThanOrEqual(0)
      expect(workFinished).toBeGreaterThan(intakeStopped)
      expect(componentStopped).toBeGreaterThan(workFinished)
      expect(runtimeStopped).toBeGreaterThan(componentStopped)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 8_000)
})
