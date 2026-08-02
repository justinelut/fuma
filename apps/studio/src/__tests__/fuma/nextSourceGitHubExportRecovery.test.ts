import { describe, expect, test } from 'bun:test'
import { buildNextSourceExport, type NextSourceExportArtifact } from '@core/siteImport/nextSourceExport'
import type {
  NextSourceExportRequest,
  NextSourceGitHubExportRequest,
} from '@core/siteImport/nextSourcePortabilityContracts'
import type {
  NextSourceGitHubAppTokenPort,
  NextSourceTokenLease,
} from '@core/siteImport/nextSourceIngestion'
import {
  GitHubAppNextSourceExportAdapter,
  type HostedNextSourceGitHubConfig,
} from '../../../server/fuma/nextSource'

const BASE_SHA = 'b'.repeat(40)
const COMMIT_SHA = 'c'.repeat(40)
const BASE_TREE_SHA = 'd'.repeat(40)
const EXPORT_TREE_SHA = 'e'.repeat(40)
const BLOB_SHA = 'f'.repeat(40)
const BRANCH = 'fuma/export-1'
const config: HostedNextSourceGitHubConfig = Object.freeze({
  appId: '12345',
  privateKeyPem: 'unused-by-mocked-token-port',
  userAgent: 'fuma-next-source-recovery-test/1',
})

function exportRequest(): NextSourceExportRequest {
  return {
    exportId: 'export-1',
    destination: { organizationId: 'org-1', workspaceId: 'workspace-1', siteId: 'site-1' },
    releaseId: 'release-1',
    releaseHashSha256: '1'.repeat(64),
    sourceSnapshotId: 'snapshot-1',
    sourceSnapshotHashSha256: '2'.repeat(64),
    documentHashSha256: '3'.repeat(64),
    siteName: 'Portable Site',
    sourceRevisionId: 'next-draft:revision-1',
    adapters: ['content'],
    routes: [{ path: '/', title: 'Home', source: 'export default function Page() { return <main>Home</main> }\n' }],
    assets: {},
    contentSnapshot: { title: 'Owned content' },
  }
}

function providerRequest(): NextSourceGitHubExportRequest {
  return {
    owner: 'owner',
    repository: 'repo',
    baseBranch: 'main',
    baseCommitSha: BASE_SHA,
    branch: BRANCH,
    title: 'Export portable site',
    body: 'Review this deterministic export.',
  }
}

type Fault = 'branch-response' | 'ref-response' | 'pr-response' | null

type ProviderOptions = Readonly<{
  fault?: Fault
  initialBranchHead?: string | null
  initialPulls?: Array<Readonly<{
    number: number
    body: string | null
    headSha: string
  }>>
  baseHead?: string
}>

function mockedProvider(artifact: NextSourceExportArtifact, options: ProviderOptions = {}) {
  const marker = `Fuma export ${artifact.manifest.exportId} ${artifact.manifest.repositoryHashSha256}`
  let branchHead = options.initialBranchHead ?? null
  let pulls = [...(options.initialPulls ?? [])]
  let faultRaised = false
  let released = 0
  const mutations = { branches: 0, commits: 0, refs: 0, pulls: 0 }
  const tokens: NextSourceGitHubAppTokenPort = {
    async issueInstallationToken(): Promise<NextSourceTokenLease> {
      return {
        token: 'ephemeral-provider-token',
        expiresAt: '2027-01-02T03:34:05.000Z',
        async release() { released += 1 },
      }
    },
  }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const path = url.pathname
    const json = (value: unknown, status = 200) => Response.json(value, { status })

    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      return json({ object: { sha: options.baseHead ?? BASE_SHA } })
    }
    if (method === 'GET' && path.endsWith('/git/ref/heads/fuma/export-1')) {
      return branchHead
        ? json({ object: { sha: branchHead } })
        : json({ message: 'Not Found' }, 404)
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      mutations.branches += 1
      branchHead = BASE_SHA
      if (options.fault === 'branch-response' && !faultRaised) {
        faultRaised = true
        throw new Error('branch creation response lost')
      }
      return json({ object: { sha: BASE_SHA } }, 201)
    }
    if (method === 'GET' && path.endsWith(`/git/commits/${BASE_SHA}`)) {
      return json({ sha: BASE_SHA, message: 'Base commit', tree: { sha: BASE_TREE_SHA } })
    }
    if (method === 'GET' && path.endsWith(`/git/commits/${COMMIT_SHA}`)) {
      return json({ sha: COMMIT_SHA, message: marker, tree: { sha: EXPORT_TREE_SHA } })
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return json({ sha: branchHead, message: 'unrelated commit', tree: { sha: EXPORT_TREE_SHA } })
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) return json({ sha: BLOB_SHA }, 201)
    if (method === 'POST' && path.endsWith('/git/trees')) return json({ sha: EXPORT_TREE_SHA }, 201)
    if (method === 'POST' && path.endsWith('/git/commits')) {
      mutations.commits += 1
      return json({ sha: COMMIT_SHA }, 201)
    }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/fuma/export-1')) {
      mutations.refs += 1
      branchHead = COMMIT_SHA
      if (options.fault === 'ref-response' && !faultRaised) {
        faultRaised = true
        throw new Error('branch update response lost')
      }
      return json({ object: { sha: COMMIT_SHA } })
    }
    if (method === 'GET' && path.endsWith('/pulls')) {
      return json(pulls.map((pull) => ({
        number: pull.number,
        html_url: `https://github.com/owner/repo/pull/${pull.number}`,
        body: pull.body,
        head: { ref: BRANCH, sha: pull.headSha },
        base: { ref: 'main' },
      })))
    }
    if (method === 'POST' && path.endsWith('/pulls')) {
      mutations.pulls += 1
      const body = JSON.parse(String(init?.body)) as { body: string }
      pulls = [{ number: 17, body: body.body, headSha: COMMIT_SHA }]
      if (options.fault === 'pr-response' && !faultRaised) {
        faultRaised = true
        throw new Error('pull request response lost')
      }
      return json({ number: 17, html_url: 'https://github.com/owner/repo/pull/17' }, 201)
    }
    throw new Error(`Unexpected mocked GitHub request: ${method} ${url}`)
  }) as typeof fetch
  return {
    adapter: new GitHubAppNextSourceExportAdapter({
      tokens,
      installationId: '98765',
      config,
      fetch: fetchImpl,
    }),
    marker,
    mutations,
    released: () => released,
  }
}

describe('FUMA-077 GitHub export provider reconciliation', () => {
  test('recovers lost branch, non-force ref-update, and PR creation responses without duplicate mutations', async () => {
    const artifact = await buildNextSourceExport(exportRequest())
    for (const fault of ['branch-response', 'ref-response', 'pr-response'] as const) {
      const provider = mockedProvider(artifact, { fault })
      await expect(provider.adapter.exportOrRecover(artifact, providerRequest())).rejects.toThrow('response lost')
      const recovered = await provider.adapter.exportOrRecover(artifact, providerRequest())
      const replayed = await provider.adapter.exportOrRecover(artifact, providerRequest())
      expect(recovered).toEqual(replayed)
      expect(recovered).toMatchObject({
        owner: 'owner',
        repository: 'repo',
        branch: BRANCH,
        baseCommitSha: BASE_SHA,
        commitSha: COMMIT_SHA,
        pullRequestNumber: 17,
        defaultBranchWritten: false,
        repositoryHashSha256: artifact.manifest.repositoryHashSha256,
      })
      expect(provider.mutations).toEqual({ branches: 1, commits: 1, refs: 1, pulls: 1 })
      expect(provider.released()).toBeGreaterThan(0)
    }
  })

  test('exact replay reuses the marker-bound branch and pull request without another provider mutation', async () => {
    const artifact = await buildNextSourceExport(exportRequest())
    const provider = mockedProvider(artifact)
    const first = await provider.adapter.exportOrRecover(artifact, providerRequest())
    const mutations = { ...provider.mutations }
    const second = await provider.adapter.exportOrRecover(artifact, providerRequest())
    expect(second).toEqual(first)
    expect(provider.mutations).toEqual(mutations)
  })

  test('rejects stale base, unrelated existing branch/PR, and ambiguous exact PR evidence', async () => {
    const artifact = await buildNextSourceExport(exportRequest())
    const staleBase = mockedProvider(artifact, { baseHead: '9'.repeat(40) })
    await expect(staleBase.adapter.exportOrRecover(artifact, providerRequest())).rejects.toThrow('base branch does not match')
    expect(staleBase.mutations).toEqual({ branches: 0, commits: 0, refs: 0, pulls: 0 })

    const unrelatedBranch = mockedProvider(artifact, { initialBranchHead: '8'.repeat(40) })
    await expect(unrelatedBranch.adapter.exportOrRecover(artifact, providerRequest())).rejects.toThrow('not the exact recoverable')
    expect(unrelatedBranch.mutations).toEqual({ branches: 0, commits: 0, refs: 0, pulls: 0 })

    const unrelatedPull = mockedProvider(artifact, {
      initialBranchHead: COMMIT_SHA,
      initialPulls: [{ number: 11, body: 'Unrelated request', headSha: COMMIT_SHA }],
    })
    await expect(unrelatedPull.adapter.exportOrRecover(artifact, providerRequest())).rejects.toThrow('unrelated to the exact Fuma operation')
    expect(unrelatedPull.mutations).toEqual({ branches: 0, commits: 0, refs: 0, pulls: 0 })

    const ambiguousPull = mockedProvider(artifact, {
      initialBranchHead: COMMIT_SHA,
      initialPulls: [
        { number: 12, body: mockedProvider(artifact).marker, headSha: COMMIT_SHA },
        { number: 13, body: mockedProvider(artifact).marker, headSha: COMMIT_SHA },
      ],
    })
    await expect(ambiguousPull.adapter.exportOrRecover(artifact, providerRequest())).rejects.toThrow('ambiguous')
    expect(ambiguousPull.mutations).toEqual({ branches: 0, commits: 0, refs: 0, pulls: 0 })
  })
})
