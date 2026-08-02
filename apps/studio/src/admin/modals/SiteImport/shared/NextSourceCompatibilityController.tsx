import { useState } from 'react'
import {
  analyzeNextSource,
  type NextSourceAnalysisReport,
  type NextSourceDestination,
  type NextSourceDraftRevision,
  type NextSourceGitHubExportRequest,
  type NextSourceGitHubSelection,
} from '@core/siteImport'
import { useEditorStore } from '@site/store/store'
import { getErrorMessage } from '@core/utils/errorMessage'
import { NextSourceCompatibilityStep } from '../steps/NextSourceCompatibilityStep'
import {
  applyHostedNextSourceFix,
  commitHostedNextSource,
  confirmHostedNextSourceFix,
  downloadHostedNextSourceRelease,
  exportHostedNextSourceRelease,
  persistHostedNextSourceDraft,
  persistHostedNextSourceGitHubDraft,
  readHostedNextSourceFix,
  readHostedNextSourceRevision,
  readHostedNextSourceWorkflowState,
  rollbackHostedNextSource,
  type HostedNextSourceDraft,
  type HostedNextSourceEditorCommit,
  type HostedNextSourceEditorConflict,
  type HostedNextSourceFix,
  type HostedNextSourceReleaseExport,
  type HostedNextSourceWorkflowState,
} from './nextSourceHostedClient'
import type { NextSourceCompatibilityInput } from './nextSourceCompatibility'

const EMPTY_GITHUB_SELECTION: NextSourceGitHubSelection = Object.freeze({
  installationId: '', owner: '', repository: '', branch: 'main', commitSha: '',
})
const EMPTY_GITHUB_EXPORT: NextSourceGitHubExportRequest = Object.freeze({
  owner: '', repository: '', baseBranch: 'main', baseCommitSha: '', branch: '',
  title: 'Export Fuma site', body: 'Review this deterministic Fuma release export.',
})

function selectedDestinationHint(): NextSourceDestination {
  const match = globalThis.location?.pathname.match(/\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)/)
  return {
    organizationId: match?.[1] ? decodeURIComponent(match[1]) : '',
    workspaceId: match?.[2] ? decodeURIComponent(match[2]) : '',
    siteId: match?.[3] ? decodeURIComponent(match[3]) : (useEditorStore.getState().site?.id ?? ''),
  }
}

export function NextSourceCompatibilityController({
  input,
  onCancel,
}: Readonly<{
  input: NextSourceCompatibilityInput
  onCancel: () => void
}>) {
  const [destination, setDestination] = useState<NextSourceDestination>(selectedDestinationHint)
  const [report, setReport] = useState<NextSourceAnalysisReport | null>(null)
  const [hostedDraft, setHostedDraft] = useState<HostedNextSourceDraft | null>(null)
  const [currentRevision, setCurrentRevision] = useState<NextSourceDraftRevision | null>(null)
  const [fixes, setFixes] = useState<readonly HostedNextSourceFix[]>([])
  const [workflowState, setWorkflowState] = useState<HostedNextSourceWorkflowState | null>(null)
  const [commitResult, setCommitResult] = useState<HostedNextSourceEditorCommit | HostedNextSourceEditorConflict | null>(null)
  const [releaseExport, setReleaseExport] = useState<HostedNextSourceReleaseExport | null>(null)
  const [githubSelection, setGitHubSelection] = useState<NextSourceGitHubSelection>(EMPTY_GITHUB_SELECTION)
  const [githubExportRequest, setGitHubExportRequest] = useState<NextSourceGitHubExportRequest>(EMPTY_GITHUB_EXPORT)
  const [rollbackReceiptId, setRollbackReceiptId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function run(label: string, fallback: string, work: () => Promise<void>) {
    setBusyAction(label)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await work()
    } catch (error) {
      setErrorMessage(getErrorMessage(error, fallback))
    } finally {
      setBusyAction(null)
    }
  }

  async function loadEvidence(revision: NextSourceDraftRevision) {
    const [nextState, ...nextFixes] = await Promise.all([
      readHostedNextSourceWorkflowState(destination),
      ...revision.fixReceiptIds.map(async (receiptId) => await readHostedNextSourceFix(destination, receiptId)),
    ])
    setCurrentRevision(revision)
    setReport(revision.analysis)
    setWorkflowState(nextState)
    setFixes(nextFixes)
  }

  async function acceptDraft(draft: HostedNextSourceDraft, source: string) {
    setHostedDraft(draft)
    setCommitResult(null)
    setReleaseExport(null)
    setRollbackReceiptId(null)
    await loadEvidence(draft.revision)
    setStatusMessage(`Durable source created from ${source}.`)
  }

  function analyze() {
    void run('Analyzing source…', 'Next.js source analysis failed', async () => {
      setReport(await analyzeNextSource(input.fileMap, { destination, provenance: input.provenance }))
    })
  }

  function persistDraft() {
    if (!report) return
    void run('Creating durable draft…', 'Durable Next.js source draft failed', async () => {
      const draft = await persistHostedNextSourceDraft({ destination, locator: input.provenance.locator, fileMap: input.fileMap })
      await acceptDraft(draft, input.provenance.locator)
    })
  }

  function persistGitHubDraft() {
    void run('Importing exact GitHub commit…', 'GitHub Next.js source draft failed', async () => {
      const draft = await persistHostedNextSourceGitHubDraft(destination, githubSelection)
      await acceptDraft(draft, `${githubSelection.owner}/${githubSelection.repository}@${githubSelection.commitSha}`)
    })
  }

  function refreshEvidence() {
    if (!currentRevision) return
    void run('Refreshing adaptation evidence…', 'Source adaptation refresh failed', async () => {
      const revision = await readHostedNextSourceRevision(destination, currentRevision.revisionId)
      await loadEvidence(revision)
      setStatusMessage('Source revision, AI/MCP proposals, editor sequence, and active release refreshed.')
    })
  }

  function confirmFix(receiptId: string) {
    void run('Confirming source diff…', 'Owner source-diff confirmation failed', async () => {
      const receipt = await confirmHostedNextSourceFix(destination, receiptId)
      setFixes((current) => current.map((fix) => fix.receipt.receiptId === receiptId ? { ...fix, receipt } : fix))
      setStatusMessage(`Owner confirmed ${receiptId}.`)
    })
  }

  function applyFix(receiptId: string) {
    void run('Applying confirmed source fix…', 'Source fix application failed', async () => {
      const revision = await applyHostedNextSourceFix(destination, receiptId)
      await loadEvidence(revision)
      setStatusMessage(`Applied ${receiptId} as revision ${revision.revisionId}.`)
    })
  }

  function rollback() {
    if (!hostedDraft || !currentRevision || hostedDraft.revision.revisionId === currentRevision.revisionId) return
    void run('Recording rollback…', 'Source rollback failed', async () => {
      const receipt = await rollbackHostedNextSource(destination, currentRevision.revisionId, hostedDraft.revision.revisionId)
      const restored = await readHostedNextSourceRevision(destination, receipt.restoredRevisionId)
      await loadEvidence(restored)
      setRollbackReceiptId(receipt.receiptId)
      setStatusMessage(`Rollback evidence ${receipt.receiptId} restored the original revision for the next editor commit.`)
    })
  }

  function commit() {
    if (!currentRevision || !workflowState) return
    void run('Committing to editor…', 'Editor source commit failed', async () => {
      const result = await commitHostedNextSource(destination, currentRevision.revisionId, workflowState.editorSequence)
      setCommitResult(result)
      if (result.state === 'conflict') {
        setWorkflowState({ ...workflowState, editorSequence: result.authoritativeSequence })
        setStatusMessage(`Editor changed concurrently. Sequence refreshed to ${result.authoritativeSequence}; review and retry.`)
      } else {
        setWorkflowState({ ...workflowState, editorSequence: result.receipt.acceptedSequence })
        setStatusMessage(result.replayed ? 'Existing editor commit replayed safely.' : 'Source committed to the canonical editor document.')
      }
    })
  }

  function exportRelease(toGitHub: boolean) {
    if (!workflowState?.activeRelease) return
    void run(toGitHub ? 'Exporting release to GitHub…' : 'Creating release archive…', 'Release export failed', async () => {
      const result = await exportHostedNextSourceRelease({
        destination,
        releaseId: workflowState.activeRelease!.releaseId,
        ...(toGitHub ? { github: { installationId: githubSelection.installationId, request: githubExportRequest } } : {}),
      })
      setReleaseExport(result)
      setStatusMessage(toGitHub ? 'Release reconciled to the exact GitHub branch and pull request.' : 'Immutable release archive created and ready to download.')
    })
  }

  function downloadRelease() {
    if (!workflowState?.activeRelease || !releaseExport) return
    void run('Downloading release archive…', 'Release archive download failed', async () => {
      const value = await downloadHostedNextSourceRelease(destination, workflowState.activeRelease!.releaseId)
      const url = URL.createObjectURL(new Blob([Uint8Array.from(value.bytes)], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url
      link.download = value.filename
      link.click()
      URL.revokeObjectURL(url)
      setStatusMessage(`Downloaded ${value.filename}.`)
    })
  }

  return (
    <NextSourceCompatibilityStep
      destination={destination}
      sourceLabel={currentRevision?.provenance.locator ?? input.provenance.locator}
      report={report}
      hostedDraft={hostedDraft}
      currentRevision={currentRevision}
      fixes={fixes}
      workflowState={workflowState}
      commitResult={commitResult}
      releaseExport={releaseExport}
      githubSelection={githubSelection}
      githubExportRequest={githubExportRequest}
      rollbackReceiptId={rollbackReceiptId}
      busyLabel={busyAction}
      errorMessage={errorMessage}
      statusMessage={statusMessage}
      onDestinationChange={setDestination}
      onGitHubSelectionChange={setGitHubSelection}
      onGitHubExportRequestChange={setGitHubExportRequest}
      onAnalyze={analyze}
      onPersistDraft={persistDraft}
      onPersistGitHubDraft={persistGitHubDraft}
      onRefreshEvidence={refreshEvidence}
      onConfirmFix={confirmFix}
      onApplyFix={applyFix}
      onRollback={rollback}
      onCommit={commit}
      onCreateExport={() => exportRelease(false)}
      onExportGitHub={() => exportRelease(true)}
      onDownloadExport={downloadRelease}
      onCancel={onCancel}
    />
  )
}
