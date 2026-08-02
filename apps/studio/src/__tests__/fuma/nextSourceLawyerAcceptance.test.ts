import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  analyzeNextSource,
  ingestLocalNextSource,
  MemoryNextSourceDraftRepository,
  NextSourceAdaptationService,
  type FileMap,
  type NextSourceAdaptationAuthorityPort,
  type NextSourceDestination,
  type NextSourceFixAuthority,
  type NextSourceInteractionBinding,
} from '@core/siteImport'

const sourceRoot = process.env.FUMA_LAWYER_SOURCE_PATH?.trim() || '/home/ubuntu/workspace/proposal/thelawyer'
const destination: NextSourceDestination = Object.freeze({
  organizationId: 'organization-lawyer-reimport',
  workspaceId: 'workspace-lawyer-reimport',
  siteId: 'site-lawyer-reimport',
})
const includedRoots = Object.freeze(['package.json', 'next.config.ts', 'src', 'public'])
const forbiddenSegments = new Set(['.env', '.env.local', '.ghost', '.next', 'node_modules', '.git'])

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function assertPermittedPath(path: string): void {
  const segments = path.split('/')
  if (segments.some((segment) => forbiddenSegments.has(segment) || segment.startsWith('.env'))) {
    throw new Error(`Sensitive Lawyer path escaped the explicit ingestion allowlist: ${path}`)
  }
}

async function collectDirectory(root: string, directory: string, files: FileMap['files']): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name)
    const path = portablePath(root, absolute)
    assertPermittedPath(path)
    if (entry.isSymbolicLink()) throw new Error(`Lawyer ingestion refuses symbolic links: ${path}`)
    if (entry.isDirectory()) await collectDirectory(root, absolute, files)
    else if (entry.isFile()) files[path] = { bytes: new Uint8Array(await readFile(absolute)) }
  }
}

async function realLawyerFileMap(root: string): Promise<FileMap> {
  const files: FileMap['files'] = {}
  for (const entry of includedRoots) {
    const absolute = join(root, entry)
    if (!existsSync(absolute)) throw new Error(`Required Lawyer source path is missing: ${entry}`)
    if (entry === 'src' || entry === 'public') await collectDirectory(root, absolute, files)
    else files[entry] = { bytes: new Uint8Array(await readFile(absolute)) }
  }
  return Object.freeze({ files })
}

describe('FUMA-SITE-006 real Lawyer generic source acceptance', () => {
  test.skipIf(!existsSync(sourceRoot))('ingests the allowlisted real checkout without execution and records exact generic blockers', async () => {
    const fileMap = await realLawyerFileMap(sourceRoot)
    const paths = Object.keys(fileMap.files)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((path) => includedRoots.some((root) => path === root || path.startsWith(`${root}/`)))).toBe(true)
    expect(paths.some((path) => path.startsWith('.env') || path.startsWith('.ghost/') || path.startsWith('.next/') || path.startsWith('node_modules/'))).toBe(false)

    const ingested = await ingestLocalNextSource({ kind: 'file-map', name: 'real-lawyer-checkout', fileMap }, destination, new Date('2026-07-30T16:30:00.000Z'))
    const report = await analyzeNextSource(ingested.fileMap, {
      destination,
      provenance: { kind: 'file-map', locator: 'real-lawyer-checkout' },
    })
    const categoryCounts = Object.fromEntries([...new Set(report.diagnostics.map(({ category }) => category))]
      .sort()
      .map((category) => [category, report.diagnostics.filter((item) => item.category === category).length]))
    const interactionCounts = Object.fromEntries([...new Set(report.interactions.map(({ kind }) => kind))]
      .sort()
      .map((kind) => [kind, report.interactions.filter((item) => item.kind === kind).length]))

    expect(ingested.receipt.destination).toEqual(destination)
    expect(ingested.receipt).toMatchObject({ tokenPersisted: false, scriptsExecuted: false, packagesInstalled: false })
    expect(report.importedCodeExecuted).toBe(false)
    expect(report.routes).toHaveLength(69)
    expect(report.blocking).toBe(true)

    const reviewedBindings: NextSourceInteractionBinding[] = []
    for (const interaction of report.interactions) {
      if (interaction.kind === 'content') reviewedBindings.push({ interactionId: interaction.id, kind: 'content', authority: 'publication.content' })
      if (interaction.kind === 'member') reviewedBindings.push({ interactionId: interaction.id, kind: 'member', authority: 'publication.member-access' })
      if (interaction.kind === 'subscription') reviewedBindings.push({ interactionId: interaction.id, kind: 'subscription', authority: 'publication.membership-payments' })
      if (interaction.kind === 'form') reviewedBindings.push({ interactionId: interaction.id, kind: 'form', authority: 'core.public-form' })
    }
    const mapped = await analyzeNextSource(ingested.fileMap, {
      destination,
      provenance: { kind: 'file-map', locator: 'real-lawyer-checkout' },
      interactionBindings: reviewedBindings,
    })
    expect(mapped.interactions.filter(({ kind }) => kind !== 'podcast').every(({ boundAuthority }) => boundAuthority !== null)).toBe(true)
    expect(mapped.interactions.filter(({ kind }) => kind === 'podcast').every(({ boundAuthority }) => boundAuthority === null)).toBe(true)
    expect(mapped.diagnostics.some(({ category }) => [
      'unbound-content-interaction', 'unbound-member-interaction',
      'unbound-subscription-interaction', 'unbound-form-interaction',
    ].includes(category))).toBe(false)
    expect(mapped.diagnostics.filter(({ category }) => category === 'unbound-podcast-interaction')).toHaveLength(interactionCounts.podcast)
    expect(mapped.bindingHashSha256).not.toBe(report.bindingHashSha256)
    process.stdout.write(`[FUMA-SITE-006 real Lawyer generic analysis] files=${report.files.length} routes=${report.routes.length} modules=${report.modules.length} assets=${report.assets.length} interactions=${JSON.stringify(interactionCounts)} reviewedSupportedBindings=${reviewedBindings.length} blockers=${JSON.stringify(categoryCounts)} source=${report.sourceHashSha256}\n`)
  }, 120_000)
})


describe('FUMA-077 real Lawyer reviewed font adaptation', () => {
  test.skipIf(!existsSync(sourceRoot))('reduces unsupported-next-api by exactly one only after owner-reviewed application', async () => {
    const fileMap = await realLawyerFileMap(sourceRoot)
    const ingested = await ingestLocalNextSource({ kind: 'file-map', name: 'real-lawyer-font-fix', fileMap }, destination, new Date('2026-08-01T20:30:00.000Z'))
    const repository = new MemoryNextSourceDraftRepository()
    const adaptationAuthority: NextSourceAdaptationAuthorityPort = {
      async authorize(input) {
        const active = input.kind === 'deterministic'
          && input.actorId === 'fuma-next-source-policy'
          && input.meteringReservationId === null
        return { replayReceiptId: null, active, meteringAccepted: active }
      },
      async settle() {},
    }
    let sequence = 0
    const service = new NextSourceAdaptationService({
      repository,
      authority: adaptationAuthority,
      ownerConfirmation: {
        async verifyOwner() {
          return { active: true, direct: true, impersonating: false, ownerGeneration: 1 }
        },
      },
      now: () => new Date('2026-08-01T20:30:00.000Z'),
      generateId: () => `lawyer-font-${++sequence}`,
    })
    const draft = await service.createDraft(ingested.fileMap, {
      destination,
      provenance: { kind: 'file-map', locator: 'real-lawyer-font-fix' },
    })
    const diagnostic = draft.analysis.diagnostics.find((item) =>
      item.path === 'src/app/layout.tsx' && item.specifier === 'next/font/google')!
    expect(draft.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(5)
    const authority: NextSourceFixAuthority = {
      kind: 'deterministic',
      actorId: 'fuma-next-source-policy',
      operationId: 'real-lawyer-font-system-fallback',
      sourceRevisionId: draft.revisionId,
      destination,
      ownerGeneration: 1,
      capability: 'source.mutate',
      meteringReservationId: null,
    }
    const proposed = await service.proposeDeterministicFontFix({ authority, diagnosticId: diagnostic.id })
    expect(proposed.plan.mappings.map(({ requestedFamily, tokenVariable, fallbackStack }) => ({ requestedFamily, tokenVariable, fallbackStack }))).toEqual([
      { requestedFamily: 'Source Serif 4', tokenVariable: '--font-display', fallbackStack: '"Iowan Old Style", "Charter", Georgia, serif' },
      { requestedFamily: 'Inter', tokenVariable: '--font-body', fallbackStack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    ])
    expect(proposed.plan.patches.map(({ path }) => path)).toEqual(['src/app/layout.tsx', 'src/app/globals.css'])
    expect((await repository.getRevision(draft.revisionId))!.revision.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(5)
    const confirmed = await service.confirmFix({ receiptId: proposed.receipt.receiptId, ownerActorId: 'owner-lawyer-font-reviewer' })
    expect(confirmed.state).toBe('owner-confirmed')
    expect((await repository.getRevision(draft.revisionId))!.revision.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(5)
    const applied = await service.applyFix(proposed.receipt.receiptId)
    expect(applied.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(4)
    const reviewedDiagnosticIds = new Set(proposed.plan.diagnosticIds)
    const beforeOther = draft.analysis.diagnostics.filter(({ id }) => !reviewedDiagnosticIds.has(id)).map(({ id }) => id).sort()
    const after = applied.analysis.diagnostics.map(({ id }) => id).sort()
    expect(after).toEqual(beforeOther)
    expect(applied.analysis.files).toHaveLength(209)
    expect(applied.analysis.routes).toHaveLength(69)
    expect(applied.analysis.modules).toHaveLength(173)
    expect(applied.analysis.assets).toHaveLength(8)
    process.stdout.write(`[FUMA-077 real Lawyer font adaptation] unsupported-next-api=5->4 reviewed=true files=${applied.analysis.files.length} routes=${applied.analysis.routes.length} modules=${applied.analysis.modules.length} assets=${applied.analysis.assets.length} source=${draft.sourceHashSha256}->${applied.sourceHashSha256}\n`)
  }, 120_000)
})
