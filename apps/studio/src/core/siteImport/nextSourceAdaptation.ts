import { safeParseValue } from '@core/utils/typeboxHelpers'
import { analyzeNextSource } from './analyzeNextSource'
import { buildNextSourceGoogleFontSystemFix } from './nextSourceFontAdaptation'
import { inventoryNextSourceFiles, nextSourceSha256 } from './nextSourceAnalysisFiles'
import type { FileMap } from './types'
import type {
  NextSourceAnalysisRequest,
  NextSourceDestination,
  NextSourceInteractionBinding,
} from './nextSourceContracts'
import {
  createReviewedNextSourceInteractionBinding,
  isNextSourceInteractionAuthorityAvailable,
} from './nextSourceInteractionBindings'
import {
  NextSourceFixAuthoritySchema,
  NextSourceFixReceiptSchema,
  NextSourcePatchSchema,
  NextSourceRollbackReceiptSchema,
  type NextSourceDraftRevision,
  type NextSourceFixAuthority,
  type NextSourceFixReceipt,
  type NextSourcePatch,
  type NextSourceRollbackReceipt,
} from './nextSourcePortabilityContracts'

const EXECUTABLE = /\.(?:js|jsx|ts|tsx|mjs|cjs|mdx)$/
const FORBIDDEN_PATCH_PATH = /(?:^|\/)(?:package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config\.[^/]+|middleware\.[^/]+|pages\/api\/|app\/api\/)/
const FORBIDDEN_SOURCE = /(?:\bprocess\.env\b|\bimport\.meta\.env\b|\brequire\s*\(\s*[^"']|\bimport\s*\(\s*[^"']|\b(?:eval|Function)\s*\(|\b(?:child_process|node:|fs\/promises)\b)/
const SECRET_SHAPE = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|PAYSTACK_SECRET|GITHUB_TOKEN|SESSION_SECRET)/i
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export interface NextSourceAdaptationAuthorityPort {
  authorize(input: NextSourceFixAuthority): Promise<Readonly<{
    replayReceiptId: string | null
    active: boolean
    meteringAccepted: boolean
  }>>
  settle(input: Readonly<{ operationId: string; receiptId: string; inputBytes: number; outputBytes: number }>): Promise<void>
}

export interface NextSourceOwnerConfirmationPort {
  verifyOwner(input: Readonly<{
    receiptId: string
    actorId: string
    destination: NextSourceDestination
    expectedOwnerGeneration: number
  }>): Promise<Readonly<{
    active: boolean
    direct: boolean
    impersonating: boolean
    ownerGeneration: number
  }>>
}

export interface NextSourceDraftRepository {
  getRevision(revisionId: string): Promise<Readonly<{ revision: NextSourceDraftRevision; files: FileMap }> | null>
  putRevision(value: Readonly<{ revision: NextSourceDraftRevision; files: FileMap }>): Promise<void>
  getFix(receiptId: string): Promise<Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }> | null>
  putFix(value: Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }>): Promise<void>
  updateFix(receipt: NextSourceFixReceipt): Promise<void>
  putRollback(receipt: NextSourceRollbackReceipt): Promise<void>
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sourceHash(fileMap: FileMap): Promise<string> {
  const files = await inventoryNextSourceFiles(fileMap, Object.keys(fileMap.files).sort())
  return nextSourceSha256(encoder.encode(JSON.stringify(
    files.map((file) => [file.path, file.sizeBytes, file.sha256]),
  )))
}

function sameDestination(left: NextSourceDestination, right: NextSourceDestination): boolean {
  return left.organizationId === right.organizationId && left.workspaceId === right.workspaceId && left.siteId === right.siteId
}

function cloneFileMap(value: FileMap): FileMap {
  return {
    files: Object.fromEntries(Object.entries(value.files).map(([path, entry]) => [path, { ...entry, bytes: entry.bytes.slice() }])),
    ...(value.strippedTopLevelFolder ? { strippedTopLevelFolder: value.strippedTopLevelFolder } : {}),
  }
}

function matchInventory(pattern: RegExp, value: string): Map<string, number> {
  const flags = `${pattern.flags.replaceAll('g', '')}g`
  const output = new Map<string, number>()
  for (const match of value.matchAll(new RegExp(pattern.source, flags))) {
    output.set(match[0], (output.get(match[0]) ?? 0) + 1)
  }
  return output
}

function containsAddedMatch(pattern: RegExp, before: string, replacement: string): boolean {
  const prior = matchInventory(pattern, before)
  for (const [match, count] of matchInventory(pattern, replacement)) {
    if (count > (prior.get(match) ?? 0)) return true
  }
  return false
}

function assertPatch(path: string, before: string, replacement: string, preserveExistingForbidden: boolean): void {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || FORBIDDEN_PATCH_PATH.test(path)) {
    throw new Error(`Source patch is outside the confined presentation surface: ${path}`)
  }
  const secret = preserveExistingForbidden ? containsAddedMatch(SECRET_SHAPE, before, replacement) : SECRET_SHAPE.test(replacement)
  if (secret) throw new Error('Secret-shaped source cannot enter an adaptation patch.')
  const forbidden = preserveExistingForbidden ? containsAddedMatch(FORBIDDEN_SOURCE, before, replacement) : FORBIDDEN_SOURCE.test(replacement)
  if (forbidden) throw new Error('Adaptation patch requests forbidden dynamic/server/secret authority.')
}

function reviewedBindingsFromAnalysis(
  revision: NextSourceDraftRevision,
): NextSourceInteractionBinding[] {
  return revision.analysis.interactions.flatMap((interaction) => {
    if (interaction.boundAuthority === null) return []
    const binding = createReviewedNextSourceInteractionBinding(
      interaction.id,
      interaction.kind,
      interaction.boundAuthority,
    )
    if (!binding) throw new Error('Analyzed interaction contains an incompatible reviewed authority.')
    return [binding]
  })
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

export class MemoryNextSourceDraftRepository implements NextSourceDraftRepository {
  readonly #revisions = new Map<string, Readonly<{ revision: NextSourceDraftRevision; files: FileMap }>>()
  readonly #fixes = new Map<string, Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }>>()
  readonly #rollbacks = new Map<string, NextSourceRollbackReceipt>()
  async getRevision(id: string) { const value = this.#revisions.get(id); return value ? structuredClone(value) : null }
  async putRevision(value: Readonly<{ revision: NextSourceDraftRevision; files: FileMap }>) {
    const actualSourceHash = await sourceHash(value.files)
    if (actualSourceHash !== value.revision.sourceHashSha256) throw new Error('Draft revision files do not match their source hash.')
    const prior = this.#revisions.get(value.revision.revisionId)
    if (prior && (canonical(prior.revision) !== canonical(value.revision) || await sourceHash(prior.files) !== actualSourceHash)) {
      throw new Error('Draft revision identity is immutable.')
    }
    this.#revisions.set(value.revision.revisionId, structuredClone(value))
  }
  async getFix(id: string) { const value = this.#fixes.get(id); return value ? structuredClone(value) : null }
  async putFix(value: Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }>) {
    const prior = this.#fixes.get(value.receipt.receiptId)
    if (prior && canonical(prior) !== canonical(value)) throw new Error('Fix receipt replay evidence changed.')
    if (!prior) this.#fixes.set(value.receipt.receiptId, structuredClone(value))
  }
  async updateFix(receipt: NextSourceFixReceipt) {
    const prior = this.#fixes.get(receipt.receiptId)
    if (!prior) throw new Error('Fix receipt is unavailable.')
    this.#fixes.set(receipt.receiptId, structuredClone({ receipt, patches: prior.patches }))
  }
  async putRollback(receipt: NextSourceRollbackReceipt) {
    const prior = this.#rollbacks.get(receipt.receiptId)
    if (prior && canonical(prior) !== canonical(receipt)) throw new Error('Rollback receipt identity changed.')
    this.#rollbacks.set(receipt.receiptId, structuredClone(receipt))
  }
}

export class NextSourceAdaptationService {
  readonly #repository: NextSourceDraftRepository
  readonly #authority: NextSourceAdaptationAuthorityPort
  readonly #ownerConfirmation: NextSourceOwnerConfirmationPort
  readonly #now: () => Date
  readonly #id: () => string

  constructor(input: Readonly<{
    repository: NextSourceDraftRepository
    authority: NextSourceAdaptationAuthorityPort
    ownerConfirmation: NextSourceOwnerConfirmationPort
    now?: () => Date
    generateId?: () => string
  }>) {
    this.#repository = input.repository
    this.#authority = input.authority
    this.#ownerConfirmation = input.ownerConfirmation
    this.#now = input.now ?? (() => new Date())
    this.#id = input.generateId ?? (() => crypto.randomUUID())
  }

  async createDraft(
    files: FileMap,
    request: NextSourceAnalysisRequest,
    parentRevisionId: string | null = null,
    fixReceiptIds: readonly string[] = [],
  ): Promise<NextSourceDraftRevision> {
    const analysis = await analyzeNextSource(files, request)
    const revision: NextSourceDraftRevision = {
      revisionId: `next-draft:${this.#id()}`,
      destination: request.destination,
      provenance: request.provenance,
      parentRevisionId,
      sourceHashSha256: analysis.sourceHashSha256,
      analysis,
      fixReceiptIds: [...fixReceiptIds],
      state: 'draft',
      createdAt: this.#now().toISOString(),
    }
    await this.#repository.putRevision({ revision, files: cloneFileMap(files) })
    return structuredClone(revision)
  }

  async mapInteractions(input: Readonly<{
    sourceRevisionId: string
    profileId: string
    bindings: readonly NextSourceInteractionBinding[]
  }>): Promise<NextSourceDraftRevision> {
    const current = await this.#repository.getRevision(input.sourceRevisionId)
    if (!current || current.revision.state !== 'draft') throw new Error('Exact active source draft is unavailable.')
    if (input.bindings.length === 0 || input.bindings.length > 2_000) {
      throw new Error('A bounded reviewed interaction mapping set is required.')
    }
    const merged = new Map(reviewedBindingsFromAnalysis(current.revision).map((binding) => [binding.interactionId, binding]))
    for (const binding of input.bindings) {
      if (!isNextSourceInteractionAuthorityAvailable(input.profileId, binding)) {
        throw new Error(`Interaction binding ${binding.interactionId} is not available for the destination profile.`)
      }
      merged.set(binding.interactionId, binding)
    }
    return this.createDraft(current.files, {
      destination: current.revision.destination,
      provenance: current.revision.provenance,
      interactionBindings: [...merged.values()].sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
    }, current.revision.revisionId, current.revision.fixReceiptIds)
  }

  async proposeDeterministicFontFix(input: Readonly<{
    authority: NextSourceFixAuthority
    diagnosticId: string
  }>) {
    if (
      input.authority.kind !== 'deterministic'
      || input.authority.actorId !== 'fuma-next-source-policy'
      || input.authority.meteringReservationId !== null
      || input.authority.capability !== 'source.mutate'
    ) throw new Error('Reviewed deterministic Next-source policy authority is required.')
    const current = await this.#repository.getRevision(input.authority.sourceRevisionId)
    if (!current || current.revision.state !== 'draft' || !sameDestination(current.revision.destination, input.authority.destination)) {
      throw new Error('Exact active source draft is unavailable.')
    }
    const plan = await buildNextSourceGoogleFontSystemFix(current.revision, current.files, input.diagnosticId)
    const candidateFiles = cloneFileMap(current.files)
    for (const patch of plan.patches) {
      const source = candidateFiles.files[patch.path]
      if (!source || await sha256(source.bytes) !== patch.expectedSha256) throw new Error('Deterministic font fix precondition changed.')
      candidateFiles.files[patch.path] = { ...source, bytes: encoder.encode(patch.replacement) }
    }
    const retainedBindings = reviewedBindingsFromAnalysis(current.revision)
    const candidate = await analyzeNextSource(candidateFiles, {
      destination: current.revision.destination,
      provenance: current.revision.provenance,
      ...(retainedBindings.length > 0 ? { interactionBindings: retainedBindings } : {}),
    })
    const reviewedDiagnosticIds = new Set(plan.diagnosticIds)
    const reviewedDiagnostics = current.revision.analysis.diagnostics
      .filter(({ id }) => reviewedDiagnosticIds.has(id))
    if (
      reviewedDiagnostics.length !== plan.diagnosticIds.length
      || reviewedDiagnostics.some((item) => item.id !== input.diagnosticId
        && (item.category !== 'dynamic-tailwind-denied' || item.path !== plan.sourcePath))
    ) throw new Error('Deterministic font fix attempted to bind an unrelated diagnostic.')
    const beforeIds = current.revision.analysis.diagnostics
      .filter(({ id }) => !reviewedDiagnosticIds.has(id)).map(({ id }) => id).sort()
    const afterIds = candidate.diagnostics.map(({ id }) => id).sort()
    const beforeUnsupported = current.revision.analysis.diagnostics
      .filter(({ category }) => category === 'unsupported-next-api').length
    const afterUnsupported = candidate.diagnostics
      .filter(({ category }) => category === 'unsupported-next-api').length
    if (
      canonical(beforeIds) !== canonical(afterIds)
      || beforeUnsupported - afterUnsupported !== 1
      || candidate.diagnostics.some(({ id }) => id === input.diagnosticId)
    ) throw new Error(`Deterministic font fix must remove exactly its bound unsupported-next-api diagnostic and leave every other blocker unchanged (unsupported ${beforeUnsupported}->${afterUnsupported}; before=${JSON.stringify(beforeIds)}; after=${JSON.stringify(afterIds)}).`)
    const receipt = await this.#proposeFix({
      authority: input.authority,
      diagnosticIds: plan.diagnosticIds,
      patches: plan.patches,
    }, true)
    return Object.freeze({ plan, receipt })
  }

  async proposeFix(input: Readonly<{
    authority: NextSourceFixAuthority
    diagnosticIds: readonly string[]
    patches: readonly NextSourcePatch[]
  }>): Promise<NextSourceFixReceipt> {
    return this.#proposeFix(input, false)
  }

  async #proposeFix(input: Readonly<{
    authority: NextSourceFixAuthority
    diagnosticIds: readonly string[]
    patches: readonly NextSourcePatch[]
  }>, preserveExistingForbidden: boolean): Promise<NextSourceFixReceipt> {
    const checkedAuthority = safeParseValue(NextSourceFixAuthoritySchema, input.authority)
    if (!checkedAuthority.ok || checkedAuthority.value.capability !== 'source.mutate') throw new Error('Exact source-mutation authority is required.')
    if (input.patches.length === 0 || input.patches.length > 100) throw new Error('A bounded source patch set is required.')
    if (new Set(input.patches.map(({ path }) => path)).size !== input.patches.length) {
      throw new Error('Each source path may appear only once in a fix proposal.')
    }
    const current = await this.#repository.getRevision(checkedAuthority.value.sourceRevisionId)
    if (!current || !sameDestination(current.revision.destination, checkedAuthority.value.destination) || current.revision.state !== 'draft') throw new Error('Exact active source draft is unavailable.')
    const diagnosticIds = sortedUnique(input.diagnosticIds)
    const known = new Set(current.revision.analysis.diagnostics.map((item) => item.id))
    if (diagnosticIds.length === 0 || diagnosticIds.some((id) => !known.has(id))) throw new Error('Fix must bind existing diagnostics from this exact draft.')
    const patches = await Promise.all(input.patches.map(async (patchValue) => {
      const parsed = safeParseValue(NextSourcePatchSchema, patchValue)
      if (!parsed.ok) throw new Error('Invalid confined source patch.')
      const source = current.files.files[parsed.value.path]
      if (!source || await sha256(source.bytes) !== parsed.value.expectedSha256) throw new Error(`Patch precondition changed for ${parsed.value.path}.`)
      const before = decoder.decode(source.bytes)
      assertPatch(parsed.value.path, before, parsed.value.replacement, preserveExistingForbidden)
      return parsed.value
    }))
    const patchHashSha256 = await sha256(canonical(patches))
    const admission = await this.#authority.authorize(checkedAuthority.value)
    if (!admission.active || !admission.meteringAccepted) throw new Error('Adaptation authority is revoked or unmetered.')
    if (admission.replayReceiptId) {
      const replay = await this.#repository.getFix(admission.replayReceiptId)
      if (
        !replay
        || canonical(replay.receipt.authority) !== canonical(checkedAuthority.value)
        || canonical(replay.receipt.diagnosticIds) !== canonical(diagnosticIds)
        || replay.receipt.patchHashSha256 !== patchHashSha256
      ) throw new Error('Adaptation replay receipt is unavailable or belongs to different authority evidence.')
      return replay.receipt
    }
    const output = cloneFileMap(current.files)
    for (const patch of patches) output.files[patch.path] = { ...output.files[patch.path], bytes: encoder.encode(patch.replacement) }
    const outputSourceHashSha256 = await sourceHash(output)
    const receiptValue = {
      receiptId: `next-fix:${this.#id()}`,
      diagnosticIds,
      authority: checkedAuthority.value,
      inputSourceHashSha256: current.revision.sourceHashSha256,
      outputSourceHashSha256,
      patchHashSha256,
      executableChange: patches.some((patch) => EXECUTABLE.test(patch.path)),
      state: 'proposed',
      confirmationActorId: null,
      createdAt: this.#now().toISOString(),
      confirmedAt: null,
    }
    const receipt = safeParseValue(NextSourceFixReceiptSchema, receiptValue)
    if (!receipt.ok) throw new Error('Fix proposal produced invalid evidence.')
    await this.#repository.putFix({ receipt: receipt.value, patches })
    await this.#authority.settle({ operationId: checkedAuthority.value.operationId, receiptId: receipt.value.receiptId, inputBytes: patches.reduce((sum, patch) => sum + current.files.files[patch.path]!.bytes.byteLength, 0), outputBytes: patches.reduce((sum, patch) => sum + encoder.encode(patch.replacement).byteLength, 0) })
    return receipt.value
  }

  async confirmFix(input: Readonly<{ receiptId: string; ownerActorId: string }>): Promise<NextSourceFixReceipt> {
    const value = await this.#repository.getFix(input.receiptId)
    if (!value || value.receipt.state !== 'proposed') throw new Error('Proposed fix is unavailable.')
    const owner = await this.#ownerConfirmation.verifyOwner({
      receiptId: value.receipt.receiptId,
      actorId: input.ownerActorId,
      destination: value.receipt.authority.destination,
      expectedOwnerGeneration: value.receipt.authority.ownerGeneration,
    })
    if (
      !owner.active || !owner.direct || owner.impersonating
      || owner.ownerGeneration !== value.receipt.authority.ownerGeneration
      || input.ownerActorId === value.receipt.authority.actorId
    ) throw new Error('A fresh direct owner, distinct from adaptation authority, must confirm executable source.')
    const receipt: NextSourceFixReceipt = { ...value.receipt, state: 'owner-confirmed', confirmationActorId: input.ownerActorId, confirmedAt: this.#now().toISOString() }
    await this.#repository.updateFix(receipt)
    return receipt
  }

  async applyFix(receiptId: string): Promise<NextSourceDraftRevision> {
    const value = await this.#repository.getFix(receiptId)
    if (!value) throw new Error('Fix receipt is unavailable.')
    if (value.receipt.executableChange && value.receipt.state !== 'owner-confirmed') throw new Error('Executable adaptation requires owner diff confirmation.')
    if (!value.receipt.executableChange && !['proposed', 'owner-confirmed'].includes(value.receipt.state)) throw new Error('Fix is not applicable.')
    const current = await this.#repository.getRevision(value.receipt.authority.sourceRevisionId)
    if (!current || current.revision.sourceHashSha256 !== value.receipt.inputSourceHashSha256) throw new Error('Fix source revision changed.')
    const files = cloneFileMap(current.files)
    for (const patch of value.patches) {
      const source = files.files[patch.path]
      if (!source || await sha256(source.bytes) !== patch.expectedSha256) throw new Error('Fix precondition changed before apply.')
      files.files[patch.path] = { ...source, bytes: encoder.encode(patch.replacement) }
    }
    if (await sourceHash(files) !== value.receipt.outputSourceHashSha256) throw new Error('Fix output hash mismatch.')
    const baseRequest = {
      destination: current.revision.destination,
      provenance: current.revision.provenance,
    }
    const candidate = await analyzeNextSource(files, baseRequest)
    const candidateInteractions = new Set(candidate.interactions.map((interaction) => `${interaction.kind}\u0000${interaction.id}`))
    const retainedBindings = reviewedBindingsFromAnalysis(current.revision)
      .filter((binding) => candidateInteractions.has(`${binding.kind}\u0000${binding.interactionId}`))
    const next = await this.createDraft(
      files,
      {
        ...baseRequest,
        ...(retainedBindings.length > 0 ? { interactionBindings: retainedBindings } : {}),
      },
      current.revision.revisionId,
      [...current.revision.fixReceiptIds, receiptId],
    )
    await this.#repository.updateFix({ ...value.receipt, state: 'applied' })
    return next
  }

  async rollback(input: Readonly<{ currentRevisionId: string; restoreRevisionId: string; actorId: string }>): Promise<NextSourceRollbackReceipt> {
    const [current, restore] = await Promise.all([this.#repository.getRevision(input.currentRevisionId), this.#repository.getRevision(input.restoreRevisionId)])
    if (!current || !restore || !sameDestination(current.revision.destination, restore.revision.destination)) throw new Error('Rollback revisions must share one exact destination.')
    const receiptValue = {
      receiptId: `next-rollback:${this.#id()}`,
      destination: current.revision.destination,
      fromRevisionId: current.revision.revisionId,
      restoredRevisionId: restore.revision.revisionId,
      restoredSourceHashSha256: restore.revision.sourceHashSha256,
      actorId: input.actorId,
      createdAt: this.#now().toISOString(),
    }
    const receipt = safeParseValue(NextSourceRollbackReceiptSchema, receiptValue)
    if (!receipt.ok) throw new Error('Rollback produced invalid evidence.')
    await this.#repository.putRollback(receipt.value)
    return receipt.value
  }
}

export function nextSourceCanPublish(
  revision: NextSourceDraftRevision,
  fixes: readonly NextSourceFixReceipt[],
  profileId: string,
): boolean {
  if (
    revision.analysis.blocking
    || revision.analysis.diagnostics.some((item) => item.severity === 'blocking')
    || revision.analysis.interactions.some((interaction) => {
      if (interaction.boundAuthority === null) return true
      return !isNextSourceInteractionAuthorityAvailable(profileId, {
        kind: interaction.kind,
        authority: interaction.boundAuthority,
      })
    })
  ) return false
  const expected = new Set(revision.fixReceiptIds)
  if (
    fixes.length !== expected.size
    || fixes.some((fix) => !expected.has(fix.receiptId) || !sameDestination(fix.authority.destination, revision.destination))
  ) return false
  const byId = new Map(fixes.map((fix) => [fix.receiptId, fix]))
  const finalFixId = revision.fixReceiptIds.at(-1)
  if (finalFixId && byId.get(finalFixId)?.outputSourceHashSha256 !== revision.sourceHashSha256) return false
  return fixes.every((fix) => fix.state === 'applied'
    && (!fix.executableChange || fix.confirmationActorId !== null && fix.confirmationActorId !== fix.authority.actorId))
}
