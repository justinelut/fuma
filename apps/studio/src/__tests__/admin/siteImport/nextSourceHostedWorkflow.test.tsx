import { afterEach, describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { analyzeNextSource, type NextSourceDraftRevision } from '@core/siteImport'
import {
  downloadHostedNextSourceRelease,
  readHostedNextSourceFix,
  readHostedNextSourceWorkflowState,
  type HostedNextSourceDraft,
  type HostedNextSourceFix,
} from '@admin/modals/SiteImport/shared/nextSourceHostedClient'
import { NextSourceCompatibilityStep } from '@admin/modals/SiteImport/steps/NextSourceCompatibilityStep'

const destination = { organizationId: 'org-1', workspaceId: 'workspace-1', siteId: 'site-1' }
const createdAt = '2026-07-30T16:00:00.000Z'
const hash = 'a'.repeat(64)
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

function fixReceipt() {
  return {
    receiptId: 'next-fix:receipt-1',
    diagnosticIds: ['diagnostic-1'],
    authority: {
      kind: 'ai' as const,
      actorId: 'ai-agent-1',
      operationId: 'operation-1',
      sourceRevisionId: 'next-draft:revision-1',
      destination,
      ownerGeneration: 1,
      capability: 'source.mutate' as const,
      meteringReservationId: 'reservation-1',
    },
    inputSourceHashSha256: hash,
    outputSourceHashSha256: 'b'.repeat(64),
    patchHashSha256: 'c'.repeat(64),
    executableChange: true,
    state: 'proposed' as const,
    confirmationActorId: null,
    createdAt,
    confirmedAt: null,
  }
}

describe('FUMA-077 hosted Studio workflow client', () => {
  test('reads canonical sequence/release, exact diff evidence, and verified archive bytes', async () => {
    const requests: Array<{ url: string; credentials: RequestCredentials | undefined }> = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, credentials: init?.credentials })
      if (url.endsWith('/source-import/workflow-state')) {
        return Response.json({ editorSequence: 4, activeRelease: { releaseId: 'release-1', activatedAt: createdAt } })
      }
      if (url.endsWith('/source-import/fixes/next-fix%3Areceipt-1')) {
        return Response.json({
          receipt: fixReceipt(),
          changes: [{ path: 'app/page.tsx', expectedSha256: hash, before: '<main>Before</main>', after: '<main>After</main>' }],
        })
      }
      if (url.endsWith('/source-export/releases/release-1/archive')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-disposition': 'attachment; filename="fuma-next-source-aaaaaaaaaaaaaaaa.zip"',
            'content-length': '3',
            'content-type': 'application/zip',
          },
        })
      }
      return Response.json({ error: 'unexpected' }, { status: 500 })
    }) as typeof fetch

    await expect(readHostedNextSourceWorkflowState(destination)).resolves.toEqual({
      editorSequence: 4,
      activeRelease: { releaseId: 'release-1', activatedAt: createdAt },
    })
    const fix = await readHostedNextSourceFix(destination, 'next-fix:receipt-1')
    expect(fix.changes[0]).toEqual({ path: 'app/page.tsx', expectedSha256: hash, before: '<main>Before</main>', after: '<main>After</main>' })
    await expect(downloadHostedNextSourceRelease(destination, 'release-1')).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      filename: 'fuma-next-source-aaaaaaaaaaaaaaaa.zip',
    })
    expect(requests.every(({ credentials }) => credentials === 'same-origin')).toBe(true)
    expect(requests.map(({ url }) => url)).toEqual([
      '/api/fuma/organizations/org-1/workspaces/workspace-1/sites/site-1/source-import/workflow-state',
      '/api/fuma/organizations/org-1/workspaces/workspace-1/sites/site-1/source-import/fixes/next-fix%3Areceipt-1',
      '/api/fuma/organizations/org-1/workspaces/workspace-1/sites/site-1/source-export/releases/release-1/archive',
    ])
  })

  test('rejects extra workflow authority and invalid archive provenance', async () => {
    globalThis.fetch = (async () => Response.json({ editorSequence: 0, activeRelease: null, callerScope: destination })) as typeof fetch
    await expect(readHostedNextSourceWorkflowState(destination)).rejects.toThrow('invalid response')

    globalThis.fetch = (async () => new Response(new Uint8Array([1]), {
      headers: {
        'content-disposition': 'attachment; filename="untrusted.zip"',
        'content-length': '1',
        'content-type': 'application/zip',
      },
    })) as typeof fetch
    await expect(downloadHostedNextSourceRelease(destination, 'release-1')).rejects.toThrow('filename evidence')
  })
})

describe('FUMA-077 Next-source workflow surface', () => {
  test('shows real diff, owner confirmation, authoritative sequence, blockers, and active release actions', async () => {
    const analysis = await analyzeNextSource({
      files: {
        'app/page.tsx': { bytes: new TextEncoder().encode('export default function Page() { return <main>Before</main> }') },
      },
    }, { destination, provenance: { kind: 'file-map', locator: 'fixture' } })
    const revision: NextSourceDraftRevision = {
      revisionId: 'next-draft:revision-1',
      destination,
      provenance: { kind: 'file-map', locator: 'fixture' },
      parentRevisionId: null,
      sourceHashSha256: analysis.sourceHashSha256,
      analysis,
      fixReceiptIds: ['next-fix:receipt-1'],
      state: 'draft',
      createdAt,
    }
    const hostedDraft: HostedNextSourceDraft = {
      revision,
      receipt: {
        receiptId: 'next-ingest:receipt-1',
        destination,
        provenance: revision.provenance,
        exactCommitSha: null,
        sourceHashSha256: revision.sourceHashSha256,
        fileCount: 1,
        totalBytes: 1,
        tokenPersisted: false,
        scriptsExecuted: false,
        packagesInstalled: false,
        createdAt,
      },
    }
    const fix: HostedNextSourceFix = {
      receipt: { ...fixReceipt(), inputSourceHashSha256: revision.sourceHashSha256 },
      changes: [{ path: 'app/page.tsx', expectedSha256: hash, before: '<main>Before</main>', after: '<main>After</main>' }],
    }
    const confirm = mock(() => undefined)
    const noAction = () => undefined

    render(<NextSourceCompatibilityStep
      destination={destination}
      sourceLabel="fixture"
      report={analysis}
      hostedDraft={hostedDraft}
      currentRevision={revision}
      fixes={[fix]}
      workflowState={{ editorSequence: 4, activeRelease: { releaseId: 'release-1', activatedAt: createdAt } }}
      commitResult={{
        state: 'committed',
        replayed: false,
        receipt: {
          schemaVersion: 1,
          commitId: 'next-commit:1',
          revisionId: revision.revisionId,
          sourceHashSha256: revision.sourceHashSha256,
          documentHashSha256: 'f'.repeat(64),
          mutationId: 'next-source-commit-1',
          expectedSequence: 3,
          acceptedSequence: 4,
          actorId: 'owner-1',
          destination,
          ownerGeneration: 1,
          createdAt,
        },
      }}
      releaseExport={null}
      githubSelection={{ installationId: '98765', owner: 'owner', repository: 'repo', branch: 'main', commitSha: 'd'.repeat(40) }}
      githubExportRequest={{ owner: 'owner', repository: 'repo', baseBranch: 'main', baseCommitSha: 'e'.repeat(40), branch: 'fuma/export', title: 'Export Fuma site', body: '' }}
      rollbackReceiptId={null}
      busyLabel={null}
      errorMessage={null}
      statusMessage={null}
      onDestinationChange={noAction}
      onGitHubSelectionChange={noAction}
      onGitHubExportRequestChange={noAction}
      onAnalyze={noAction}
      onPersistDraft={noAction}
      onPersistGitHubDraft={noAction}
      onRefreshEvidence={noAction}
      onConfirmFix={confirm}
      onApplyFix={noAction}
      onRollback={noAction}
      onCommit={noAction}
      onCreateExport={noAction}
      onExportGitHub={noAction}
      onDownloadExport={noAction}
      onCancel={noAction}
    />)

    expect(screen.getByText('AI proposal')).toBeDefined()
    expect(screen.getByText('Before')).toBeDefined()
    expect(screen.getByText('After')).toBeDefined()
    expect(screen.getByText('Sequence 4')).toBeDefined()
    expect(screen.getByText('release-1')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Commit to editor' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Create archive' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm as owner' }))
    expect(confirm).toHaveBeenCalledWith('next-fix:receipt-1')
  })
})
