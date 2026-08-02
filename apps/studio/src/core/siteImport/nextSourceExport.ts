import { strToU8, zipSync, type Zippable } from 'fflate'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FileMap } from './types'
import {
  NextSourceExportManifestSchema,
  NextSourceExportRequestSchema,
  NextSourceGitHubExportReceiptSchema,
  NextSourceGitHubExportRequestSchema,
  type NextSourceExportAdapter,
  type NextSourceExportManifest,
  type NextSourceExportRequest,
  type NextSourceGitHubExportReceipt,
  type NextSourceGitHubExportRequest,
} from './nextSourcePortabilityContracts'

const SECRET_PATTERN = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|PAYSTACK_SECRET|GITHUB_TOKEN|PASSWORD_HASH|SESSION_SECRET)/i
const PRIVATE_IMPORT = /(?:from\s+|import\s*\()\s*["'](?:@fuma\/(?:studio|server)|\.\.\/.*(?:server|apps\/studio))/
const ENVIRONMENT_ACCESS = /\b(?:process\.env|import\.meta\.env)\b/
const EXPORT_CODE_PATH = /\.(?:js|jsx|ts|tsx|mjs|cjs|mdx)$/
const EXPORT_IMPORT = /(?:\bfrom\s*|\bimport\s*(?:type\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g
const EXPORTED_PUBLIC_APIS = new Set([
  'next', 'next/head', 'next/image', 'next/link', 'next/navigation',
  'react', 'react/compiler-runtime', 'react/jsx-dev-runtime', 'react/jsx-runtime',
  'react-dom', 'react-dom/client',
])

export interface NextSourceGitHubExportPort {
  branchExists(owner: string, repository: string, branch: string): Promise<boolean>
  createBranch(input: Readonly<{ owner: string; repository: string; branch: string; baseCommitSha: string }>): Promise<void>
  createCommit(input: Readonly<{ owner: string; repository: string; branch: string; expectedHeadSha: string; files: FileMap; message: string }>): Promise<string>
  openPullRequest(input: Readonly<{ owner: string; repository: string; head: string; base: string; title: string; body: string }>): Promise<Readonly<{ number: number; url: string }>>
}

export type NextSourceExportArtifact = Readonly<{
  files: FileMap
  archive: Uint8Array
  manifest: NextSourceExportManifest
}>

function assertSafeBranch(branch: string): void {
  const segments = branch.split('/')
  if (
    branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')
    || branch.includes('..') || branch.includes('//') || branch.includes('@{')
    || /[\s\\~^:?*[\]]/.test(branch)
    || segments.some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock'))
  ) throw new Error(`Unsafe Git branch name: ${branch}`)
}

function assertCommitSha(value: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('GitHub export returned an invalid commit SHA.')
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? strToU8(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeJson(value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (SECRET_PATTERN.test(text)) throw new Error('Secret-shaped content cannot be exported.')
  return text
}

function routeFile(path: string, kind: 'page' | 'raw-html' = 'page'): string {
  if (!path.startsWith('/') || path.includes('\\') || path.includes('?') || path.includes('#')) {
    throw new Error(`Unsafe export route path: ${path}`)
  }
  const segments = path === '/' ? [] : path.slice(1).split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^:?[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(segment))) {
    throw new Error(`Unsafe export route path: ${path}`)
  }
  const clean = segments.map((segment) => segment.startsWith(':') ? `[${segment.slice(1)}]` : segment).join('/')
  return `app/${clean ? `${clean}/` : ''}${kind === 'raw-html' ? 'route.ts' : 'page.tsx'}`
}

function adapterSource(adapter: NextSourceExportAdapter): string {
  const typeName = `${adapter[0]!.toUpperCase()}${adapter.slice(1)}Adapter`
  return `export interface ${typeName} {\n  read(input: Readonly<Record<string, string>>): Promise<unknown>\n  mutate?(input: unknown): Promise<unknown>\n}\n\nexport function unavailable${typeName}(): ${typeName} {\n  return { async read() { throw new Error('${adapter} adapter is not configured') } }\n}\n`
}

function assertExportText(path: string, text: string): void {
  if (SECRET_PATTERN.test(text)) throw new Error(`Secret-shaped value rejected from export path ${path}.`)
  if (PRIVATE_IMPORT.test(text)) throw new Error(`Private Fuma import rejected from export path ${path}.`)
  if (ENVIRONMENT_ACCESS.test(text)) throw new Error(`Environment access rejected from export path ${path}; use a replaceable adapter.`)
  if (!EXPORT_CODE_PATH.test(path)) return
  if (/\bimport\s*\(/.test(text)) throw new Error(`Dynamic import rejected from export path ${path}.`)
  EXPORT_IMPORT.lastIndex = 0
  for (const match of text.matchAll(EXPORT_IMPORT)) {
    const specifier = match[1]!
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) continue
    if (!EXPORTED_PUBLIC_APIS.has(specifier)) {
      throw new Error(`Unsupported export import "${specifier}" at ${path}.`)
    }
  }
}

export async function buildNextSourceExport(requestValue: NextSourceExportRequest): Promise<NextSourceExportArtifact> {
  const parsed = safeParseValue(NextSourceExportRequestSchema, requestValue)
  if (!parsed.ok) throw new Error('Invalid complete Next.js export request.')
  const request = parsed.value
  const textFiles: Record<string, string> = {
    'package.json': safeJson({
      name: request.siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exported-site',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: { next: '16.2.9', react: '19.2.5', 'react-dom': '19.2.5' },
      devDependencies: { '@types/node': '24.12.2', '@types/react': '19.2.14', '@types/react-dom': '19.2.3', typescript: '6.0.3' },
    }),
    'bun.lock': safeJson({ lockfileVersion: 1, workspace: { dependencies: { next: '16.2.9', react: '19.2.5', 'react-dom': '19.2.5' } } }),
    'next.config.ts': "import type { NextConfig } from 'next'\nconst config: NextConfig = { output: 'standalone' }\nexport default config\n",
    'tsconfig.json': safeJson({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', plugins: [{ name: 'next' }] }, include: ['**/*.ts', '**/*.tsx', '.next/types/**/*.ts'], exclude: ['node_modules'] }),
    '.gitignore': '.next\nnode_modules\n.env\n.env.local\n',
    '.env.example': '# Re-enter destination credentials. Never copy secrets from Fuma.\nNEXT_PUBLIC_SITE_URL=https://example.com\n',
    'app/layout.tsx': `import './globals.css'\nexport default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html> }\n`,
    'app/globals.css': ':root { color-scheme: light dark; }\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n',
    'content/snapshot.json': safeJson(request.contentSnapshot),
    'README.md': `# ${request.siteName}\n\nSelf-contained Next.js App Router export from immutable release \`${request.releaseId}\`.\n\nBackend contracts in \`lib/adapters\` are replaceable. Copy no credentials; configure the destination explicitly.\n`,
  }
  for (const route of [...request.routes].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = routeFile(route.path, route.kind ?? 'page')
    if (textFiles[path]) throw new Error(`Export route collision at ${path}.`)
    textFiles[path] = route.source
  }
  for (const adapter of [...request.adapters].sort()) textFiles[`lib/adapters/${adapter}.ts`] = adapterSource(adapter)
  for (const [path, text] of Object.entries(textFiles)) assertExportText(path, text)

  const fileHashes: Record<string, string> = {}
  const files: FileMap = { files: {} }
  for (const [path, text] of Object.entries(textFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = strToU8(text)
    files.files[path] = { bytes }
    fileHashes[path] = await sha256(bytes)
  }
  for (const [path, value] of Object.entries(request.assets).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith('public/') || path.includes('..') || path.includes('\\')) throw new Error(`Unsafe export asset path: ${path}`)
    if (files.files[path]) throw new Error(`Export asset collides with generated path ${path}.`)
    let bytes: Uint8Array
    if (typeof value === 'string') {
      assertExportText(path, value)
      bytes = strToU8(value)
    } else {
      const binary = atob(value.content)
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    }
    files.files[path] = { bytes }
    fileHashes[path] = await sha256(bytes)
  }
  const repositoryHashSha256 = await sha256(canonical(fileHashes))
  const manifestValue = {
    schemaVersion: 1,
    exportId: request.exportId,
    destination: request.destination,
    releaseId: request.releaseId,
    releaseHashSha256: request.releaseHashSha256,
    sourceSnapshotId: request.sourceSnapshotId,
    sourceSnapshotHashSha256: request.sourceSnapshotHashSha256,
    documentHashSha256: request.documentHashSha256,
    sourceRevisionId: request.sourceRevisionId,
    repositoryHashSha256,
    fileHashes,
    adapters: request.adapters,
    containsSecrets: false,
    privateFumaImports: false,
  }
  const checkedManifest = safeParseValue(NextSourceExportManifestSchema, manifestValue)
  if (!checkedManifest.ok) throw new Error('Next.js export manifest failed strict validation.')
  const manifestText = safeJson(checkedManifest.value)
  files.files['fuma-export.json'] = { bytes: strToU8(manifestText) }
  const zipEntries: Zippable = {}
  for (const [path, entry] of Object.entries(files.files).sort(([a], [b]) => a.localeCompare(b))) {
    zipEntries[path] = [entry.bytes, { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') }]
  }
  return { files, archive: zipSync(zipEntries), manifest: checkedManifest.value }
}

export async function exportNextSourceToGitHub(
  artifact: NextSourceExportArtifact,
  requestValue: NextSourceGitHubExportRequest,
  port: NextSourceGitHubExportPort,
): Promise<NextSourceGitHubExportReceipt> {
  const parsed = safeParseValue(NextSourceGitHubExportRequestSchema, requestValue)
  if (!parsed.ok) throw new Error('Invalid GitHub branch/PR export request.')
  const request = parsed.value
  assertSafeBranch(request.baseBranch)
  assertSafeBranch(request.branch)
  if (request.branch === request.baseBranch) throw new Error('Export cannot write the selected base/default branch.')
  if (await port.branchExists(request.owner, request.repository, request.branch)) {
    throw new Error('Export branch already exists; non-overwriting policy denied the write.')
  }
  await port.createBranch({ owner: request.owner, repository: request.repository, branch: request.branch, baseCommitSha: request.baseCommitSha })
  const commitSha = await port.createCommit({
    owner: request.owner,
    repository: request.repository,
    branch: request.branch,
    expectedHeadSha: request.baseCommitSha,
    files: artifact.files,
    message: `Export ${artifact.manifest.exportId}`,
  })
  assertCommitSha(commitSha)
  const pullRequest = await port.openPullRequest({ owner: request.owner, repository: request.repository, head: request.branch, base: request.baseBranch, title: request.title, body: request.body })
  const expectedPullRequestUrl = `https://github.com/${request.owner}/${request.repository}/pull/${pullRequest.number}`
  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1 || pullRequest.url !== expectedPullRequestUrl) {
    throw new Error('GitHub export returned invalid pull-request provenance.')
  }
  const receipt = {
    owner: request.owner,
    repository: request.repository,
    branch: request.branch,
    baseCommitSha: request.baseCommitSha,
    commitSha,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    defaultBranchWritten: false,
    repositoryHashSha256: artifact.manifest.repositoryHashSha256,
  }
  const checked = safeParseValue(NextSourceGitHubExportReceiptSchema, receipt)
  if (!checked.ok) throw new Error('GitHub export adapter returned invalid provenance.')
  return checked.value
}
