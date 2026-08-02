/** Spawn the production server against a disposable PostgreSQL schema. */
import { spawn, SQL } from 'bun'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { DEFAULT_LOCAL_DATABASE_URL } from '../../../server/db'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

export interface ServerHandle {
  baseUrl: string
  port: number
  bootMs: number
  stop(): Promise<void>
  readRssMb(): number | null
}

async function findFreePort(): Promise<number> {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {}, open() {}, close() {}, error() {}, drain() {} },
  })
  const port = server.port
  server.stop()
  return port
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<number> {
  const startedAt = performance.now()
  const deadline = startedAt + timeoutMs
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return performance.now() - startedAt
    } catch {
      // The child is still starting.
    }
    await Bun.sleep(50)
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms`)
}

interface StartOptions {
  logFile?: string
  staticDir?: string
  databaseUrl?: string
}

function baseDatabaseUrl(value: string | undefined): string {
  const url = new URL(value ?? process.env.BENCH_POSTGRES_URL ?? process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL)
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TypeError('Benchmark DATABASE_URL must use PostgreSQL.')
  }
  return url.toString()
}

function quoteSchema(schema: string): string {
  if (!/^bench_[a-z0-9_]+$/.test(schema)) throw new TypeError('Unsafe benchmark schema name.')
  return `"${schema}"`
}

export async function startServer(opts: StartOptions = {}): Promise<ServerHandle> {
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const connection = baseDatabaseUrl(opts.databaseUrl)
  const schema = `bench_server_${process.pid}_${port}_${crypto.randomUUID().replaceAll('-', '')}`
  const quotedSchema = quoteSchema(schema)
  const admin = new SQL(connection)
  await admin.unsafe(`create schema ${quotedSchema}`)
  await admin.close()

  const scoped = new URL(connection)
  scoped.searchParams.set('options', `-c search_path=${schema},public`)
  const benchDir = resolve(REPO_ROOT, '.tmp/benchmarks')
  mkdirSync(benchDir, { recursive: true })

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: scoped.toString(),
  }
  if (opts.staticDir) env.STATIC_DIR = opts.staticDir

  const logFile = opts.logFile ?? resolve(benchDir, `server-${port}.log`)
  const logHandle = Bun.file(logFile).writer()
  const proc = spawn({
    cmd: ['bun', 'server/index.ts'],
    cwd: REPO_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  void pipeStream(proc.stdout, logHandle)
  void pipeStream(proc.stderr, logHandle)

  const dropSchema = async (): Promise<void> => {
    const cleanup = new SQL(connection)
    try {
      await cleanup.unsafe(`drop schema if exists ${quotedSchema} cascade`)
    } finally {
      await cleanup.close()
    }
  }

  const bootMs = await waitForHealth(baseUrl).catch(async (error) => {
    proc.kill()
    await proc.exited
    await logHandle.flush()
    await dropSchema()
    throw new Error(`${(error as Error).message}\nServer log: ${logFile}`)
  })

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    proc.kill()
    await proc.exited
    await logHandle.flush()
    try {
      logHandle.end()
    } catch {
      // Some Bun versions expose no writer end operation.
    }
    await dropSchema()
  }

  const readRssMb = (): number | null => {
    if (stopped) return null
    try {
      const output = Bun.spawnSync({ cmd: ['/bin/ps', '-o', 'rss=', '-p', String(proc.pid)] })
      const kb = Number(output.stdout.toString().trim())
      return Number.isFinite(kb) ? kb / 1024 : null
    } catch {
      return null
    }
  }

  return { baseUrl, port, bootMs, stop, readRssMb }
}

async function pipeStream(stream: ReadableStream<Uint8Array>, writer: FileSink): Promise<void> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      writer.write(value)
    }
  } finally {
    reader.releaseLock()
  }
}
