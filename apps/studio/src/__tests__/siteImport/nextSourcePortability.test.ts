import { describe, expect, test } from 'bun:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  GitHubAppNextSourceIngestor,
  ingestLocalNextSource,
  type NextSourceGitHubFetchPort,
  type NextSourceGitHubAppTokenPort,
} from '@core/siteImport/nextSourceIngestion'
import {
  buildNextSourceExport,
  exportNextSourceToGitHub,
  type NextSourceExportArtifact,
  type NextSourceGitHubExportPort,
} from '@core/siteImport/nextSourceExport'
import {
  MemoryNextSourceDraftRepository,
  NextSourceAdaptationService,
  nextSourceCanPublish,
  type NextSourceAdaptationAuthorityPort,
  type NextSourceOwnerConfirmationPort,
} from '@core/siteImport/nextSourceAdaptation'
import type { NextSourceDestination } from '@core/siteImport/nextSourceContracts'
import type {
  NextSourceExportRequest,
  NextSourceFixAuthority,
  NextSourcePatch,
} from '@core/siteImport/nextSourcePortabilityContracts'
import type { FileMap } from '@core/siteImport/types'

const destination: NextSourceDestination = {
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  siteId: 'site-1',
}
const now = new Date('2027-01-02T03:04:05.000Z')
const encoder = new TextEncoder()

function files(entries: Record<string, string>): FileMap {
  return { files: Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, { bytes: encoder.encode(text) }])) }
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function exportRequest(overrides: Partial<NextSourceExportRequest> = {}): NextSourceExportRequest {
  return {
    exportId: 'export-1',
    destination,
    releaseId: 'release-1',
    releaseHashSha256: '1'.repeat(64),
    sourceSnapshotId: 'snapshot-1',
    sourceSnapshotHashSha256: '2'.repeat(64),
    documentHashSha256: '3'.repeat(64),
    siteName: 'Portable Site',
    sourceRevisionId: 'next-draft:revision-1',
    adapters: ['content', 'forms'],
    routes: [
      { path: '/', title: 'Home', source: 'export default function Page() { return <main>Home</main> }\n' },
      { path: '/stories/:slug', title: 'Story', source: 'export default function Page() { return <article>Story</article> }\n' },
    ],
    assets: { 'public/brand.txt': 'portable' },
    contentSnapshot: { title: 'Owned content' },
    ...overrides,
  }
}

describe('Next.js source ingestion portability', () => {
  test('ingests local folders and ZIPs without execution and emits deterministic scoped receipts', async () => {
    const source = files({ 'app/page.tsx': 'export default function Page() { return <main /> }\n', 'public/logo.txt': 'logo' })
    const first = await ingestLocalNextSource({ kind: 'file-map', name: 'fixture', fileMap: source }, destination, now)
    const second = await ingestLocalNextSource({ kind: 'file-map', name: 'fixture', fileMap: source }, destination, now)
    expect(first.receipt).toEqual(second.receipt)
    expect(first.receipt.destination).toEqual(destination)
    expect(first.receipt).toMatchObject({ tokenPersisted: false, scriptsExecuted: false, packagesInstalled: false, exactCommitSha: null })

    const archive = zipSync({ 'portable/app/page.tsx': strToU8('export default function Page() { return <main /> }\n') })
    const zipped = await ingestLocalNextSource({ kind: 'zip', name: 'portable.zip', bytes: archive }, destination, now)
    expect(Object.keys(zipped.fileMap.files)).toEqual(['app/page.tsx'])
    expect(zipped.fileMap.strippedTopLevelFolder).toBe('portable')

    const folderFile = new File(['export default function Page() { return <main /> }\n'], 'page.tsx', { type: 'text/typescript' })
    Object.defineProperty(folderFile, 'webkitRelativePath', { value: 'folder-site/app/page.tsx' })
    const folder = await ingestLocalNextSource({ kind: 'folder', name: 'folder-site', files: [folderFile] }, destination, now)
    expect(Object.keys(folder.fileMap.files)).toEqual(['app/page.tsx'])
    expect(folder.fileMap.strippedTopLevelFolder).toBe('folder-site')
  })

  test('rejects direct FileMaps that bypass path, hidden-file, empty, or destination policy', async () => {
    await expect(ingestLocalNextSource({ kind: 'file-map', name: 'bad', fileMap: files({ '../secret': 'x' }) }, destination, now)).rejects.toThrow('Unsafe imported source path')
    await expect(ingestLocalNextSource({ kind: 'file-map', name: 'bad', fileMap: files({ '.env': 'SESSION_SECRET=x' }) }, destination, now)).rejects.toThrow('Unsafe imported source path')
    await expect(ingestLocalNextSource({ kind: 'file-map', name: 'empty', fileMap: { files: {} } }, destination, now)).rejects.toThrow('invalid file count')
    await expect(ingestLocalNextSource({ kind: 'file-map', name: 'bad', fileMap: files({ 'app/page.tsx': 'x' }) }, { ...destination, siteId: '' }, now)).rejects.toThrow('explicit organization')
  })

  test('binds GitHub ingestion to one exact commit, fixed origin, bounded lease, and non-persisted token', async () => {
    const commitSha = 'a'.repeat(40)
    const token = 'installation-token-only-in-request'
    let released = 0
    let captured: Request | null = null
    const tokens: NextSourceGitHubAppTokenPort = {
      async issueInstallationToken(input) {
        expect(input).toEqual({
          installationId: 'install-1',
          owner: 'owner',
          repository: 'repo',
          permissions: { contents: 'read', pullRequests: 'read' },
        })
        return { token, expiresAt: '2027-01-02T03:34:05.000Z', async release() { released += 1 } }
      },
    }
    const transport: NextSourceGitHubFetchPort = {
      async fetch(request) {
        captured = request
        return new Response(zipSync({ 'repository/app/page.tsx': strToU8('export default function Page() { return <main /> }') }), {
          status: 200,
          headers: { 'content-length': '128' },
        })
      },
    }
    const result = await new GitHubAppNextSourceIngestor({ tokens, transport, now: () => now }).ingest({
      installationId: 'install-1', owner: 'owner', repository: 'repo', branch: 'main', commitSha,
    }, destination)
    expect(captured).not.toBeNull()
    expect(captured!.url).toBe(`https://api.github.com/repos/owner/repo/zipball/${commitSha}`)
    expect(captured!.redirect).toBe('manual')
    expect(captured!.credentials).toBe('omit')
    expect(captured!.headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(released).toBe(1)
    expect(JSON.stringify(result.receipt)).not.toContain(token)
    expect(result.receipt).toMatchObject({ exactCommitSha: commitSha, tokenPersisted: false, scriptsExecuted: false, packagesInstalled: false })
    expect(result.receipt.provenance).toEqual({ kind: 'github', locator: 'owner/repo@main', revision: commitSha })
  })

  test('follows only the exact GitHub codeload archive redirect and strips authorization', async () => {
    const commitSha = 'c'.repeat(40)
    const requests: Request[] = []
    const tokens: NextSourceGitHubAppTokenPort = {
      async issueInstallationToken() {
        return { token: 'installation-secret', expiresAt: '2027-01-02T03:34:05.000Z', async release() {} }
      },
    }
    const transport: NextSourceGitHubFetchPort = {
      async fetch(request) {
        requests.push(request)
        if (requests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: `https://codeload.github.com/owner/repo/legacy.zip/${commitSha}` },
          })
        }
        return new Response(zipSync({ 'repository/app/page.tsx': strToU8('export default function Page() { return <main /> }') }), { status: 200 })
      },
    }
    const result = await new GitHubAppNextSourceIngestor({ tokens, transport, now: () => now }).ingest({
      installationId: 'install-1', owner: 'owner', repository: 'repo', branch: 'main', commitSha,
    }, destination)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer installation-secret')
    expect(requests[1]!.url).toBe(`https://codeload.github.com/owner/repo/legacy.zip/${commitSha}`)
    expect(requests[1]!.headers.get('authorization')).toBeNull()
    expect(requests[1]!.credentials).toBe('omit')
    expect(requests[1]!.redirect).toBe('error')
    expect(result.receipt.exactCommitSha).toBe(commitSha)
  })

  test('denies redirects, oversized declarations, and invalid installation-token leases', async () => {
    const selection = { installationId: 'install-1', owner: 'owner', repository: 'repo', branch: 'main', commitSha: 'b'.repeat(40) }
    const validTokens: NextSourceGitHubAppTokenPort = { async issueInstallationToken() { return { token: 'short-lived', expiresAt: '2027-01-02T03:34:05.000Z', async release() {} } } }
    const redirecting: NextSourceGitHubFetchPort = { async fetch() { return new Response(null, { status: 302, headers: { location: 'https://evil.example/archive.zip' } }) } }
    await expect(new GitHubAppNextSourceIngestor({ tokens: validTokens, transport: redirecting, now: () => now }).ingest(selection, destination)).rejects.toThrow('exact codeload policy')

    const oversized: NextSourceGitHubFetchPort = { async fetch() { return new Response(new Uint8Array(), { headers: { 'content-length': `${256 * 1024 * 1024 + 1}` } }) } }
    await expect(new GitHubAppNextSourceIngestor({ tokens: validTokens, transport: oversized, now: () => now }).ingest(selection, destination)).rejects.toThrow('source byte limit')

    const expired: NextSourceGitHubAppTokenPort = { async issueInstallationToken() { return { token: 'expired', expiresAt: '2027-01-02T03:04:04.000Z', async release() {} } } }
    await expect(new GitHubAppNextSourceIngestor({ tokens: expired, transport: redirecting, now: () => now }).ingest(selection, destination)).rejects.toThrow('expire within one hour')
  })
})

describe('complete replaceable Next.js export', () => {
  test('builds deterministic ZIP bytes with pinned dependencies, local content/assets, adapters, and provenance', async () => {
    const first = await buildNextSourceExport(exportRequest())
    const second = await buildNextSourceExport(exportRequest())
    expect(first.archive).toEqual(second.archive)
    expect(first.manifest).toEqual(second.manifest)
    expect(first.manifest).toMatchObject({ containsSecrets: false, privateFumaImports: false, destination, releaseId: 'release-1' })

    const archive = unzipSync(first.archive)
    const packageJson = JSON.parse(strFromU8(archive['package.json']!)) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies).toEqual({ next: '16.2.9', react: '19.2.5', 'react-dom': '19.2.5' })
    expect(strFromU8(archive['content/snapshot.json']!)).toContain('Owned content')
    expect(strFromU8(archive['public/brand.txt']!)).toBe('portable')
    expect(strFromU8(archive['lib/adapters/content.ts']!)).toContain('interface ContentAdapter')
    expect(strFromU8(archive['bun.lock']!)).toContain('16.2.9')
    expect(strFromU8(archive['fuma-export.json']!)).toContain('next-draft:revision-1')
    expect(archive['app/stories/[slug]/page.tsx']).toBeDefined()
    expect(archive['fuma-export.json']).toBeDefined()
    expect(Object.keys(archive).some((path) => path.startsWith('.env') && path !== '.env.example')).toBe(false)
  })

  test('rejects secret-shaped source, private Fuma imports, unsafe assets, and route collisions', async () => {
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/', title: 'Bad', source: "const token = 'ghp_123456789012345678901234'\nexport default function Page() { return null }" }] }))).rejects.toThrow('Secret-shaped')
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/', title: 'Bad', source: "import value from '@fuma/server/private'\nexport default function Page() { return value }" }] }))).rejects.toThrow('Private Fuma import')
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/', title: 'Bad', source: "export default function Page() { return <main>{process.env.API_URL}</main> }" }] }))).rejects.toThrow('Environment access')
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/', title: 'Bad', source: "import Stripe from 'stripe'\nexport default function Page() { return <main>{String(Stripe)}</main> }" }] }))).rejects.toThrow('Unsupported export import')
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/', title: 'Bad', source: "const load = () => import('./widget')\nexport default function Page() { return <main>{String(load)}</main> }" }] }))).rejects.toThrow('Dynamic import')
    await expect(buildNextSourceExport(exportRequest({ assets: { '../secret': 'x' } }))).rejects.toThrow()
    await expect(buildNextSourceExport(exportRequest({ routes: [{ path: '/../escape', title: 'Bad', source: 'export default function Page() { return null }' }] }))).rejects.toThrow('Unsafe export route path')
    await expect(buildNextSourceExport(exportRequest({ routes: [
      { path: '/thing', title: 'One', source: 'export default function Page() { return null }' },
      { path: '/thing', title: 'Two', source: 'export default function Page() { return null }' },
    ] }))).rejects.toThrow('route collision')
  })

  test('writes only a new non-default branch and opens a PR with exact commit provenance', async () => {
    const artifact = await buildNextSourceExport(exportRequest())
    const calls: string[] = []
    const port: NextSourceGitHubExportPort = {
      async branchExists(owner, repository, branch) { calls.push(`exists:${owner}/${repository}:${branch}`); return false },
      async createBranch(input) { calls.push(`branch:${input.branch}:${input.baseCommitSha}`) },
      async createCommit(input) { calls.push(`commit:${input.branch}:${input.expectedHeadSha}:${Object.keys(input.files.files).length}`); return '3'.repeat(40) },
      async openPullRequest(input) { calls.push(`pr:${input.head}->${input.base}`); return { number: 17, url: 'https://github.com/owner/repo/pull/17' } },
    }
    const receipt = await exportNextSourceToGitHub(artifact, {
      owner: 'owner', repository: 'repo', baseBranch: 'main', baseCommitSha: '2'.repeat(40), branch: 'fuma/export-1', title: 'Export portable site', body: 'Review the complete export.',
    }, port)
    expect(calls).toEqual([
      'exists:owner/repo:fuma/export-1',
      `branch:fuma/export-1:${'2'.repeat(40)}`,
      `commit:fuma/export-1:${'2'.repeat(40)}:${Object.keys(artifact.files.files).length}`,
      'pr:fuma/export-1->main',
    ])
    expect(receipt).toMatchObject({ branch: 'fuma/export-1', baseCommitSha: '2'.repeat(40), commitSha: '3'.repeat(40), pullRequestNumber: 17, defaultBranchWritten: false })
  })

  test('denies default-branch writes and existing-branch overwrites before mutation', async () => {
    const artifact = await buildNextSourceExport(exportRequest())
    const mutationCalls: string[] = []
    const port: NextSourceGitHubExportPort = {
      async branchExists() { return true },
      async createBranch() { mutationCalls.push('branch') },
      async createCommit() { mutationCalls.push('commit'); return '3'.repeat(40) },
      async openPullRequest() { mutationCalls.push('pr'); return { number: 1, url: 'https://github.com/owner/repo/pull/1' } },
    }
    const base = { owner: 'owner', repository: 'repo', baseBranch: 'main', baseCommitSha: '2'.repeat(40), title: 'Export portable site', body: '' }
    await expect(exportNextSourceToGitHub(artifact, { ...base, branch: 'main' }, port)).rejects.toThrow('default branch')
    await expect(exportNextSourceToGitHub(artifact, { ...base, branch: 'fuma/../main' }, port)).rejects.toThrow('Unsafe Git branch')
    await expect(exportNextSourceToGitHub(artifact, { ...base, branch: 'fuma/existing' }, port)).rejects.toThrow('already exists')
    expect(mutationCalls).toEqual([])

    const invalidCommitCalls: string[] = []
    const invalidCommitPort: NextSourceGitHubExportPort = {
      async branchExists() { return false },
      async createBranch() { invalidCommitCalls.push('branch') },
      async createCommit() { invalidCommitCalls.push('commit'); return 'not-a-commit' },
      async openPullRequest() { invalidCommitCalls.push('pr'); return { number: 1, url: 'https://github.com/owner/repo/pull/1' } },
    }
    await expect(exportNextSourceToGitHub(artifact, { ...base, branch: 'fuma/invalid-commit' }, invalidCommitPort)).rejects.toThrow('invalid commit SHA')
    expect(invalidCommitCalls).toEqual(['branch', 'commit'])
  })
})

describe('bounded deterministic and AI/MCP source adaptation', () => {
  test('meters exact authority, denies self-confirmation, applies confirmed executable patches, rolls back, and gates publish', async () => {
    const repository = new MemoryNextSourceDraftRepository()
    const settlements: unknown[] = []
    const authorityPort: NextSourceAdaptationAuthorityPort = {
      async authorize() { return { replayReceiptId: null, active: true, meteringAccepted: true } },
      async settle(value) { settlements.push(value) },
    }
    let ownerEvidence = { active: true, direct: true, impersonating: false, ownerGeneration: 1 }
    const ownerConfirmation: NextSourceOwnerConfirmationPort = {
      async verifyOwner(input) {
        expect(input.destination).toEqual(destination)
        return ownerEvidence
      },
    }
    let sequence = 0
    const service = new NextSourceAdaptationService({ repository, authority: authorityPort, ownerConfirmation, now: () => now, generateId: () => `id-${++sequence}` })
    const originalText = "import { useRouter } from 'next/router'\nexport default function Page() { useRouter(); return <main /> }\n"
    const original = files({ 'app/page.tsx': originalText })
    const draft = await service.createDraft(original, { destination, provenance: { kind: 'github', locator: 'owner/repo@main', revision: 'a'.repeat(40) } })
    expect(draft.analysis.blocking).toBe(true)
    expect(nextSourceCanPublish(draft, [], 'website')).toBe(false)
    const diagnosticId = draft.analysis.diagnostics.find((item) => item.severity === 'blocking')!.id
    const authority: NextSourceFixAuthority = {
      kind: 'ai', actorId: 'ai-agent-1', operationId: 'operation-1', sourceRevisionId: draft.revisionId,
      destination, ownerGeneration: 1, capability: 'source.mutate', meteringReservationId: 'meter-1',
    }
    const patch: NextSourcePatch = {
      path: 'app/page.tsx', expectedSha256: await sha256(original.files['app/page.tsx']!.bytes),
      replacement: "import { useRouter } from 'next/navigation'\nexport default function Page() { useRouter(); return <main /> }\n",
    }
    const proposed = await service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [patch] })
    expect(proposed).toMatchObject({ executableChange: true, state: 'proposed', confirmationActorId: null })
    expect(settlements).toHaveLength(1)
    await expect(service.applyFix(proposed.receiptId)).rejects.toThrow('owner diff confirmation')
    await expect(service.confirmFix({ receiptId: proposed.receiptId, ownerActorId: 'ai-agent-1' })).rejects.toThrow('fresh direct owner')
    ownerEvidence = { ...ownerEvidence, direct: false }
    await expect(service.confirmFix({ receiptId: proposed.receiptId, ownerActorId: 'owner-1' })).rejects.toThrow('fresh direct owner')
    ownerEvidence = { ...ownerEvidence, direct: true, ownerGeneration: 2 }
    await expect(service.confirmFix({ receiptId: proposed.receiptId, ownerActorId: 'owner-1' })).rejects.toThrow('fresh direct owner')
    ownerEvidence = { ...ownerEvidence, ownerGeneration: 1 }

    const confirmed = await service.confirmFix({ receiptId: proposed.receiptId, ownerActorId: 'owner-1' })
    expect(confirmed.state).toBe('owner-confirmed')
    const adapted = await service.applyFix(proposed.receiptId)
    const applied = (await repository.getFix(proposed.receiptId))!.receipt
    expect(adapted.parentRevisionId).toBe(draft.revisionId)
    expect(adapted.sourceHashSha256).toBe(proposed.outputSourceHashSha256)
    expect(adapted.analysis.blocking).toBe(false)
    expect(nextSourceCanPublish(adapted, [], 'website')).toBe(false)
    expect(nextSourceCanPublish(adapted, [{ ...applied, outputSourceHashSha256: '0'.repeat(64) }], 'website')).toBe(false)
    expect(nextSourceCanPublish(adapted, [applied], 'website')).toBe(true)

    const rollback = await service.rollback({ currentRevisionId: adapted.revisionId, restoreRevisionId: draft.revisionId, actorId: 'owner-1' })
    expect(rollback).toMatchObject({ fromRevisionId: adapted.revisionId, restoredRevisionId: draft.revisionId, restoredSourceHashSha256: draft.sourceHashSha256 })
  })

  test('confines patches, rejects duplicate paths, revoked/unmetered authority, and cross-operation replay', async () => {
    const repository = new MemoryNextSourceDraftRepository()
    let replayReceiptId: string | null = null
    let active = true
    const authorityPort: NextSourceAdaptationAuthorityPort = {
      async authorize() { return { replayReceiptId, active, meteringAccepted: active } },
      async settle() {},
    }
    let sequence = 0
    const service = new NextSourceAdaptationService({
      repository,
      authority: authorityPort,
      ownerConfirmation: { async verifyOwner() { return { active: true, direct: true, impersonating: false, ownerGeneration: 3 } } },
      now: () => now,
      generateId: () => `guard-${++sequence}`,
    })
    const original = files({ 'app/page.tsx': "import value from 'unsupported-sdk'\nexport default function Page() { return value }\n", 'package.json': '{}' })
    const draft = await service.createDraft(original, { destination, provenance: { kind: 'file-map', locator: 'guard' } })
    const diagnosticId = draft.analysis.diagnostics.find((item) => item.severity === 'blocking')!.id
    const authority: NextSourceFixAuthority = {
      kind: 'mcp', actorId: 'connector-1', operationId: 'operation-guard-1', sourceRevisionId: draft.revisionId,
      destination, ownerGeneration: 3, capability: 'source.mutate', meteringReservationId: 'meter-guard-1',
    }
    const expectedSha256 = await sha256(original.files['app/page.tsx']!.bytes)
    const validPatch: NextSourcePatch = { path: 'app/page.tsx', expectedSha256, replacement: 'export default function Page() { return <main /> }\n' }
    await expect(service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [validPatch, validPatch] })).rejects.toThrow('only once')
    await expect(service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [{ ...validPatch, path: 'package.json', expectedSha256: await sha256(original.files['package.json']!.bytes) }] })).rejects.toThrow('confined presentation surface')
    await expect(service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [{ ...validPatch, replacement: 'const secret = process.env.SESSION_SECRET' }] })).rejects.toThrow('Secret-shaped source')

    active = false
    await expect(service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [validPatch] })).rejects.toThrow('revoked or unmetered')
    active = true
    const receipt = await service.proposeFix({ authority, diagnosticIds: [diagnosticId], patches: [validPatch] })
    replayReceiptId = receipt.receiptId
    await expect(service.proposeFix({
      authority,
      diagnosticIds: [diagnosticId],
      patches: [{ ...validPatch, replacement: 'export default function Page() { return <section /> }\n' }],
    })).rejects.toThrow('different authority evidence')
    await expect(service.proposeFix({ authority: { ...authority, operationId: 'operation-guard-2' }, diagnosticIds: [diagnosticId], patches: [validPatch] })).rejects.toThrow('different authority evidence')
  })
})
