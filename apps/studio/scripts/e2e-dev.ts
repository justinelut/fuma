/** Disposable PostgreSQL-backed local server for Playwright E2E tests. */
import { SQL } from 'bun'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { DEFAULT_LOCAL_DATABASE_URL } from '../server/db'
import { bunCommand, viteCommand } from './lib/bunCommand'

const UPLOADS_DIR = './.tmp/e2e-uploads'
const DATABASE_URL_FILE = './.tmp/e2e-database-url'
const CMS_PORT = process.env.E2E_CMS_PORT ?? '3002'
const VITE_PORT = process.env.E2E_VITE_PORT ?? '5174'
const VITE_MODE = process.env.E2E_VITE_MODE === 'preview' ? 'preview' : 'serve'
const ADMIN_ORIGIN = new URL(process.env.E2E_ADMIN_BASE_URL ?? `http://127.0.0.1:${VITE_PORT}`).origin
const E2E_PUBLIC_ORIGINS = [process.env.PUBLIC_ORIGIN, ADMIN_ORIGIN]
  .filter((value): value is string => typeof value === 'string' && value.length > 0)
  .join(',')
const BASE_DATABASE_URL = process.env.E2E_DATABASE_URL
  ?? process.env.TEST_POSTGRES_URL
  ?? process.env.FUMA_TEST_POSTGRES_URL
  ?? process.env.DATABASE_URL
  ?? DEFAULT_LOCAL_DATABASE_URL
const parsed = new URL(BASE_DATABASE_URL)
if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
  throw new TypeError('E2E_DATABASE_URL must use PostgreSQL.')
}
const schema = `test_e2e_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
if (!/^test_e2e_[a-z0-9_]+$/.test(schema)) throw new TypeError('Unsafe E2E schema name.')
const quotedSchema = `"${schema}"`
const admin = new SQL(BASE_DATABASE_URL)
await admin.unsafe(`create schema ${quotedSchema}`)
await admin.close()
const scoped = new URL(BASE_DATABASE_URL)
scoped.searchParams.set('options', `-c search_path=${schema},public`)

await mkdir('./.tmp', { recursive: true })
await writeFile(DATABASE_URL_FILE, scoped.toString(), { mode: 0o600 })
await rm(UPLOADS_DIR, { force: true, recursive: true })

const sharedEnv = {
  ...process.env,
  PORT: CMS_PORT,
  DATABASE_URL: scoped.toString(),
  UPLOADS_DIR,
  PUBLIC_ORIGIN: E2E_PUBLIC_ORIGINS,
  VITE_ALLOWED_ORIGIN: ADMIN_ORIGIN,
  ...(VITE_MODE === 'preview' ? { E2E_PREVIEW_BUILD: '1' } : {}),
}

const children: Bun.Subprocess[] = []
let shuttingDown = false
let cleaned = false

async function cleanupSchema(): Promise<void> {
  if (cleaned) return
  cleaned = true
  const connection = new SQL(BASE_DATABASE_URL)
  try { await connection.unsafe(`drop schema if exists ${quotedSchema} cascade`) }
  finally { await connection.close() }
}

async function shutdown(code: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true
    for (const child of children) if (child.exitCode === null) child.kill(signal)
    await Promise.allSettled(children.map((child) => child.exited))
    await cleanupSchema()
    await rm(DATABASE_URL_FILE, { force: true })
  }
  process.exit(code)
}

if (VITE_MODE === 'preview') {
  const build = Bun.spawnSync(viteCommand('build'), {
    env: sharedEnv, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  })
  if (build.exitCode !== 0) await shutdown(build.exitCode)
}

const viteProcessCommand = VITE_MODE === 'preview'
  ? viteCommand('preview', '--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort')
  : viteCommand('--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort')

for (const command of [bunCommand('server/index.ts'), viteProcessCommand]) {
  const child = Bun.spawn(command, {
    env: sharedEnv, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  })
  children.push(child)
  void child.exited.then((code) => {
    if (!shuttingDown) void shutdown(code ?? 1)
  })
}

process.on('SIGINT', () => { void shutdown(130, 'SIGINT') })
process.on('SIGTERM', () => { void shutdown(143, 'SIGTERM') })
