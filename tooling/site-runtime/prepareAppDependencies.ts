import { lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dir, '../..')
const APP = join(ROOT, 'apps/site-runtime')
const SOURCE = join(ROOT, 'apps/web/node_modules')
const TARGET = join(APP, 'node_modules')
const EXPECTED_LOCK = '8601be172f0b8d80a785e9a57183c0fa3b55be66c812bfefd715b5e72c0d1b1a'
const manifest = JSON.parse(readFileSync(join(APP, 'runtime.manifest.json'), 'utf8')) as { dependencies: Record<string, string> }

const lockHash = createHash('sha256').update(readFileSync(join(ROOT, 'bun.lock'))).digest('hex')
if (lockHash !== EXPECTED_LOCK) throw new Error('SITE-003 refuses an unapproved root lockfile.')

for (const name of ['@sinclair/typebox', 'next', 'react', 'react-dom', 'postcss', '@tailwindcss/postcss', 'tailwindcss'] as const) {
  const packageFile = join(SOURCE, name, 'package.json')
  const installed = JSON.parse(readFileSync(packageFile, 'utf8')) as { version: string }
  if (installed.version !== manifest.dependencies[name]) throw new Error(`${name} does not match the exact SITE-003 runtime manifest.`)
}

const desired = relative(dirname(TARGET), SOURCE)
try {
  const state = lstatSync(TARGET)
  if (!state.isSymbolicLink()) throw new Error('apps/site-runtime/node_modules must remain generated and untracked.')
  if (readlinkSync(TARGET) === desired) process.exit(0)
  rmSync(TARGET)
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { /* create below */ }
  else throw error
}
symlinkSync(desired, TARGET, 'dir')
