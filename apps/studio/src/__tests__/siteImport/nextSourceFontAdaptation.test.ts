import { describe, expect, test } from 'bun:test'
import {
  MemoryNextSourceDraftRepository,
  NextSourceAdaptationService,
  NextSourceGoogleFontSystemFixPlanSchema,
  type FileMap,
  type NextSourceAdaptationAuthorityPort,
  type NextSourceDestination,
  type NextSourceFixAuthority,
} from '@core/siteImport'
import { Value } from '@core/utils/typeboxHelpers'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const destination: NextSourceDestination = {
  organizationId: 'organization-font-fix',
  workspaceId: 'workspace-font-fix',
  siteId: 'site-font-fix',
}
const now = new Date('2026-08-01T20:00:00.000Z')

function sourceFiles(layout: string, css: string): FileMap {
  return {
    files: {
      'src/app/layout.tsx': { bytes: encoder.encode(layout) },
      'src/app/globals.css': { bytes: encoder.encode(css) },
    },
  }
}

function fixture(overrides: Readonly<{ options?: string; usage?: string; css?: string }> = {}): FileMap {
  const options = overrides.options ?? [
    'subsets: ["latin"]',
    'weight: ["400", "700"]',
    'style: ["normal", "italic"]',
    'variable: "--font-inter"',
    'display: "swap"',
  ].join(', ')
  const usage = overrides.usage ?? 'className={`${inter.variable} shell`}'
  return sourceFiles([
    'import { Inter } from "next/font/google";',
    'import "./globals.css";',
    `const inter = Inter({ ${options} });`,
    `export default function Layout({ children }: { children: unknown }) { return <html ${usage}><body>{children}</body></html> }`,
  ].join('\n'), overrides.css ?? ':root { --font-body: var(--font-inter), system-ui, -apple-system, "Segoe UI", sans-serif; }\nbody { font-family: var(--font-body); }\n')
}

function harness(files: FileMap) {
  const repository = new MemoryNextSourceDraftRepository()
  const authority: NextSourceAdaptationAuthorityPort = {
    async authorize(input) {
      const active = input.kind === 'deterministic' && input.actorId === 'fuma-next-source-policy' && input.meteringReservationId === null
      return { replayReceiptId: null, active, meteringAccepted: active }
    },
    async settle() {},
  }
  let sequence = 0
  const service = new NextSourceAdaptationService({
    repository,
    authority,
    ownerConfirmation: { async verifyOwner() { return { active: true, direct: true, impersonating: false, ownerGeneration: 4 } } },
    now: () => now,
    generateId: () => `font-${++sequence}`,
  })
  return { files, repository, service }
}

function policyAuthority(revisionId: string): NextSourceFixAuthority {
  return {
    kind: 'deterministic',
    actorId: 'fuma-next-source-policy',
    operationId: 'font-system-fallback-1',
    sourceRevisionId: revisionId,
    destination,
    ownerGeneration: 4,
    capability: 'source.mutate',
    meteringReservationId: null,
  }
}

describe('FUMA-077 deterministic next/font/google system adaptation', () => {
  test('proposes an explicit two-file diff, waits for a distinct owner, then reanalyzes exactly one diagnostic away', async () => {
    const { files, repository, service } = harness(fixture())
    const draft = await service.createDraft(files, { destination, provenance: { kind: 'file-map', locator: 'font-positive' } })
    const diagnostic = draft.analysis.diagnostics.find(({ specifier }) => specifier === 'next/font/google')!
    expect(draft.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(1)

    const proposed = await service.proposeDeterministicFontFix({ authority: policyAuthority(draft.revisionId), diagnosticId: diagnostic.id })
    expect(Value.Check(NextSourceGoogleFontSystemFixPlanSchema, proposed.plan)).toBe(true)
    expect(proposed.plan).toMatchObject({
      sourceRevisionId: draft.revisionId,
      destination,
      diagnosticId: diagnostic.id,
      sourcePath: 'src/app/layout.tsx',
      inputSourceHashSha256: draft.sourceHashSha256,
      styleChange: 'review-required-system-fallback',
      networkAccessed: false,
      fontDownloaded: false,
      importedCodeExecuted: false,
      dependencyChanged: false,
    })
    expect(proposed.plan.mappings).toEqual([expect.objectContaining({
      requestedFamily: 'Inter',
      sourceVariable: '--font-inter',
      tokenVariable: '--font-body',
      stylesheetPath: 'src/app/globals.css',
      fallbackStack: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    })])
    expect(proposed.plan.patches.map(({ path }) => path)).toEqual(['src/app/layout.tsx', 'src/app/globals.css'])
    expect(proposed.receipt).toMatchObject({ state: 'proposed', executableChange: true, confirmationActorId: null })
    expect((await repository.getRevision(draft.revisionId))!.revision.analysis.diagnostics).toContainEqual(diagnostic)
    await expect(service.applyFix(proposed.receipt.receiptId)).rejects.toThrow('owner diff confirmation')

    await service.confirmFix({ receiptId: proposed.receipt.receiptId, ownerActorId: 'owner-font-reviewer' })
    expect((await repository.getRevision(draft.revisionId))!.revision.analysis.diagnostics).toContainEqual(diagnostic)
    const applied = await service.applyFix(proposed.receipt.receiptId)
    expect(applied.analysis.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(0)
    const appliedFiles = (await repository.getRevision(applied.revisionId))!.files
    const layout = decoder.decode(appliedFiles.files['src/app/layout.tsx']!.bytes)
    const css = decoder.decode(appliedFiles.files['src/app/globals.css']!.bytes)
    expect(layout).not.toContain('next/font/google')
    expect(layout).not.toContain('inter.variable')
    expect(css).toContain('--font-body: system-ui, -apple-system, "Segoe UI", sans-serif;')
    expect(css).not.toContain('--font-inter')
  })

  test('keeps the public deterministic proposal path strict for server and secret authority', async () => {
    const { files, service } = harness(fixture())
    const draft = await service.createDraft(files, { destination, provenance: { kind: 'file-map', locator: 'font-public-strict' } })
    const diagnostic = draft.analysis.diagnostics.find(({ specifier }) => specifier === 'next/font/google')!
    const evidence = draft.analysis.files.find(({ path }) => path === 'src/app/layout.tsx')!
    const original = decoder.decode(files.files['src/app/layout.tsx']!.bytes)
    await expect(service.proposeFix({
      authority: policyAuthority(draft.revisionId),
      diagnosticIds: [diagnostic.id],
      patches: [{
        path: 'src/app/layout.tsx',
        expectedSha256: evidence.sha256,
        replacement: `${original}\nconst forbidden = process.env.FONT_SECRET\n`,
      }],
    })).rejects.toThrow('forbidden dynamic/server/secret authority')
  })

  test.each([
    {
      name: 'unknown loader option',
      files: fixture({ options: 'subsets: ["latin"], weight: ["400"], style: ["normal"], variable: "--font-inter", display: "swap", preload: false' }),
      message: 'option: preload',
    },
    {
      name: 'non-variable runtime usage',
      files: fixture({ usage: 'className={inter.className}' }),
      message: 'only .variable',
    },
    {
      name: 'missing concrete fallback',
      files: fixture({ css: ':root { --font-body: var(--font-inter); }' }),
      message: 'leading family',
    },
  ])('fails closed for $name without proposing or changing the diagnostic', async ({ files, message }) => {
    const { repository, service } = harness(files)
    const draft = await service.createDraft(files, { destination, provenance: { kind: 'file-map', locator: 'font-negative' } })
    const diagnostic = draft.analysis.diagnostics.find(({ specifier }) => specifier === 'next/font/google')!
    await expect(service.proposeDeterministicFontFix({
      authority: policyAuthority(draft.revisionId),
      diagnosticId: diagnostic.id,
    })).rejects.toThrow(message)
    expect((await repository.getRevision(draft.revisionId))!.revision.analysis.diagnostics).toContainEqual(diagnostic)
  })
})
