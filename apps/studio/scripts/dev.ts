/**
 * One-command PostgreSQL development server.
 *
 * `bun run dev` starts the local PostgreSQL service when the canonical local
 * URL is used, waits for it to accept connections, then starts the CMS and
 * Vite. A caller-provided PostgreSQL URL is used as-is.
 */

import { join, resolve } from 'node:path'
import { DEFAULT_LOCAL_DATABASE_URL } from '../server/db'
import { bunCommand, viteCommand } from './lib/bunCommand'
import { ensurePortFree } from './lib/freePort'

const CMS_PORT = Number(process.env.PORT ?? '3001')
const VITE_PORT = Number(process.env.VITE_PORT ?? '5173')
const POSTGRES_HOST = '127.0.0.1'
const POSTGRES_PORT = 5433
const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL
const WORKSPACE_ROOT = resolve(import.meta.dir, '../../..')
const COMPOSE_FILE = join(WORKSPACE_ROOT, 'docker-compose.yml')

function composeArgs(...args: string[]): string[] {
  return ['compose', '--project-directory', WORKSPACE_ROOT, '-f', COMPOSE_FILE, ...args]
}

const decoder = new TextDecoder()

function log(msg: string): void {
  console.error(`[dev] ${msg}`)
}

function fail(msg: string): never {
  log(msg)
  process.exit(1)
}

// --- docker helpers -------------------------------------------------------

function dockerInstalled(): boolean {
  const result = Bun.spawnSync(['docker', '--version'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return result.exitCode === 0
}

function dockerDaemonRunning(): boolean {
  const result = Bun.spawnSync(['docker', 'info'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return result.exitCode === 0
}

interface ComposeServiceState {
  state: 'running' | 'exited' | 'paused' | 'created' | 'restarting' | 'dead' | 'absent'
}

/**
 * Reads the state of a compose service. Handles both the NDJSON output
 * from older docker-compose versions and the JSON-array output from newer
 * versions; returns 'absent' when no entry is found.
 */
function getComposeServiceState(service: string): ComposeServiceState['state'] {
  const result = Bun.spawnSync(
    ['docker', ...composeArgs('ps', '--all', '--format', 'json', service)],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) return 'absent'

  const stdout = decoder.decode(result.stdout).trim()
  if (!stdout) return 'absent'

  const parseEntry = (raw: unknown): ComposeServiceState['state'] | null => {
    if (!raw || typeof raw !== 'object') return null
    const entry = raw as { Service?: string; State?: string; Name?: string }
    if (entry.Service !== service) return null
    const state = entry.State?.toLowerCase()
    if (
      state === 'running' ||
      state === 'exited' ||
      state === 'paused' ||
      state === 'created' ||
      state === 'restarting' ||
      state === 'dead'
    ) {
      return state
    }
    return null
  }

  // Newer compose: a single JSON array.
  if (stdout.startsWith('[')) {
    try {
      const arr = JSON.parse(stdout) as unknown[]
      for (const entry of arr) {
        const state = parseEntry(entry)
        if (state) return state
      }
    } catch {
      // fall through to NDJSON
    }
  }

  // Older / default compose: one JSON object per line.
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const state = parseEntry(JSON.parse(trimmed))
      if (state) return state
    } catch {
      // ignore unparseable lines
    }
  }

  return 'absent'
}

function runDocker(args: string[], description: string): void {
  log(description)
  const result = Bun.spawnSync(['docker', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    fail(`\`docker ${args.join(' ')}\` exited with code ${result.exitCode}.`)
  }
}

function ensurePostgresRunning(): void {
  const state = getComposeServiceState('postgres')
  switch (state) {
    case 'running':
      log('Docker postgres is already running.')
      return
    case 'exited':
    case 'created':
    case 'paused':
    case 'restarting':
    case 'dead':
      runDocker(
        composeArgs('start', 'postgres'),
        `Docker postgres is ${state} — starting it...`,
      )
      return
    case 'absent':
      runDocker(
        composeArgs('up', '-d', 'postgres'),
        'Docker postgres container not found — creating it...',
      )
      return
  }
}

function stopAppContainerIfRunning(): void {
  const state = getComposeServiceState('app')
  if (state === 'running') {
    runDocker(
      composeArgs('stop', 'app'),
      'Docker `app` container is running — stopping it (it would conflict with the local cms on port 3001)...',
    )
  }
}

async function waitForPostgresReady(timeoutMs = 60_000): Promise<void> {
  log(`Waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}...`)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = Bun.spawnSync(
      ['docker', ...composeArgs(
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        'instatic',
        '-d',
        'instatic',
      )],
      { stdout: 'ignore', stderr: 'ignore' },
    )
    if (result.exitCode === 0) {
      log('Postgres is accepting connections.')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  fail(`Postgres did not become ready within ${timeoutMs}ms.`)
}

// --- main -----------------------------------------------------------------

const parsedDatabaseUrl = new URL(DATABASE_URL)
if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
  fail('DATABASE_URL must use postgres:// or postgresql://. SQLite is no longer supported.')
}
const usesManagedLocalPostgres = parsedDatabaseUrl.hostname === POSTGRES_HOST
  && Number(parsedDatabaseUrl.port || '5432') === POSTGRES_PORT
if (usesManagedLocalPostgres) {
  if (!dockerInstalled()) {
    fail('Docker is not installed. Install Docker, or point DATABASE_URL at an existing PostgreSQL server.')
  }
  if (!dockerDaemonRunning()) {
    fail('Docker daemon is not running. Start Docker, or point DATABASE_URL at an existing PostgreSQL server.')
  }
  ensurePostgresRunning()
  stopAppContainerIfRunning()
  await waitForPostgresReady()
} else {
  log(`Using configured PostgreSQL server at ${parsedDatabaseUrl.hostname}:${parsedDatabaseUrl.port || '5432'}.`)
}

await ensurePortFree(CMS_PORT, 'cms', log)
await ensurePortFree(VITE_PORT, 'vite', log)

log('')
log(`Open the editor at:  http://localhost:${VITE_PORT}`)
log(`CMS API runs on:     http://localhost:${CMS_PORT} (you usually don't open this directly)`)
log('')

// --- spawn cms + vite -----------------------------------------------------

interface DevProcess {
  name: string
  command: string[]
  env?: Record<string, string>
}

const processes: DevProcess[] = [
  {
    name: 'cms',
    command: bunCommand('--watch', 'server/index.ts'),
    env: {
      PORT: String(CMS_PORT),
      DATABASE_URL,
      STATIC_DIR: process.env.STATIC_DIR ?? './dist',
      UPLOADS_DIR: process.env.UPLOADS_DIR ?? './uploads',
    },
  },
  {
    name: 'vite',
    command: viteCommand('--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'),
  },
]

const children: Bun.Subprocess[] = []
let shuttingDown = false

function stopChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal)
  }
}

for (const cfg of processes) {
  const child = Bun.spawn(cfg.command, {
    env: { ...process.env, ...cfg.env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(child)
  void child.exited.then((code) => {
    if (shuttingDown) return
    shuttingDown = true
    stopChildren()
    process.exit(code)
  })
}

process.on('SIGINT', () => {
  shuttingDown = true
  stopChildren('SIGINT')
})

process.on('SIGTERM', () => {
  shuttingDown = true
  stopChildren('SIGTERM')
})
