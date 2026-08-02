import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import type {
  NextSourceAnalysisReport,
  NextSourceDestination,
  NextSourceDraftRevision,
  NextSourceGitHubExportRequest,
  NextSourceGitHubSelection,
} from '@core/siteImport'
import type {
  HostedNextSourceDraft,
  HostedNextSourceEditorCommit,
  HostedNextSourceEditorConflict,
  HostedNextSourceFix,
  HostedNextSourceReleaseExport,
  HostedNextSourceWorkflowState,
} from '../shared/nextSourceHostedClient'
import styles from './NextSourceCompatibilityStep.module.css'

export interface NextSourceCompatibilityStepProps {
  destination: NextSourceDestination
  sourceLabel: string
  report: NextSourceAnalysisReport | null
  hostedDraft: HostedNextSourceDraft | null
  currentRevision: NextSourceDraftRevision | null
  fixes: readonly HostedNextSourceFix[]
  workflowState: HostedNextSourceWorkflowState | null
  commitResult: HostedNextSourceEditorCommit | HostedNextSourceEditorConflict | null
  releaseExport: HostedNextSourceReleaseExport | null
  githubSelection: NextSourceGitHubSelection
  githubExportRequest: NextSourceGitHubExportRequest
  rollbackReceiptId: string | null
  busyLabel: string | null
  errorMessage: string | null
  statusMessage: string | null
  onDestinationChange(value: NextSourceDestination): void
  onGitHubSelectionChange(value: NextSourceGitHubSelection): void
  onGitHubExportRequestChange(value: NextSourceGitHubExportRequest): void
  onAnalyze(): void
  onPersistDraft(): void
  onPersistGitHubDraft(): void
  onRefreshEvidence(): void
  onConfirmFix(receiptId: string): void
  onApplyFix(receiptId: string): void
  onRollback(): void
  onCommit(): void
  onCreateExport(): void
  onExportGitHub(): void
  onDownloadExport(): void
  onCancel(): void
}

function completeDestination(destination: NextSourceDestination): boolean {
  return Boolean(destination.organizationId && destination.workspaceId && destination.siteId)
}

function completeGitHubSelection(selection: NextSourceGitHubSelection): boolean {
  return Boolean(
    /^[1-9][0-9]{0,19}$/.test(selection.installationId)
    && selection.owner
    && selection.repository
    && selection.branch
    && /^[a-f0-9]{40}$/.test(selection.commitSha),
  )
}

function completeGitHubExport(request: NextSourceGitHubExportRequest, installationId: string): boolean {
  return Boolean(
    /^[1-9][0-9]{0,19}$/.test(installationId)
    && request.owner
    && request.repository
    && request.baseBranch
    && /^[a-f0-9]{40}$/.test(request.baseCommitSha)
    && request.branch
    && request.branch !== request.baseBranch
    && request.title,
  )
}

export function NextSourceCompatibilityStep({
  destination,
  sourceLabel,
  report,
  hostedDraft,
  currentRevision,
  fixes,
  workflowState,
  commitResult,
  releaseExport,
  githubSelection,
  githubExportRequest,
  rollbackReceiptId,
  busyLabel,
  errorMessage,
  statusMessage,
  onDestinationChange,
  onGitHubSelectionChange,
  onGitHubExportRequestChange,
  onAnalyze,
  onPersistDraft,
  onPersistGitHubDraft,
  onRefreshEvidence,
  onConfirmFix,
  onApplyFix,
  onRollback,
  onCommit,
  onCreateExport,
  onExportGitHub,
  onDownloadExport,
  onCancel,
}: NextSourceCompatibilityStepProps) {
  const busy = busyLabel !== null
  const destinationReady = completeDestination(destination)
  const unresolvedInteractions = report?.interactions.filter((interaction) => interaction.boundAuthority === null).length ?? 0
  const allFixesApplied = currentRevision?.fixReceiptIds.every((id) => fixes.some((fix) => fix.receipt.receiptId === id && fix.receipt.state === 'applied')) ?? false
  const canCommit = Boolean(currentRevision && workflowState && !report?.blocking && unresolvedInteractions === 0 && allFixesApplied)
  const originalRevisionId = hostedDraft?.revision.revisionId ?? null
  const canRollback = Boolean(currentRevision && originalRevisionId && currentRevision.revisionId !== originalRevisionId)
  const activeRelease = workflowState?.activeRelease ?? null
  const sourceCommitted = commitResult?.state === 'committed'
  const canCreateExport = Boolean(activeRelease && sourceCommitted)
  const canExportGitHub = Boolean(canCreateExport && completeGitHubExport(githubExportRequest, githubSelection.installationId))

  return (
    <section className={styles.root} aria-labelledby="next-source-compatibility-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Next.js source portability</p>
        <h2 id="next-source-compatibility-title">Import, adapt, commit, and export</h2>
        <p>Source is parsed as untrusted data. Package managers, scripts, configuration plugins, repository code, and generated server backends never run.</p>
        <code>{sourceLabel}</code>
      </header>

      <fieldset className={styles.destination} disabled={busy || Boolean(hostedDraft)}>
        <legend>Exact import destination</legend>
        <label>Organization<Input value={destination.organizationId} onChange={(event) => onDestinationChange({ ...destination, organizationId: event.target.value })} /></label>
        <label>Workspace<Input value={destination.workspaceId} onChange={(event) => onDestinationChange({ ...destination, workspaceId: event.target.value })} /></label>
        <label>Site<Input value={destination.siteId} onChange={(event) => onDestinationChange({ ...destination, siteId: event.target.value })} /></label>
      </fieldset>

      {!hostedDraft && (
        <fieldset className={styles.panel} disabled={busy || !destinationReady}>
          <legend>Or import one exact GitHub commit</legend>
          <p className={styles.help}>The GitHub App token stays server-side. Branch names are provenance only; ingestion is pinned to the full commit SHA.</p>
          <div className={styles.grid}>
            <label>Installation ID<Input value={githubSelection.installationId} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, installationId: event.target.value })} /></label>
            <label>Owner<Input value={githubSelection.owner} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, owner: event.target.value })} /></label>
            <label>Repository<Input value={githubSelection.repository} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, repository: event.target.value })} /></label>
            <label>Branch<Input value={githubSelection.branch} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, branch: event.target.value })} /></label>
            <label className={styles.wide}>Exact 40-character commit SHA<Input value={githubSelection.commitSha} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, commitSha: event.target.value.toLowerCase() })} /></label>
          </div>
          <div className={styles.inlineActions}><Button variant="secondary" disabled={!completeGitHubSelection(githubSelection)} onClick={onPersistGitHubDraft}>Create GitHub draft</Button></div>
        </fieldset>
      )}

      {busyLabel && <p className={styles.busy} role="status">{busyLabel}</p>}
      {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
      {statusMessage && <p className={styles.success} role="status">{statusMessage}</p>}

      {report && (
        <section className={styles.report} aria-labelledby="next-source-report-title">
          <div className={styles.summary}>
            <h3 id="next-source-report-title">Compatibility report</h3>
            <strong>{report.blocking ? `${report.diagnostics.filter((item) => item.severity === 'blocking').length} blockers` : 'Static source compatible'}</strong>
            <span>{report.routes.length} routes · {report.modules.length} modules · {report.assets.length} assets · {report.interactions.length} interactions</span>
          </div>
          <dl className={styles.provenance}>
            <div><dt>Policy</dt><dd>{report.policyVersion}</dd></div>
            <div><dt>Source</dt><dd>{report.sourceHashSha256}</dd></div>
            <div><dt>Binding</dt><dd>{report.bindingHashSha256}</dd></div>
          </dl>
          {unresolvedInteractions > 0 && <p className={styles.blocked}>{unresolvedInteractions} data interaction(s) have no reviewed Fuma authority. Commit remains blocked.</p>}
          {report.diagnostics.length === 0 ? (
            <p className={styles.success}>No unsupported source diagnostics. Editor commit still requires all interaction bindings and exact current adaptation evidence.</p>
          ) : (
            <ul className={styles.diagnostics}>
              {report.diagnostics.map((diagnostic) => (
                <li key={diagnostic.id}>
                  <div><strong>{diagnostic.category}</strong><code>{diagnostic.path}{diagnostic.line ? `:${diagnostic.line}` : ''}</code></div>
                  <p>{diagnostic.message}</p>
                  <span className={diagnostic.severity === 'blocking' ? styles.blocked : styles.help}>
                    {diagnostic.deterministicFix ? 'A deterministic replacement is available.' : 'Use the existing Site AI or authorized MCP tool to propose a source fix, then refresh evidence here.'}
                  </span>
                  <code>{diagnostic.id}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {currentRevision && (
        <section className={styles.panel} aria-labelledby="durable-source-title">
          <div className={styles.sectionHeading}>
            <div><h3 id="durable-source-title">Durable source and adaptation</h3><p>AI/MCP may propose only. A distinct direct owner confirms executable diffs before application.</p></div>
            <Button variant="secondary" size="xs" disabled={busy} onClick={onRefreshEvidence}>Refresh evidence</Button>
          </div>
          <dl className={styles.provenance}>
            <div><dt>Revision</dt><dd>{currentRevision.revisionId}</dd></div>
            <div><dt>Source</dt><dd>{currentRevision.sourceHashSha256}</dd></div>
            <div><dt>State</dt><dd>{currentRevision.state}</dd></div>
          </dl>
          {fixes.length === 0 ? <p className={styles.help}>No AI/MCP source-fix proposals are attached to this revision.</p> : (
            <div className={styles.fixes}>
              {fixes.map((fix) => (
                <article key={fix.receipt.receiptId} className={styles.fix}>
                  <div className={styles.sectionHeading}>
                    <div><strong>{fix.receipt.authority.kind.toUpperCase()} proposal</strong><code>{fix.receipt.receiptId}</code></div>
                    <span>{fix.receipt.state}</span>
                  </div>
                  <p>{fix.receipt.diagnosticIds.length} diagnostic(s) · {fix.receipt.executableChange ? 'executable change' : 'non-executable change'}</p>
                  {fix.changes.map((change) => (
                    <details key={`${fix.receipt.receiptId}:${change.path}`} className={styles.diff}>
                      <summary>{change.path}</summary>
                      <div className={styles.diffGrid}>
                        <div><strong>Before</strong><pre>{change.before}</pre></div>
                        <div><strong>After</strong><pre>{change.after}</pre></div>
                      </div>
                    </details>
                  ))}
                  <div className={styles.inlineActions}>
                    {fix.receipt.state === 'proposed' && fix.receipt.executableChange && <Button variant="secondary" size="xs" disabled={busy} onClick={() => onConfirmFix(fix.receipt.receiptId)}>Confirm as owner</Button>}
                    {((fix.receipt.state === 'owner-confirmed') || (fix.receipt.state === 'proposed' && !fix.receipt.executableChange)) && <Button variant="primary" size="xs" disabled={busy} onClick={() => onApplyFix(fix.receipt.receiptId)}>Apply fix</Button>}
                  </div>
                </article>
              ))}
            </div>
          )}
          {rollbackReceiptId && <p className={styles.help}>Latest rollback receipt: <code>{rollbackReceiptId}</code></p>}
        </section>
      )}

      {workflowState && currentRevision && (
        <section className={styles.panel} aria-labelledby="editor-commit-title">
          <div className={styles.sectionHeading}>
            <div><h3 id="editor-commit-title">Canonical editor commit</h3><p>Sequence is read from the existing editor authority and never typed by the user.</p></div>
            <strong>Sequence {workflowState.editorSequence}</strong>
          </div>
          {!canCommit && <p className={styles.blocked}>Commit is blocked until diagnostics, interaction bindings, and every attached fix are accepted.</p>}
          {commitResult?.state === 'conflict' && <p className={styles.blocked}>Concurrent editor change: {commitResult.code}. Authoritative sequence is {commitResult.authoritativeSequence}.</p>}
          {commitResult?.state === 'committed' && <p className={styles.success}>Committed mutation <code>{commitResult.receipt.mutationId}</code> at sequence {commitResult.receipt.acceptedSequence}.</p>}
          <div className={styles.inlineActions}>
            <Button variant="secondary" disabled={!canRollback || busy} onClick={onRollback}>Restore original revision</Button>
            <Button variant="primary" disabled={!canCommit || busy} onClick={onCommit}>Commit to editor</Button>
          </div>
        </section>
      )}

      {workflowState && currentRevision && (
        <section className={styles.panel} aria-labelledby="release-export-title">
          <div className={styles.sectionHeading}>
            <div><h3 id="release-export-title">Release-derived export</h3><p>Export is available only from the active immutable release bound to the committed editor snapshot.</p></div>
            <strong>{activeRelease ? activeRelease.releaseId : 'No active release'}</strong>
          </div>
          {!sourceCommitted && <p className={styles.help}>Commit the accepted source to the canonical editor, publish through the existing Fuma Publish workflow, then refresh evidence.</p>}
          {sourceCommitted && !activeRelease && <p className={styles.help}>Publish through the existing Fuma Publish workflow, then refresh evidence. Draft source is never exported as a release.</p>}
          {releaseExport && (
            <dl className={styles.provenance}>
              <div><dt>Export</dt><dd>{releaseExport.record.exportId}</dd></div>
              <div><dt>State</dt><dd>{releaseExport.record.state}</dd></div>
              <div><dt>Archive</dt><dd>{releaseExport.record.objectHashSha256}</dd></div>
            </dl>
          )}
          <div className={styles.inlineActions}>
            <Button variant="secondary" disabled={!canCreateExport || busy} onClick={onCreateExport}>Create archive</Button>
            <Button variant="secondary" disabled={!releaseExport || busy} onClick={onDownloadExport}>Download ZIP</Button>
          </div>

          <fieldset className={styles.githubExport} disabled={!canCreateExport || busy}>
            <legend>Optional new GitHub branch and pull request</legend>
            <p className={styles.help}>Fuma never writes the default branch. Existing unrelated branches or pull requests fail closed.</p>
            <div className={styles.grid}>
              <label>Installation ID<Input value={githubSelection.installationId} onChange={(event) => onGitHubSelectionChange({ ...githubSelection, installationId: event.target.value })} /></label>
              <label>Owner<Input value={githubExportRequest.owner} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, owner: event.target.value })} /></label>
              <label>Repository<Input value={githubExportRequest.repository} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, repository: event.target.value })} /></label>
              <label>Base branch<Input value={githubExportRequest.baseBranch} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, baseBranch: event.target.value })} /></label>
              <label>New branch<Input value={githubExportRequest.branch} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, branch: event.target.value })} /></label>
              <label className={styles.wide}>Exact base commit SHA<Input value={githubExportRequest.baseCommitSha} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, baseCommitSha: event.target.value.toLowerCase() })} /></label>
              <label className={styles.wide}>Pull request title<Input value={githubExportRequest.title} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, title: event.target.value })} /></label>
              <label className={styles.wide}>Pull request body<textarea value={githubExportRequest.body} onChange={(event) => onGitHubExportRequestChange({ ...githubExportRequest, body: event.target.value })} /></label>
            </div>
            <div className={styles.inlineActions}><Button variant="primary" disabled={!canExportGitHub} onClick={onExportGitHub}>Create or recover pull request</Button></div>
          </fieldset>
          {releaseExport?.record.githubReceipt && <p className={styles.success}>Pull request <a href={releaseExport.record.githubReceipt.pullRequestUrl} target="_blank" rel="noreferrer">#{releaseExport.record.githubReceipt.pullRequestNumber}</a> at commit <code>{releaseExport.record.githubReceipt.commitSha}</code>.</p>}
        </section>
      )}

      <footer className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        {report && !hostedDraft && <Button variant="secondary" disabled={busy} onClick={onPersistDraft}>Create local durable draft</Button>}
        <Button variant="primary" disabled={!destinationReady || busy || Boolean(hostedDraft)} onClick={onAnalyze}>
          {report ? 'Re-run local analysis' : 'Analyze local source'}
        </Button>
      </footer>
    </section>
  )
}
