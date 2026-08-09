#!/usr/bin/env bun
/**
 * Verifies that the Onlook recovery branch changes only the mapped visual
 * editor seam. The baseline is the intact post-cleanup Fuma default commit.
 */
import { existsSync } from 'node:fs'

const BASE_SHA = process.env.FUMA_PRESERVATION_BASE
  ?? '86a74598e8658897a6e3bb9390f8d1c49b25fc49'

const PROTECTED_ROOTS = Object.freeze([
  'apps/control-surfaces',
  'apps/site-runtime',
  'apps/web',
  'apps/studio/src/admin',
  'apps/studio/server',
  'infra/fuma-phase-13-18',
])

const ALLOWED_EDITOR_ADAPTER_FILES = new Set([
  'apps/studio/src/admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx',
  'apps/studio/src/admin/layouts/AdminCanvasLayout/AdminCanvasEditorBody.tsx',
  'apps/studio/src/admin/pages/site/canvas/CanvasRoot.tsx',
  'apps/studio/src/admin/pages/site/canvas/canvasPanInput.ts',
  'apps/studio/src/admin/pages/site/hooks/useCanvas.ts',
  'apps/studio/src/admin/onlook/OnlookStudioSurface.module.css',
  'apps/studio/src/admin/onlook/OnlookStudioToolDock.module.css',
  'apps/studio/src/admin/onlook/OnlookStudioToolDock.tsx',
])

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `git ${args.join(' ')} failed`)
  }
  return new TextDecoder().decode(result.stdout).trim()
}

function protectedPath(path: string): boolean {
  return PROTECTED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
}

function parseChangedPaths(output: string): ReadonlyArray<Readonly<{ status: string; path: string }>> {
  if (!output) return []
  return output.split('\n').flatMap((line) => {
    const fields = line.split('\t')
    const status = fields[0] ?? ''
    const paths = status.startsWith('R') || status.startsWith('C')
      ? fields.slice(1, 3)
      : fields.slice(1, 2)
    return paths.filter(Boolean).map((path) => ({ status, path: path! }))
  })
}

for (const root of PROTECTED_ROOTS) {
  if (!existsSync(root)) throw new Error(`Protected platform root is missing: ${root}`)
}

git(['cat-file', '-e', `${BASE_SHA}^{commit}`])

const tracked = parseChangedPaths(git([
  'diff', '--name-status', BASE_SHA, '--', ...PROTECTED_ROOTS,
]))
const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...PROTECTED_ROOTS])
  .split('\n')
  .filter(Boolean)
  .map((path) => ({ status: '??', path }))
const changes = [...tracked, ...untracked]

const deletions = changes.filter(({ status }) => status.startsWith('D'))
const unexpected = changes.filter(({ path }) => (
  protectedPath(path) && !ALLOWED_EDITOR_ADAPTER_FILES.has(path)
))

if (deletions.length > 0 || unexpected.length > 0) {
  const details = [
    ...deletions.map(({ status, path }) => `${status}\t${path} (deletion forbidden)`),
    ...unexpected.map(({ status, path }) => `${status}\t${path} (outside mapped editor seam)`),
  ]
  throw new Error(`Full-platform preservation check failed:\n${details.join('\n')}`)
}

console.log(
  `preservation=pass base=${BASE_SHA} protected_roots=${PROTECTED_ROOTS.length} allowed_changes=${changes.length}`,
)
