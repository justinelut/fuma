#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  parseAndVerifyNativeReceipt,
  parseArchitectureEvidence,
  writeNativeReceipt,
} from '../server/fuma/email/compatibility/evidence'
import { FUMA_EMAIL_CLI_COMMANDS } from '../server/fuma/email/compatibility/versions'

const STUDIO_ROOT = resolve(import.meta.dir, '..')
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, '../..')
const EXPECTED_PLATFORM = process.env.FUMA_EMAIL_EXPECT_PLATFORM
const EXPECTED_ARCH = process.env.FUMA_EMAIL_EXPECT_ARCH
const RECEIPT_PATH = process.env.FUMA_EMAIL_RECEIPT_PATH
const ROOT_LOCK = join(WORKSPACE_ROOT, 'bun.lock')
const ALLOWED_LOCKFILES = new Set(['bun.lock', 'vendor/pixel-art-icons/bun.lock'])
const LOCKFILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.react-email',
  '.tmp',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

if (EXPECTED_PLATFORM !== 'linux' || (EXPECTED_ARCH !== 'arm64' && EXPECTED_ARCH !== 'x64')) {
  throw new Error('FUMA-041 target gate requires linux and an arm64 or x64 architecture')
}
if (process.platform !== EXPECTED_PLATFORM || process.arch !== EXPECTED_ARCH) {
  throw new Error(
    `FUMA-041 target mismatch: expected ${EXPECTED_PLATFORM}/${EXPECTED_ARCH}, received ${process.platform}/${process.arch}`,
  )
}
if (RECEIPT_PATH === undefined || RECEIPT_PATH.trim() === '') {
  throw new Error('FUMA-041 target gate requires FUMA_EMAIL_RECEIPT_PATH')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function run(
  command: string[],
  cwd: string,
  timeoutMs: number,
  environment: Record<string, string | undefined> = process.env,
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const processHandle = Bun.spawn(command, {
    cwd,
    env: { ...environment, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    processHandle.kill('SIGKILL')
  }, timeoutMs)
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    Bun.readableStreamToText(processHandle.stdout),
    Bun.readableStreamToText(processHandle.stderr),
  ]).finally(() => clearTimeout(timeout))
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  if (timedOut) throw new Error(`FUMA-041 target command timed out after ${timeoutMs}ms: ${command.join(' ')}`)
  if (exitCode !== 0) throw new Error(`FUMA-041 target command failed (${exitCode}): ${command.join(' ')}`)
  return { stdout, stderr }
}

function testCounts(output: Readonly<{ stdout: string; stderr: string }>): Readonly<{
  passed: number
  skipped: number
  failed: 0
}> {
  const combined = `${output.stdout}\n${output.stderr}`
  const count = (label: 'pass' | 'skip' | 'fail'): number =>
    Number.parseInt(combined.match(new RegExp(`(\\d+) ${label}`))?.[1] ?? '0', 10)
  const failed = count('fail')
  if (failed !== 0) throw new Error(`FUMA-041 test receipt cannot record ${failed} failures`)
  return { passed: count('pass'), skipped: count('skip'), failed: 0 }
}

async function collectLockfiles(directory: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path)
      } else if (entry.isFile() && LOCKFILE_NAMES.has(entry.name)) {
        found.push(relative(WORKSPACE_ROOT, path).replaceAll('\\', '/'))
      }
    }
  }
  await visit(directory)
  return found.sort()
}

const initialLock = new Uint8Array(await Bun.file(ROOT_LOCK).arrayBuffer())
const initialLockSha256 = sha256(initialLock)
await run([process.execPath, 'install', '--frozen-lockfile'], WORKSPACE_ROOT, 180_000)
const finalLock = new Uint8Array(await Bun.file(ROOT_LOCK).arrayBuffer())
const finalLockSha256 = sha256(finalLock)
if (initialLock.length !== finalLock.length
  || !initialLock.every((byte, index) => finalLock[index] === byte)) {
  throw new Error(`FUMA-041 frozen install changed root lock ${initialLockSha256} -> ${finalLockSha256}`)
}

const unexpectedLockfiles = (await collectLockfiles(WORKSPACE_ROOT))
  .filter((path) => !ALLOWED_LOCKFILES.has(path))
if (unexpectedLockfiles.length > 0) {
  throw new Error(`FUMA-041 found nested install authority: ${unexpectedLockfiles.join(', ')}`)
}

const architectureOutput = await run(
  [process.execPath, 'run', 'server/fuma/email/compatibility/architectureProbe.ts'],
  STUDIO_ROOT,
  60_000,
)
const architectureEvidence = parseArchitectureEvidence(
  JSON.parse(architectureOutput.stdout.trim().split('\n').at(-1)!),
)
const compatibilityOutput = await run([
  process.execPath,
  'test',
  'server/fuma/email/compatibility/compatibility.test.ts',
], STUDIO_ROOT, 900_000)
const rendererOutput = await run([
  process.execPath,
  'test',
  'src/__tests__/fuma/emailDocumentRenderer.test.ts',
  'src/__tests__/architecture/fuma-email-boundaries.test.ts',
], STUDIO_ROOT, 120_000)

const receipt = await parseAndVerifyNativeReceipt({
  ...architectureEvidence,
  receiptKind: 'fuma-email-native-compatibility',
  compatibilityTests: testCounts(compatibilityOutput),
  rendererArchitectureTests: testCounts(rendererOutput),
  cli: FUMA_EMAIL_CLI_COMMANDS,
})
await writeNativeReceipt(RECEIPT_PATH, receipt)
console.log(JSON.stringify(receipt))
