import type { FumaRepositoryScopeCoordinate } from '../tenancy'
import type {
  EditorDraftMutationReceipt,
  EditorDraftStreamKey,
  EditorMutationId,
  EditorScopedStorageEntry,
  EditorScopedStorageKey,
  EditorScopedStoragePrefix,
} from './contracts'

/**
 * Transactional persistence primitive used by the scoped editor repository.
 * A production adapter must hold the loaded owner authority stable (row lock
 * or equivalent) until the transaction commits. No database shape is assumed.
 */
export interface EditorScopedStorageTransaction {
  loadScopeAuthorityForUpdate(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<unknown | null>
  get(key: EditorScopedStorageKey): Promise<unknown | null>
  list(prefix: EditorScopedStoragePrefix): Promise<readonly EditorScopedStorageEntry[]>
  put(key: EditorScopedStorageKey, value: unknown): Promise<void>
  delete(key: EditorScopedStorageKey): Promise<void>
  deletePrefix(prefix: EditorScopedStoragePrefix): Promise<void>
  /** Creates the stream at sequence zero if absent, then locks and returns its head. */
  lockDraftSequence(key: EditorDraftStreamKey): Promise<number>
  setDraftSequence(
    key: EditorDraftStreamKey,
    expectedSequence: number,
    sequence: number,
  ): Promise<void>
  getDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
  ): Promise<EditorDraftMutationReceipt | null>
  putDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
    receipt: EditorDraftMutationReceipt,
  ): Promise<void>
}

/** Atomic commit/rollback boundary supplied by the eventual storage adapter. */
export interface EditorScopedStorage {
  transaction<T>(
    work: (transaction: EditorScopedStorageTransaction) => Promise<T>,
  ): Promise<T>
}
