import { createSign } from 'node:crypto'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type {
  NextSourceGitHubAppTokenPort,
  NextSourceGitHubFetchPort,
  NextSourceGitHubTokenRequest,
  NextSourceTokenLease,
} from '@core/siteImport/nextSourceIngestion'
import type { NextSourceGitHubExportPort, NextSourceExportArtifact } from '@core/siteImport/nextSourceExport'
import {
  NextSourceGitHubExportReceiptSchema,
  NextSourceGitHubExportRequestSchema,
  type NextSourceGitHubExportReceipt,
  type NextSourceGitHubExportRequest,
} from '@core/siteImport/nextSourcePortabilityContracts'
import type { FileMap } from '@core/siteImport/types'

const API_ORIGIN = 'https://api.github.com'
const CODELOAD_ORIGIN = 'https://codeload.github.com'
const API_VERSION = '2022-11-28'
const INSTALLATION = /^[1-9][0-9]{0,19}$/
const SHA = /^[a-f0-9]{40}$/
const TokenRequestSchema = Type.Object({
  installationId: Type.String({ pattern: '^[1-9][0-9]{0,19}$' }),
  owner: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9-]*$' }),
  repository: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  permissions: Type.Object({
    contents: Type.Union([Type.Literal('read'), Type.Literal('write')]),
    pullRequests: Type.Union([Type.Literal('read'), Type.Literal('write')]),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
const TokenResponseSchema = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 4096 }),
  expires_at: Type.String({ format: 'date-time' }),
}, { additionalProperties: true })
const RefResponseSchema = Type.Object({
  object: Type.Object({ sha: Type.String({ pattern: '^[a-f0-9]{40}$' }) }, { additionalProperties: true }),
}, { additionalProperties: true })
const CommitResponseSchema = Type.Object({
  sha: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  message: Type.Optional(Type.String()),
  tree: Type.Optional(Type.Object({ sha: Type.String({ pattern: '^[a-f0-9]{40}$' }) }, { additionalProperties: true })),
}, { additionalProperties: true })
const ShaResponseSchema = Type.Object({ sha: Type.String({ pattern: '^[a-f0-9]{40}$' }) }, { additionalProperties: true })
const PullResponseSchema = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  html_url: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: true })
const PullListResponseSchema = Type.Array(Type.Object({
  number: Type.Integer({ minimum: 1 }),
  html_url: Type.String({ minLength: 1, maxLength: 4096 }),
  body: Type.Union([Type.String(), Type.Null()]),
  head: Type.Object({
    ref: Type.String({ minLength: 1, maxLength: 255 }),
    sha: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  }, { additionalProperties: true }),
  base: Type.Object({ ref: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: true }),
}, { additionalProperties: true }), { maxItems: 100 })

type CheckedTokenRequest = Static<typeof TokenRequestSchema>

export type HostedNextSourceGitHubConfig = Readonly<{
  appId: string
  privateKeyPem: string
  userAgent: string
}>

export function readHostedNextSourceGitHubConfig(env: Readonly<Record<string, string | undefined>> = process.env): HostedNextSourceGitHubConfig {
  const appId = env.FUMA_GITHUB_APP_ID?.trim() ?? ''
  const privateKeyPem = env.FUMA_GITHUB_APP_PRIVATE_KEY_PEM?.replaceAll('\\n', '\n').trim() ?? ''
  const userAgent = env.FUMA_GITHUB_USER_AGENT?.trim() ?? 'fuma-next-source-importer/1'
  if (!INSTALLATION.test(appId)) throw new TypeError('FUMA_GITHUB_APP_ID must be a positive decimal GitHub App id.')
  if (!privateKeyPem.startsWith('-----BEGIN') || !privateKeyPem.includes('PRIVATE KEY-----') || !privateKeyPem.endsWith('-----')) throw new TypeError('FUMA_GITHUB_APP_PRIVATE_KEY_PEM must contain a PEM private key.')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/ -]{0,127}$/.test(userAgent) || /[\r\n]/.test(userAgent)) throw new TypeError('FUMA_GITHUB_USER_AGENT is invalid.')
  return Object.freeze({ appId, privateKeyPem, userAgent })
}

function encodedJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function appJwt(config: HostedNextSourceGitHubConfig, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const header = encodedJson({ alg: 'RS256', typ: 'JWT' })
  const payload = encodedJson({ iat: nowSeconds - 30, exp: nowSeconds + 9 * 60, iss: config.appId })
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(config.privateKeyPem).toString('base64url')
  return `${signingInput}.${signature}`
}

function apiUrl(path: string): URL {
  const url = new URL(path, API_ORIGIN)
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) throw new Error('GitHub API URL escaped fixed-origin policy.')
  return url
}

async function checkedJson<T>(response: Response, schema: Parameters<typeof safeParseValue>[0], label: string, expected: readonly number[] = [200, 201]): Promise<T> {
  if (!expected.includes(response.status)) throw new Error(`${label} failed with status ${response.status}.`)
  const raw = await response.json().catch(() => null)
  const parsed = safeParseValue(schema, raw)
  if (!parsed.ok) throw new Error(`${label} returned an invalid response.`)
  return parsed.value as T
}

function headers(config: HostedNextSourceGitHubConfig, token: string): Headers {
  return new Headers({
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': config.userAgent,
    'x-github-api-version': API_VERSION,
  })
}

function checkedTokenRequest(input: NextSourceGitHubTokenRequest): CheckedTokenRequest {
  const parsed = safeParseValue(TokenRequestSchema, input)
  if (!parsed.ok) throw new Error('GitHub installation-token scope is invalid.')
  return parsed.value
}

export class GitHubAppInstallationTokenAuthority implements NextSourceGitHubAppTokenPort {
  readonly #config: HostedNextSourceGitHubConfig
  readonly #fetch: typeof fetch
  readonly #now: () => Date

  constructor(input: Readonly<{ config: HostedNextSourceGitHubConfig; fetch?: typeof fetch; now?: () => Date }>) {
    this.#config = input.config
    this.#fetch = input.fetch ?? globalThis.fetch
    this.#now = input.now ?? (() => new Date())
  }

  async issueInstallationToken(input: NextSourceGitHubTokenRequest): Promise<NextSourceTokenLease> {
    const request = checkedTokenRequest(input)
    const response = await this.#fetch(apiUrl(`/app/installations/${request.installationId}/access_tokens`), {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: headers(this.#config, appJwt(this.#config, this.#now())),
      body: JSON.stringify({
        repositories: [request.repository],
        permissions: {
          contents: request.permissions.contents,
          pull_requests: request.permissions.pullRequests,
        },
      }),
    })
    const issued = await checkedJson<{ token: string; expires_at: string }>(response, TokenResponseSchema, 'GitHub installation-token request')
    let secret = issued.token
    let released = false
    return Object.freeze({
      get token() {
        if (released) throw new Error('GitHub installation token lease is released.')
        return secret
      },
      expiresAt: issued.expires_at,
      async release() {
        secret = ''
        released = true
      },
    })
  }
}

/** Resolves only GitHub's exact API zipball redirect and never forwards Authorization to codeload. */
export class SafeGitHubZipballFetchPort implements NextSourceGitHubFetchPort {
  readonly #fetch: typeof fetch

  constructor(fetchImpl: typeof fetch = globalThis.fetch) { this.#fetch = fetchImpl }

  async fetch(request: Request): Promise<Response> {
    const source = new URL(request.url)
    const match = source.pathname.match(/^\/repos\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/zipball\/([a-f0-9]{40})$/)
    if (source.origin !== API_ORIGIN || !match || source.search || source.hash || request.method !== 'GET') throw new Error('GitHub zipball request failed fixed-origin policy.')
    const first = await this.#fetch(new Request(source, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: request.headers }))
    if (![301, 302, 303, 307, 308].includes(first.status)) return first
    const location = first.headers.get('location')
    if (!location) throw new Error('GitHub zipball redirect omitted its location.')
    const redirected = new URL(location)
    const expectedPaths = new Set([
      `/${match[1]}/${match[2]}/legacy.zip/${match[3]}`,
      `/${match[1]}/${match[2]}/zip/${match[3]}`,
    ])
    if (
      redirected.origin !== CODELOAD_ORIGIN
      || redirected.username
      || redirected.password
      || redirected.search
      || redirected.hash
      || !expectedPaths.has(redirected.pathname)
    ) throw new Error('GitHub zipball redirect escaped the exact codeload allowlist.')
    return await this.#fetch(new Request(redirected, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: {
        accept: 'application/zip',
        'user-agent': request.headers.get('user-agent') ?? 'fuma-next-source-importer/1',
      },
    }))
  }
}

function repoPath(owner: string, repository: string, suffix: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${suffix}`
}

type ExportTokenPermissions = NextSourceGitHubTokenRequest['permissions']

function assertSafeBranch(branch: string): void {
  const segments = branch.split('/')
  if (
    branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')
    || branch.includes('..') || branch.includes('//') || branch.includes('@{')
    || /[\s\\~^:?*[\]]/.test(branch)
    || segments.some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock'))
  ) throw new Error(`Unsafe Git branch name: ${branch}`)
}

export class GitHubAppNextSourceExportAdapter implements NextSourceGitHubExportPort {
  readonly #tokens: NextSourceGitHubAppTokenPort
  readonly #installationId: string
  readonly #config: HostedNextSourceGitHubConfig
  readonly #fetch: typeof fetch

  constructor(input: Readonly<{ tokens: NextSourceGitHubAppTokenPort; installationId: string; config: HostedNextSourceGitHubConfig; fetch?: typeof fetch }>) {
    if (!INSTALLATION.test(input.installationId)) throw new Error('GitHub installation id is invalid.')
    this.#tokens = input.tokens
    this.#installationId = input.installationId
    this.#config = input.config
    this.#fetch = input.fetch ?? globalThis.fetch
  }

  async #withToken<T>(
    owner: string,
    repository: string,
    permissions: ExportTokenPermissions,
    work: (token: string) => Promise<T>,
  ): Promise<T> {
    const lease = await this.#tokens.issueInstallationToken({
      installationId: this.#installationId,
      owner,
      repository,
      permissions,
    })
    try {
      return await work(lease.token)
    } finally {
      await lease.release()
    }
  }

  async #request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
    return await this.#fetch(apiUrl(path), {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      headers: headers(this.#config, token),
    })
  }

  async branchExists(owner: string, repository: string, branch: string): Promise<boolean> {
    return await this.#withToken(owner, repository, { contents: 'read', pullRequests: 'read' }, async (token) => {
      const response = await this.#request(token, repoPath(owner, repository, `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`))
      if (response.status === 404) return false
      await checkedJson(response, RefResponseSchema, 'GitHub branch lookup')
      return true
    })
  }

  async createBranch(input: Readonly<{ owner: string; repository: string; branch: string; baseCommitSha: string }>): Promise<void> {
    await this.#withToken(input.owner, input.repository, { contents: 'write', pullRequests: 'read' }, async (token) => {
      await checkedJson(await this.#request(token, repoPath(input.owner, input.repository, '/git/refs'), {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: input.baseCommitSha }),
      }), RefResponseSchema, 'GitHub branch creation')
    })
  }

  async createCommit(input: Readonly<{ owner: string; repository: string; branch: string; expectedHeadSha: string; files: FileMap; message: string }>): Promise<string> {
    return await this.#withToken(input.owner, input.repository, { contents: 'write', pullRequests: 'read' }, async (token) => {
      const refPath = repoPath(input.owner, input.repository, `/git/ref/heads/${input.branch.split('/').map(encodeURIComponent).join('/')}`)
      const ref = await checkedJson<{ object: { sha: string } }>(await this.#request(token, refPath), RefResponseSchema, 'GitHub branch head')
      if (ref.object.sha !== input.expectedHeadSha) throw new Error('GitHub export branch head changed before commit.')
      const base = await checkedJson<{ sha: string; tree?: { sha: string } }>(await this.#request(token, repoPath(input.owner, input.repository, `/git/commits/${input.expectedHeadSha}`)), CommitResponseSchema, 'GitHub base commit')
      if (!base.tree?.sha || !SHA.test(base.tree.sha)) throw new Error('GitHub base commit omitted its tree.')
      const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = []
      for (const [path, file] of Object.entries(input.files.files).sort(([a], [b]) => a.localeCompare(b))) {
        const blob = await checkedJson<{ sha: string }>(await this.#request(token, repoPath(input.owner, input.repository, '/git/blobs'), {
          method: 'POST',
          body: JSON.stringify({ content: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' }),
        }), ShaResponseSchema, 'GitHub blob creation')
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      const createdTree = await checkedJson<{ sha: string }>(await this.#request(token, repoPath(input.owner, input.repository, '/git/trees'), {
        method: 'POST',
        body: JSON.stringify({ base_tree: base.tree.sha, tree }),
      }), ShaResponseSchema, 'GitHub tree creation')
      const commit = await checkedJson<{ sha: string }>(await this.#request(token, repoPath(input.owner, input.repository, '/git/commits'), {
        method: 'POST',
        body: JSON.stringify({ message: input.message, tree: createdTree.sha, parents: [input.expectedHeadSha] }),
      }), ShaResponseSchema, 'GitHub commit creation')
      await checkedJson(await this.#request(token, repoPath(input.owner, input.repository, `/git/refs/heads/${input.branch.split('/').map(encodeURIComponent).join('/')}`), {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      }), RefResponseSchema, 'GitHub branch update')
      return commit.sha
    })
  }

  async openPullRequest(input: Readonly<{ owner: string; repository: string; head: string; base: string; title: string; body: string }>): Promise<Readonly<{ number: number; url: string }>> {
    return await this.#withToken(input.owner, input.repository, { contents: 'read', pullRequests: 'write' }, async (token) => {
      const pull = await checkedJson<{ number: number; html_url: string }>(await this.#request(token, repoPath(input.owner, input.repository, '/pulls'), {
        method: 'POST',
        body: JSON.stringify({ head: input.head, base: input.base, title: input.title, body: input.body }),
      }), PullResponseSchema, 'GitHub pull-request creation')
      return Object.freeze({ number: pull.number, url: pull.html_url })
    })
  }
  async exportOrRecover(
    artifact: NextSourceExportArtifact,
    requestValue: NextSourceGitHubExportRequest,
  ): Promise<NextSourceGitHubExportReceipt> {
    const parsed = safeParseValue(NextSourceGitHubExportRequestSchema, requestValue)
    if (!parsed.ok) throw new Error('Invalid GitHub branch/PR export request.')
    const request = parsed.value
    assertSafeBranch(request.baseBranch)
    assertSafeBranch(request.branch)
    if (request.branch === request.baseBranch) throw new Error('Export cannot write the selected base/default branch.')
    const marker = `Fuma export ${artifact.manifest.exportId} ${artifact.manifest.repositoryHashSha256}`
    const baseHead = await this.#branchHead(request.owner, request.repository, request.baseBranch)
    if (baseHead !== request.baseCommitSha) throw new Error('GitHub export base branch does not match the exact requested commit.')
    let head = await this.#branchHead(request.owner, request.repository, request.branch)
    if (head === null) {
      await this.createBranch({
        owner: request.owner,
        repository: request.repository,
        branch: request.branch,
        baseCommitSha: request.baseCommitSha,
      })
      head = request.baseCommitSha
    }
    let commitSha: string
    if (head === request.baseCommitSha) {
      commitSha = await this.createCommit({
        owner: request.owner,
        repository: request.repository,
        branch: request.branch,
        expectedHeadSha: request.baseCommitSha,
        files: artifact.files,
        message: marker,
      })
    } else {
      const commit = await this.#commit(request.owner, request.repository, head)
      if (commit.message !== marker) throw new Error('Existing export branch is not the exact recoverable Fuma operation.')
      commitSha = head
    }
    let pullRequest = await this.#findPullRequest(request, commitSha, marker)
    if (!pullRequest) {
      pullRequest = await this.openPullRequest({
        owner: request.owner,
        repository: request.repository,
        head: request.branch,
        base: request.baseBranch,
        title: request.title,
        body: `${request.body}${request.body ? '\n\n' : ''}${marker}`,
      })
    }
    const expectedUrl = `https://github.com/${request.owner}/${request.repository}/pull/${pullRequest.number}`
    if (pullRequest.url !== expectedUrl) throw new Error('GitHub export returned invalid pull-request provenance.')
    const receipt = safeParseValue(NextSourceGitHubExportReceiptSchema, {
      owner: request.owner,
      repository: request.repository,
      branch: request.branch,
      baseCommitSha: request.baseCommitSha,
      commitSha,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.url,
      defaultBranchWritten: false,
      repositoryHashSha256: artifact.manifest.repositoryHashSha256,
    })
    if (!receipt.ok) throw new Error('GitHub export reconciliation produced invalid provenance.')
    return receipt.value
  }

  async #branchHead(owner: string, repository: string, branch: string): Promise<string | null> {
    return this.#withToken(owner, repository, { contents: 'read', pullRequests: 'read' }, async (token) => {
      const response = await this.#request(token, repoPath(owner, repository, `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`))
      if (response.status === 404) return null
      const ref = await checkedJson<{ object: { sha: string } }>(response, RefResponseSchema, 'GitHub branch lookup')
      return ref.object.sha
    })
  }

  async #commit(owner: string, repository: string, sha: string): Promise<Readonly<{ sha: string; message?: string }>> {
    return this.#withToken(owner, repository, { contents: 'read', pullRequests: 'read' }, async (token) => (
      checkedJson(await this.#request(token, repoPath(owner, repository, `/git/commits/${sha}`)), CommitResponseSchema, 'GitHub export commit reconciliation')
    ))
  }

  async #findPullRequest(
    request: NextSourceGitHubExportRequest,
    commitSha: string,
    marker: string,
  ): Promise<Readonly<{ number: number; url: string }> | null> {
    return this.#withToken(request.owner, request.repository, { contents: 'read', pullRequests: 'read' }, async (token) => {
      const query = new URLSearchParams({
        state: 'all',
        head: `${request.owner}:${request.branch}`,
        base: request.baseBranch,
        per_page: '100',
      })
      const pulls = await checkedJson<Array<{
        number: number
        html_url: string
        body: string | null
        head: { ref: string; sha: string }
        base: { ref: string }
      }>>(await this.#request(token, repoPath(request.owner, request.repository, `/pulls?${query}`)), PullListResponseSchema, 'GitHub pull-request reconciliation')
      const related = pulls.filter((pull) => (
        pull.head.ref === request.branch
        && pull.base.ref === request.baseBranch
      ))
      const exact = related.filter((pull) => (
        pull.head.sha === commitSha
        && pull.body?.includes(marker)
      ))
      if (exact.length > 1) throw new Error('GitHub export pull-request reconciliation is ambiguous.')
      if (related.length !== exact.length) throw new Error('Existing GitHub pull request is unrelated to the exact Fuma operation.')
      return exact[0] ? Object.freeze({ number: exact[0].number, url: exact[0].html_url }) : null
    })
  }
}

export const nextSourceGitHubArchitecture = Object.freeze({
  tokenPersistence: false,
  tokenScope: 'repository-and-permissions',
  zipballRedirect: 'exact-codeload-allowlist',
  apiOrigin: API_ORIGIN,
  codeloadOrigin: CODELOAD_ORIGIN,
})
