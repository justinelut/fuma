import { SavedLayoutSchema } from '@core/layouts'
import {
  PageSchema,
  SiteShellSchema,
} from '@core/page-tree'
import {
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import { VisualComponentSchema } from '@core/visualComponents'
import {
  FumaRepositoryScopeSchema,
  type FumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
} from '../tenancy'
import {
  EditorDraftMutationReceiptSchema,
  EditorDraftMutationSchema,
  EditorIncrementalSaveSchema,
  EditorScopedRepositoryError,
  EditorScopedStorageEntrySchema,
  EditorSiteDocumentSchema,
  EditorSiteSessionIdentitySchema,
  type EditorDraftAccepted,
  type EditorDraftConflict,
  type EditorDraftMutation,
  type EditorDraftMutationReceipt,
  type EditorDraftMutationResult,
  type EditorDraftSnapshot,
  type EditorDraftStreamKey,
  type EditorIncrementalSave,
  type EditorResourceKind,
  type EditorScopedRepositoryErrorCode,
  type EditorScopedStorageKey,
  type EditorScopedStoragePrefix,
  type EditorSiteDocument,
  type EditorSiteSessionIdentity,
} from './contracts'
import type {
  EditorScopedStorage,
  EditorScopedStorageTransaction,
} from './storage'

function fail(
  code: EditorScopedRepositoryErrorCode,
  message: string,
): never {
  throw new EditorScopedRepositoryError(code, message)
}

function deny(): never {
  return fail('denied', 'Editor repository scope authority denied.')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function detachedFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function parseContract<T extends TSchema>(
  schema: T,
  value: unknown,
  code: EditorScopedRepositoryErrorCode,
  message: string,
): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) return fail(code, message)
  return parsed.value
}

function bindIdentity(value: EditorSiteSessionIdentity): EditorSiteSessionIdentity {
  const parsed = parseContract(
    EditorSiteSessionIdentitySchema,
    value,
    'invalid-session',
    'A valid active editor site session identity is required.',
  )
  return detachedFrozen(parsed)
}

function coordinate(identity: EditorSiteSessionIdentity): FumaRepositoryScopeCoordinate {
  return Object.freeze({
    platformId: identity.platformId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    siteId: identity.siteId,
  })
}

function exactActiveScope(
  authority: FumaRepositoryScope,
  identity: EditorSiteSessionIdentity,
): boolean {
  return authority.state === 'active'
    && authority.transferFence === null
    && authority.platformId === identity.platformId
    && authority.organizationId === identity.organizationId
    && authority.workspaceId === identity.workspaceId
    && authority.siteId === identity.siteId
    && authority.ownerKey === identity.ownerKey
    && authority.generation === identity.generation
}

function key(
  identity: EditorSiteSessionIdentity,
  resourceKind: EditorResourceKind,
  logicalId: string,
): EditorScopedStorageKey {
  return Object.freeze({
    platformId: identity.platformId,
    ownerKey: identity.ownerKey,
    generation: identity.generation,
    resourceKind,
    logicalId,
  })
}

function prefix(
  identity: EditorSiteSessionIdentity,
  resourceKind: EditorResourceKind,
): EditorScopedStoragePrefix {
  return Object.freeze({
    platformId: identity.platformId,
    ownerKey: identity.ownerKey,
    generation: identity.generation,
    resourceKind,
  })
}

function sameKey(
  actual: EditorScopedStorageKey,
  expected: EditorScopedStorageKey,
): boolean {
  return actual.platformId === expected.platformId
    && actual.ownerKey === expected.ownerKey
    && actual.generation === expected.generation
    && actual.resourceKind === expected.resourceKind
    && actual.logicalId === expected.logicalId
}

function assertDistinctAndDisjoint(
  values: readonly { readonly id: string }[],
  deletedIds: readonly string[],
  label: string,
): void {
  const changed = new Set<string>()
  for (const value of values) {
    if (changed.has(value.id)) {
      fail('invalid-input', `Duplicate changed ${label} ID "${value.id}".`)
    }
    changed.add(value.id)
  }
  for (const id of deletedIds) {
    if (changed.has(id)) {
      fail('invalid-input', `${label} "${id}" cannot be changed and deleted together.`)
    }
  }
}

function assertDocumentIdentity(
  identity: EditorSiteSessionIdentity,
  site: { readonly id: string },
): void {
  if (site.id !== identity.siteId) {
    fail('invalid-input', 'The editor document does not belong to the bound site session.')
  }
}

function parseSave(input: EditorIncrementalSave): EditorIncrementalSave {
  const parsed = parseContract(
    EditorIncrementalSaveSchema,
    input,
    'invalid-input',
    'The incremental editor save contract is invalid.',
  )
  assertDistinctAndDisjoint(parsed.changedPages, parsed.deletedPageIds, 'page')
  assertDistinctAndDisjoint(
    parsed.changedComponents,
    parsed.deletedComponentIds,
    'component',
  )
  assertDistinctAndDisjoint(parsed.changedLayouts, parsed.deletedLayoutIds, 'layout')
  return parsed
}

function parseReplacement(input: EditorSiteDocument): EditorSiteDocument {
  const parsed = parseContract(
    EditorSiteDocumentSchema,
    input,
    'invalid-input',
    'The replacement editor document contract is invalid.',
  )
  assertDistinctAndDisjoint(parsed.pages, [], 'page')
  assertDistinctAndDisjoint(parsed.visualComponents, [], 'component')
  assertDistinctAndDisjoint(parsed.layouts, [], 'layout')
  return parsed
}

async function readCollection<T extends { readonly id: string }>(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
  resourceKind: Exclude<EditorResourceKind, 'site-shell'>,
  parseValue: (value: unknown) => T,
): Promise<T[]> {
  const entries = await transaction.list(prefix(identity, resourceKind))
  const values: T[] = []
  const seen = new Set<string>()

  for (const rawEntry of entries) {
    const entry = parseContract(
      EditorScopedStorageEntrySchema,
      rawEntry,
      'invalid-storage',
      'Stored editor entry is invalid.',
    )
    const value = parseValue(entry.value)
    const expectedKey = key(identity, resourceKind, value.id)
    if (!sameKey(entry.key, expectedKey) || seen.has(value.id)) {
      fail('invalid-storage', 'Stored editor entry does not match its scoped key.')
    }
    seen.add(value.id)
    values.push(value)
  }

  values.sort((left, right) => left.id.localeCompare(right.id))
  return values
}

async function readDocument(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
): Promise<EditorSiteDocument | null> {
  const shellValue = await transaction.get(key(identity, 'site-shell', identity.siteId))
  const [pages, visualComponents, layouts] = await Promise.all([
    readCollection(transaction, identity, 'page', (value) => parseContract(
      PageSchema,
      value,
      'invalid-storage',
      'Stored editor page is invalid.',
    )),
    readCollection(transaction, identity, 'component', (value) => parseContract(
      VisualComponentSchema,
      value,
      'invalid-storage',
      'Stored editor component is invalid.',
    )),
    readCollection(transaction, identity, 'layout', (value) => parseContract(
      SavedLayoutSchema,
      value,
      'invalid-storage',
      'Stored editor layout is invalid.',
    )),
  ])

  if (shellValue === null) {
    if (pages.length > 0 || visualComponents.length > 0 || layouts.length > 0) {
      fail('invalid-storage', 'Stored editor collections exist without a site shell.')
    }
    return null
  }

  const site = parseContract(
    SiteShellSchema,
    shellValue,
    'invalid-storage',
    'Stored editor site shell is invalid.',
  )
  if (site.id !== identity.siteId) {
    fail('invalid-storage', 'Stored editor site shell does not match its scoped key.')
  }
  return detachedFrozen({ site, pages, visualComponents, layouts })
}

async function putValues<T extends { readonly id: string }>(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
  resourceKind: Exclude<EditorResourceKind, 'site-shell'>,
  values: readonly T[],
): Promise<void> {
  for (const value of values) {
    await transaction.put(key(identity, resourceKind, value.id), structuredClone(value))
  }
}

async function deleteValues(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
  resourceKind: Exclude<EditorResourceKind, 'site-shell'>,
  logicalIds: readonly string[],
): Promise<void> {
  for (const logicalId of logicalIds) {
    await transaction.delete(key(identity, resourceKind, logicalId))
  }
}

function draftStreamKey(identity: EditorSiteSessionIdentity): EditorDraftStreamKey {
  return Object.freeze({
    platformId: identity.platformId,
    ownerKey: identity.ownerKey,
    generation: identity.generation,
    profileId: identity.profileId,
    resourceKind: 'site-document' as const,
    logicalId: identity.siteId,
  })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).sort().map((name) => (
    `${JSON.stringify(name)}:${canonicalJson(record[name])}`
  )).join(',')}}`
}

function mutationHash(mutation: EditorDraftMutation): string {
  return new Bun.CryptoHasher('sha256')
    .update(canonicalJson(mutation))
    .digest('hex')
}

function parseMutation(input: EditorDraftMutation): EditorDraftMutation {
  return parseContract(
    EditorDraftMutationSchema,
    input,
    'invalid-input',
    'The editor draft mutation contract is invalid.',
  )
}

function parseReceipt(value: unknown): EditorDraftMutationReceipt {
  return parseContract(
    EditorDraftMutationReceiptSchema,
    value,
    'invalid-storage',
    'Stored editor mutation receipt is invalid.',
  )
}

async function applyIncrementalSave(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
  input: EditorIncrementalSave,
): Promise<void> {
  const save = parseSave(input)
  assertDocumentIdentity(identity, save.site)
  await transaction.put(key(identity, 'site-shell', identity.siteId), structuredClone(save.site))
  await deleteValues(transaction, identity, 'component', save.deletedComponentIds)
  await putValues(transaction, identity, 'component', save.changedComponents)
  await deleteValues(transaction, identity, 'layout', save.deletedLayoutIds)
  await putValues(transaction, identity, 'layout', save.changedLayouts)
  await deleteValues(transaction, identity, 'page', save.deletedPageIds)
  await putValues(transaction, identity, 'page', save.changedPages)
}

async function applyReplacement(
  transaction: EditorScopedStorageTransaction,
  identity: EditorSiteSessionIdentity,
  input: EditorSiteDocument,
): Promise<void> {
  const replacement = parseReplacement(input)
  assertDocumentIdentity(identity, replacement.site)
  await transaction.put(
    key(identity, 'site-shell', identity.siteId),
    structuredClone(replacement.site),
  )
  for (const resourceKind of ['component', 'layout', 'page'] as const) {
    await transaction.deletePrefix(prefix(identity, resourceKind))
  }
  await putValues(transaction, identity, 'component', replacement.visualComponents)
  await putValues(transaction, identity, 'layout', replacement.layouts)
  await putValues(transaction, identity, 'page', replacement.pages)
}

export interface BoundEditorScopedRepository {
  readonly identity: EditorSiteSessionIdentity
  load(): Promise<EditorSiteDocument | null>
  loadDraft(): Promise<EditorDraftSnapshot>
  mutateDraft(input: EditorDraftMutation): Promise<EditorDraftMutationResult>
  /** @deprecated Compatibility-only FUMA-027 seed path; hosted HTTP never calls it. */
  save(input: EditorIncrementalSave): Promise<EditorSiteDocument>
  /** @deprecated Compatibility-only FUMA-027 seed path; hosted HTTP never calls it. */
  replaceFromImport(input: EditorSiteDocument): Promise<EditorSiteDocument>
}

class BoundEditorRepository implements BoundEditorScopedRepository {
  readonly identity: EditorSiteSessionIdentity
  readonly #storage: EditorScopedStorage

  constructor(identity: EditorSiteSessionIdentity, storage: EditorScopedStorage) {
    this.identity = identity
    this.#storage = storage
    Object.freeze(this)
  }

  load(): Promise<EditorSiteDocument | null> {
    return this.#operation(async (transaction) => (
      await readDocument(transaction, this.identity)
    ))
  }

  loadDraft(): Promise<EditorDraftSnapshot> {
    return this.#operation(async (transaction) => {
      const sequence = await transaction.lockDraftSequence(draftStreamKey(this.identity))
      const document = await readDocument(transaction, this.identity)
      return detachedFrozen({ document, sequence })
    })
  }

  async mutateDraft(input: EditorDraftMutation): Promise<EditorDraftMutationResult> {
    const mutation = parseMutation(input)
    for (const operation of mutation.operations) {
      if (operation.kind === 'incremental-save') {
        const save = parseSave(operation.save)
        assertDocumentIdentity(this.identity, save.site)
      } else {
        const replacement = parseReplacement(operation.document)
        assertDocumentIdentity(this.identity, replacement.site)
      }
    }
    const stream = draftStreamKey(this.identity)
    const requestHash = mutationHash(mutation)

    return await this.#operation(async (transaction) => {
      const sequence = await transaction.lockDraftSequence(stream)
      const storedReceipt = await transaction.getDraftMutationReceipt(
        stream,
        mutation.mutationId,
      )
      if (storedReceipt !== null) {
        const receipt = parseReceipt(storedReceipt)
        if (receipt.requestHash === requestHash) {
          const replay: EditorDraftAccepted = {
            outcome: 'accepted',
            mutationId: mutation.mutationId,
            expectedSequence: receipt.expectedSequence,
            sequence: receipt.acceptedSequence,
            replayed: true,
            document: receipt.document,
          }
          return detachedFrozen(replay)
        }
        const reused: EditorDraftConflict = {
          outcome: 'conflict',
          code: 'mutation-id-reused',
          mutationId: mutation.mutationId,
          expectedSequence: mutation.expectedSequence,
          authoritativeSequence: sequence,
          document: await readDocument(transaction, this.identity),
        }
        return detachedFrozen(reused)
      }

      if (mutation.expectedSequence !== sequence) {
        const conflict: EditorDraftConflict = {
          outcome: 'conflict',
          code: 'draft-sequence-conflict',
          mutationId: mutation.mutationId,
          expectedSequence: mutation.expectedSequence,
          authoritativeSequence: sequence,
          document: await readDocument(transaction, this.identity),
        }
        return detachedFrozen(conflict)
      }
      if (sequence === Number.MAX_SAFE_INTEGER) {
        fail('sequence-exhausted', 'The editor draft sequence is exhausted.')
      }

      for (const operation of mutation.operations) {
        if (operation.kind === 'incremental-save') {
          await applyIncrementalSave(transaction, this.identity, operation.save)
        } else {
          await applyReplacement(transaction, this.identity, operation.document)
        }
      }
      const document = await readDocument(transaction, this.identity)
      if (document === null) {
        fail('invalid-storage', 'Atomic editor mutation produced no document.')
      }
      const nextSequence = sequence + 1
      const receipt: EditorDraftMutationReceipt = {
        requestHash,
        expectedSequence: sequence,
        acceptedSequence: nextSequence,
        document,
      }
      await transaction.putDraftMutationReceipt(stream, mutation.mutationId, receipt)
      await transaction.setDraftSequence(stream, sequence, nextSequence)
      const accepted: EditorDraftAccepted = {
        outcome: 'accepted',
        mutationId: mutation.mutationId,
        expectedSequence: sequence,
        sequence: nextSequence,
        replayed: false,
        document,
      }
      return detachedFrozen(accepted)
    })
  }

  async save(input: EditorIncrementalSave): Promise<EditorSiteDocument> {
    const save = parseSave(input)
    assertDocumentIdentity(this.identity, save.site)
    return await this.#operation(async (transaction) => {
      await transaction.put(
        key(this.identity, 'site-shell', this.identity.siteId),
        structuredClone(save.site),
      )
      await deleteValues(transaction, this.identity, 'component', save.deletedComponentIds)
      await putValues(transaction, this.identity, 'component', save.changedComponents)
      await deleteValues(transaction, this.identity, 'layout', save.deletedLayoutIds)
      await putValues(transaction, this.identity, 'layout', save.changedLayouts)
      await deleteValues(transaction, this.identity, 'page', save.deletedPageIds)
      await putValues(transaction, this.identity, 'page', save.changedPages)
      const document = await readDocument(transaction, this.identity)
      if (document === null) fail('invalid-storage', 'Atomic editor save produced no document.')
      return document
    })
  }

  async replaceFromImport(input: EditorSiteDocument): Promise<EditorSiteDocument> {
    const replacement = parseReplacement(input)
    assertDocumentIdentity(this.identity, replacement.site)
    return await this.#operation(async (transaction) => {
      await transaction.put(
        key(this.identity, 'site-shell', this.identity.siteId),
        structuredClone(replacement.site),
      )
      for (const resourceKind of ['component', 'layout', 'page'] as const) {
        await transaction.deletePrefix(prefix(this.identity, resourceKind))
      }
      await putValues(
        transaction,
        this.identity,
        'component',
        replacement.visualComponents,
      )
      await putValues(transaction, this.identity, 'layout', replacement.layouts)
      await putValues(transaction, this.identity, 'page', replacement.pages)
      const document = await readDocument(transaction, this.identity)
      if (document === null) fail('invalid-storage', 'Atomic editor import produced no document.')
      return document
    })
  }

  async #operation<T>(
    work: (transaction: EditorScopedStorageTransaction) => Promise<T>,
  ): Promise<T> {
    return await this.#storage.transaction(async (transaction) => {
      let rawAuthority: unknown | null
      try {
        rawAuthority = await transaction.loadScopeAuthorityForUpdate(
          coordinate(this.identity),
        )
      } catch (_error) {
        deny()
      }
      if (rawAuthority === null) deny()
      const parsed = safeParseValue(FumaRepositoryScopeSchema, rawAuthority)
      if (!parsed.ok || !exactActiveScope(parsed.value, this.identity)) deny()
      return await work(transaction)
    })
  }
}

/**
 * One-way scope binder. Tenant coordinates appear only in the immutable full
 * session identity; bound operations accept editor documents and logical IDs
 * but no replacement tenant authority.
 */
export class EditorScopedRepository {
  readonly #storage: EditorScopedStorage

  constructor(storage: EditorScopedStorage) {
    this.#storage = storage
  }

  forScope(identity: EditorSiteSessionIdentity): BoundEditorScopedRepository {
    return new BoundEditorRepository(bindIdentity(identity), this.#storage)
  }
}
