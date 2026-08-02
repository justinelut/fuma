import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  analyzeNextSource,
  type NextSourceDraftRevision,
  type NextSourceGitHubExportRequest,
  type NextSourceGitHubSelection,
} from '@core/siteImport'
import { NextSourceCompatibilityStep } from '@admin/modals/SiteImport/steps/NextSourceCompatibilityStep'
import type {
  HostedNextSourceDraft,
  HostedNextSourceEditorCommit,
  HostedNextSourceFix,
} from '@admin/modals/SiteImport/shared/nextSourceHostedClient'

const destination = Object.freeze({
  organizationId: 'organization-browser',
  workspaceId: 'workspace-browser',
  siteId: 'site-browser',
})
const createdAt = '2026-07-31T09:00:00.000Z'
const sourceBytes = new TextEncoder().encode('export default function Page(){ return <main><h1>Portable site</h1></main> }')
const analysis = await analyzeNextSource({ files: { 'app/page.tsx': { bytes: sourceBytes } } }, {
  destination,
  provenance: { kind: 'file-map', locator: 'browser-fixture' },
})
const revision: NextSourceDraftRevision = {
  revisionId: 'next-draft:browser',
  destination,
  provenance: analysis.provenance,
  parentRevisionId: null,
  sourceHashSha256: analysis.sourceHashSha256,
  analysis,
  fixReceiptIds: ['next-fix:browser'],
  state: 'draft',
  createdAt,
}
const hostedDraft: HostedNextSourceDraft = {
  revision,
  receipt: {
    receiptId: 'next-ingest:browser', destination, provenance: revision.provenance,
    exactCommitSha: null, sourceHashSha256: revision.sourceHashSha256,
    fileCount: 1, totalBytes: sourceBytes.byteLength,
    tokenPersisted: false, scriptsExecuted: false, packagesInstalled: false, createdAt,
  },
}
const githubSelection: NextSourceGitHubSelection = {
  installationId: '98765', owner: 'fuma-browser', repository: 'portable-site',
  branch: 'main', commitSha: 'a'.repeat(40),
}
const githubExportRequest: NextSourceGitHubExportRequest = {
  owner: 'fuma-browser', repository: 'portable-site', baseBranch: 'main',
  baseCommitSha: 'b'.repeat(40), branch: 'fuma/portable-site',
  title: 'Export portable Fuma site', body: 'Exact release-derived export.',
}

function proposedFix(): HostedNextSourceFix {
  return {
    receipt: {
      receiptId: 'next-fix:browser', diagnosticIds: ['browser-reviewed-diff'],
      authority: {
        kind: 'ai', actorId: 'ai-browser', operationId: 'operation-browser',
        sourceRevisionId: revision.revisionId, destination, ownerGeneration: 1,
        capability: 'source.mutate', meteringReservationId: 'reservation-browser',
      },
      inputSourceHashSha256: revision.sourceHashSha256,
      outputSourceHashSha256: 'c'.repeat(64), patchHashSha256: 'd'.repeat(64),
      executableChange: true, state: 'proposed', confirmationActorId: null,
      createdAt, confirmedAt: null,
    },
    changes: [{
      path: 'app/page.tsx', expectedSha256: revision.sourceHashSha256,
      before: '<h1>Portable site</h1>', after: '<h1>Owner-reviewed portable site</h1>',
    }],
  }
}

export function Harness() {
  const [fix, setFix] = useState<HostedNextSourceFix>(proposedFix)
  const [commit, setCommit] = useState<HostedNextSourceEditorCommit | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const noAction = () => undefined

  return <NextSourceCompatibilityStep
    destination={destination}
    sourceLabel="browser-fixture · exact source hash"
    report={analysis}
    hostedDraft={hostedDraft}
    currentRevision={revision}
    fixes={[fix]}
    workflowState={{ editorSequence: 4, activeRelease: { releaseId: 'release-browser', activatedAt: createdAt } }}
    commitResult={commit}
    releaseExport={null}
    githubSelection={githubSelection}
    githubExportRequest={githubExportRequest}
    rollbackReceiptId={null}
    busyLabel={null}
    errorMessage={null}
    statusMessage={status}
    onDestinationChange={noAction}
    onGitHubSelectionChange={noAction}
    onGitHubExportRequestChange={noAction}
    onAnalyze={noAction}
    onPersistDraft={noAction}
    onPersistGitHubDraft={noAction}
    onRefreshEvidence={() => setStatus('Exact durable evidence refreshed.')}
    onConfirmFix={() => {
      setFix((current) => ({
        ...current,
        receipt: { ...current.receipt, state: 'owner-confirmed', confirmationActorId: 'owner-browser', confirmedAt: createdAt },
      }))
      setStatus('Executable diff confirmed by the direct owner.')
    }}
    onApplyFix={() => {
      setFix((current) => ({ ...current, receipt: { ...current.receipt, state: 'applied' } }))
      setStatus('Owner-confirmed source fix applied to the immutable draft.')
    }}
    onRollback={noAction}
    onCommit={() => {
      setCommit({
        state: 'committed', replayed: false,
        receipt: {
          schemaVersion: 1, commitId: 'next-commit:browser', revisionId: revision.revisionId,
          sourceHashSha256: revision.sourceHashSha256, documentHashSha256: 'e'.repeat(64),
          mutationId: 'nextsource:browser', expectedSequence: 4, acceptedSequence: 5,
          actorId: 'owner-browser', destination, ownerGeneration: 1, createdAt,
        },
      })
      setStatus('Source committed through the canonical editor sequence.')
    }}
    onCreateExport={noAction}
    onExportGitHub={noAction}
    onDownloadExport={noAction}
    onCancel={noAction}
  />
}

createRoot(document.getElementById('root')!).render(<Harness />)
