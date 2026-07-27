/**
 * Disposable local server for automated browser E2E tests.
 *
 * This wrapper owns only the `.tmp/e2e-*` data used by Playwright. It resets
 * that data, then runs the same Vite + Bun CMS stack a developer uses — with one
 * deliberate difference: the CMS runs WITHOUT `--watch`.
 *
 * Why no watch: under `bun --watch`, the publish pipeline writing baked HTML into
 * the uploads dir (and the SQLite DB churning) can trigger a server reload mid
 * test, which drops in-memory state and tears the stack down. A regression suite
 * needs a stable server, so E2E pins one. Vite is additionally told to ignore the
 * runtime-written paths (see `vite.config.ts`), so publishing never reloads the
 * admin app mid-test either.
 */
import { mkdir, rm } from 'node:fs/promises'
import { bunCommand, viteCommand } from './lib/bunCommand'

const DATABASE_PATH = './.tmp/e2e-agent.db'
const UPLOADS_DIR = './.tmp/e2e-uploads'
const CMS_PORT = process.env.E2E_CMS_PORT ?? '3002'
const VITE_PORT = process.env.E2E_VITE_PORT ?? '5174'
const VITE_MODE = process.env.E2E_VITE_MODE === 'preview' ? 'preview' : 'serve'
const ADMIN_ORIGIN = new URL(
  process.env.E2E_ADMIN_BASE_URL ?? `http://127.0.0.1:${VITE_PORT}`,
).origin
const E2E_PUBLIC_ORIGINS = [
  process.env.PUBLIC_ORIGIN,
  ADMIN_ORIGIN,
].filter((value): value is string => typeof value === 'string' && value.length > 0).join(',')

await mkdir('./.tmp', { recursive: true })
await rm(DATABASE_PATH, { force: true })
await rm(`${DATABASE_PATH}-shm`, { force: true })
await rm(`${DATABASE_PATH}-wal`, { force: true })
await rm(UPLOADS_DIR, { force: true, recursive: true })

// Shared by both children: the CMS port drives the Vite dev proxy target, so the
// admin UI talks to this disposable CMS instead of any regular dev server.
const sharedEnv = {
  ...process.env,
  PORT: CMS_PORT,
  DATABASE_URL: `sqlite:${DATABASE_PATH}`,
  UPLOADS_DIR,
  PUBLIC_ORIGIN: E2E_PUBLIC_ORIGINS,
  VITE_ALLOWED_ORIGIN: ADMIN_ORIGIN,
  ...(VITE_MODE === 'preview' ? { E2E_PREVIEW_BUILD: '1' } : {}),
}

const children: Bun.Subprocess[] = []
let shuttingDown = false

if (VITE_MODE === 'preview') {
  const build = Bun.spawnSync(viteCommand('build'), {
    env: sharedEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (build.exitCode !== 0) process.exit(build.exitCode)
}

function stopChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal)
  }
}

const viteProcessCommand = VITE_MODE === 'preview'
  ? viteCommand('preview', '--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort')
  : viteCommand('--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort')

for (const command of [
  bunCommand('server/index.ts'),
  viteProcessCommand,
]) {
  const child = Bun.spawn(command, {
    env: sharedEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(child)
  void child.exited.then((code) => {
    if (shuttingDown) return
    // One half of the stack died on its own — bring the other down and exit so
    // Playwright sees the failure instead of half a stack.
    stopChildren()
    process.exit(code ?? 1)
  })
}

process.on('SIGINT', () => stopChildren('SIGINT'))
process.on('SIGTERM', () => stopChildren('SIGTERM'))
