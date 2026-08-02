import { safeParseValue } from '@core/utils/typeboxHelpers'
import { ingestInput } from './ingestInput'
import type { FileMap } from './types'
import { NextSourceDestinationSchema, type NextSourceDestination, type NextSourceProvenance } from './nextSourceContracts'
import {
  NextSourceGitHubSelectionSchema,
  NextSourceIngestReceiptSchema,
  type NextSourceGitHubSelection,
  type NextSourceIngestReceipt,
} from './nextSourcePortabilityContracts'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const MAX_SOURCE_FILES = 20_000
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024

export interface NextSourceTokenLease {
  readonly token: string
  readonly expiresAt: string
  release(): Promise<void>
}

export type NextSourceGitHubTokenRequest = Readonly<{
  installationId: string
  owner: string
  repository: string
  permissions: Readonly<{
    contents: 'read' | 'write'
    pullRequests: 'read' | 'write'
  }>
}>

export interface NextSourceGitHubAppTokenPort {
  issueInstallationToken(input: NextSourceGitHubTokenRequest): Promise<NextSourceTokenLease>
}

export interface NextSourceGitHubFetchPort {
  fetch(request: Request): Promise<Response>
}

export type NextSourceLocalInput =
  | Readonly<{ kind: 'zip'; name: string; bytes: Uint8Array }>
  | Readonly<{ kind: 'folder'; name: string; files: File[] }>
  | Readonly<{ kind: 'file-map'; name: string; fileMap: FileMap }>

export type NextSourceIngestResult = Readonly<{
  fileMap: FileMap
  receipt: NextSourceIngestReceipt
}>

function looksLikeRootedNextSource(fileMap: FileMap): boolean {
  const paths = Object.keys(fileMap.files)
  if (paths.some((path) => /^(?:app|pages)\/.+\.(?:js|jsx|ts|tsx|mdx)$/.test(path))) return true
  const manifest = fileMap.files['package.json']
  if (!manifest) return false
  try {
    const value = JSON.parse(new TextDecoder().decode(manifest.bytes)) as { dependencies?: Record<string, unknown> }
    return typeof value.dependencies?.next === 'string'
  } catch {
    return false
  }
}

export function normalizeNextSourceFolderRoot(fileMap: FileMap): FileMap {
  if (looksLikeRootedNextSource(fileMap)) return fileMap
  const entries = Object.entries(fileMap.files)
  if (entries.length === 0 || entries.some(([path]) => !path.includes('/'))) return fileMap
  const roots = new Set(entries.map(([path]) => path.split('/')[0]))
  if (roots.size !== 1) return fileMap
  const [root] = roots
  if (!root) return fileMap
  const prefix = `${root}/`
  const candidate: FileMap = {
    files: Object.fromEntries(entries.map(([path, entry]) => [path.slice(prefix.length), entry])),
    strippedTopLevelFolder: root,
  }
  return looksLikeRootedNextSource(candidate) ? candidate : fileMap
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function checkedDestination(value: NextSourceDestination): NextSourceDestination {
  const parsed = safeParseValue(NextSourceDestinationSchema, value)
  if (!parsed.ok) throw new Error('An explicit organization, workspace, and site destination is required.')
  return parsed.value
}

function assertBoundedFileMap(fileMap: FileMap): void {
  const entries = Object.entries(fileMap.files)
  if (entries.length === 0 || entries.length > MAX_SOURCE_FILES) {
    throw new Error('Imported source has an invalid file count.')
  }
  let totalBytes = 0
  for (const [path, entry] of entries) {
    const segments = path.split('/')
    if (
      !path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)
      || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
    ) throw new Error(`Unsafe imported source path: ${path}`)
    totalBytes += entry.bytes.byteLength
    if (totalBytes > MAX_SOURCE_BYTES) throw new Error('Imported source exceeds the source byte limit.')
  }
  if (totalBytes === 0) throw new Error('Imported Next.js source is empty.')
}

function assertTokenLease(lease: NextSourceTokenLease, now: Date): void {
  if (!lease.token || lease.token.length > 4096 || /[\r\n]/.test(lease.token) || typeof lease.release !== 'function') {
    throw new Error('GitHub App returned an invalid installation token lease.')
  }
  const expiry = Date.parse(lease.expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + 60 * 60_000) {
    throw new Error('GitHub installation token must be valid and expire within one hour.')
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`GitHub archive request failed with status ${response.status}.`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('GitHub archive exceeds the source byte limit.')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      total += item.value.byteLength
      if (total > maxBytes) throw new Error('GitHub archive exceeds the source byte limit.')
      chunks.push(item.value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

async function receiptFor(
  fileMap: FileMap,
  destination: NextSourceDestination,
  provenance: NextSourceProvenance,
  exactCommitSha: string | null,
  now: Date,
): Promise<NextSourceIngestReceipt> {
  const files = await Promise.all(Object.entries(fileMap.files).sort(([a], [b]) => a.localeCompare(b)).map(async ([path, entry]) => ({
    path,
    sizeBytes: entry.bytes.byteLength,
    sha256: await sha256(entry.bytes),
  })))
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  if (files.length === 0 || totalBytes === 0) throw new Error('Imported Next.js source is empty.')
  const sourceHashSha256 = await sha256(canonical(files))
  const value = {
    receiptId: `next-ingest:${sourceHashSha256.slice(0, 24)}`,
    destination,
    provenance,
    exactCommitSha,
    sourceHashSha256,
    fileCount: files.length,
    totalBytes,
    tokenPersisted: false,
    scriptsExecuted: false,
    packagesInstalled: false,
    createdAt: now.toISOString(),
  }
  const checked = safeParseValue(NextSourceIngestReceiptSchema, value)
  if (!checked.ok) throw new Error('Next.js source ingestion produced an invalid receipt.')
  return checked.value
}

export async function ingestLocalNextSource(
  input: NextSourceLocalInput,
  destinationValue: NextSourceDestination,
  now = new Date(),
): Promise<NextSourceIngestResult> {
  const destination = checkedDestination(destinationValue)
  const fileMap = input.kind === 'zip'
    ? await ingestInput({ zipBytes: input.bytes }, { maxBytes: MAX_SOURCE_BYTES, maxFiles: MAX_SOURCE_FILES, maxUncompressedZipBytes: MAX_UNCOMPRESSED_BYTES })
    : input.kind === 'folder'
      ? await ingestInput(input.files, { maxBytes: MAX_SOURCE_BYTES, maxFiles: MAX_SOURCE_FILES })
      : await ingestInput({ fileMap: input.fileMap })
  const normalizedFileMap = input.kind === 'folder' ? normalizeNextSourceFolderRoot(fileMap) : fileMap
  assertBoundedFileMap(normalizedFileMap)
  const provenance: NextSourceProvenance = { kind: input.kind, locator: input.name }
  return { fileMap: normalizedFileMap, receipt: await receiptFor(normalizedFileMap, destination, provenance, null, now) }
}

export class GitHubAppNextSourceIngestor {
  readonly #tokens: NextSourceGitHubAppTokenPort
  readonly #transport: NextSourceGitHubFetchPort
  readonly #now: () => Date

  constructor(input: Readonly<{
    tokens: NextSourceGitHubAppTokenPort
    transport: NextSourceGitHubFetchPort
    now?: () => Date
  }>) {
    this.#tokens = input.tokens
    this.#transport = input.transport
    this.#now = input.now ?? (() => new Date())
  }

  async ingest(selectionValue: NextSourceGitHubSelection, destinationValue: NextSourceDestination): Promise<NextSourceIngestResult> {
    const selection = safeParseValue(NextSourceGitHubSelectionSchema, selectionValue)
    if (!selection.ok) throw new Error('Invalid exact GitHub repository/branch/commit selection.')
    const destination = checkedDestination(destinationValue)
    const lease = await this.#tokens.issueInstallationToken({
      installationId: selection.value.installationId,
      owner: selection.value.owner,
      repository: selection.value.repository,
      permissions: { contents: 'read', pullRequests: 'read' },
    })
    const now = this.#now()
    try {
      assertTokenLease(lease, now)
      const url = new URL(`/repos/${encodeURIComponent(selection.value.owner)}/${encodeURIComponent(selection.value.repository)}/zipball/${selection.value.commitSha}`, GITHUB_API_ORIGIN)
      if (url.origin !== GITHUB_API_ORIGIN) throw new Error('GitHub source URL failed fixed-origin policy.')
      const request = new Request(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${lease.token}`,
          'x-github-api-version': '2022-11-28',
        },
      })
      const initial = await this.#transport.fetch(request)
      let response = initial
      if (initial.status >= 300 && initial.status < 400) {
        const location = initial.headers.get('location')
        let codeload: URL
        try { codeload = new URL(location ?? '') } catch { throw new Error('GitHub archive returned an invalid redirect.') }
        const expectedPrefix = `/${selection.value.owner}/${selection.value.repository}/`
        const expectedSuffix = `/${selection.value.commitSha}`
        if (
          codeload.protocol !== 'https:' || codeload.hostname !== 'codeload.github.com' || codeload.port !== ''
          || codeload.username !== '' || codeload.password !== '' || codeload.search !== '' || codeload.hash !== ''
          || !codeload.pathname.startsWith(expectedPrefix) || !codeload.pathname.endsWith(expectedSuffix)
          || !/\/(?:legacy\.zip|zip)\//.test(codeload.pathname)
        ) throw new Error('GitHub archive redirect failed exact codeload policy.')
        response = await this.#transport.fetch(new Request(codeload, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          headers: { accept: 'application/zip' },
        }))
      }
      const archive = await readBoundedBody(response, MAX_SOURCE_BYTES)
      const fileMap = await ingestInput({ zipBytes: archive }, {
        maxBytes: MAX_SOURCE_BYTES,
        maxFiles: MAX_SOURCE_FILES,
        maxUncompressedZipBytes: MAX_UNCOMPRESSED_BYTES,
      })
      assertBoundedFileMap(fileMap)
      const provenance: NextSourceProvenance = {
        kind: 'github',
        locator: `${selection.value.owner}/${selection.value.repository}@${selection.value.branch}`,
        revision: selection.value.commitSha,
      }
      return {
        fileMap,
        receipt: await receiptFor(fileMap, destination, provenance, selection.value.commitSha, now),
      }
    } finally {
      if (typeof lease.release === 'function') await lease.release()
    }
  }
}
