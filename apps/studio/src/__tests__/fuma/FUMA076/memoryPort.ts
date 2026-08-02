import type {
  GhostImportExecutionPort,
  GhostImportReceiptV2,
  GhostMappedObject,
  GhostMediaObject,
  StructuredGhostImportPlan,
} from '../../../../../../packages/fuma-governance-launch/src/ghostImport'

export class FUMA076MemoryImportPort implements GhostImportExecutionPort {
  readonly objects = new Map<string, GhostMappedObject>()
  readonly media = new Map<string, Uint8Array>()
  readonly receipts = new Map<string, GhostImportReceiptV2>()
  readonly cursors: string[] = []
  readonly objectApplyCount = new Map<string, number>()
  readonly mediaApplyCount = new Map<string, number>()
  failMediaUrlOnce: string | null = null
  #failed = false

  async findReceipt(hash: string): Promise<GhostImportReceiptV2 | null> { return this.receipts.get(hash) ?? null }
  async begin(_plan: StructuredGhostImportPlan): Promise<void> {}
  async objectState(importId: string, kind: GhostMappedObject['kind'], sourceId: string): Promise<'pending' | 'applied'> {
    return this.objects.has(`${importId}:${kind}:${sourceId}`) ? 'applied' : 'pending'
  }
  async applyObject(importId: string, value: GhostMappedObject): Promise<void> {
    const key = `${importId}:${value.kind}:${value.sourceId}`
    this.objectApplyCount.set(key, (this.objectApplyCount.get(key) ?? 0) + 1)
    this.objects.set(key, value)
  }
  async mediaState(importId: string, destinationKey: string): Promise<'pending' | 'applied'> {
    return this.media.has(`${importId}:${destinationKey}`) ? 'applied' : 'pending'
  }
  async fetchMedia(sourceUrl: string): Promise<Uint8Array> {
    if (sourceUrl === this.failMediaUrlOnce && !this.#failed) {
      this.#failed = true
      throw new Error('FUMA-076 injected media fault')
    }
    return new TextEncoder().encode(sourceUrl)
  }
  async applyMedia(importId: string, value: GhostMediaObject, bytes: Uint8Array): Promise<void> {
    const key = `${importId}:${value.destinationKey}`
    this.mediaApplyCount.set(key, (this.mediaApplyCount.get(key) ?? 0) + 1)
    this.media.set(key, bytes)
  }
  async saveCursor(_importId: string, cursor: string): Promise<void> { this.cursors.push(cursor) }
  async complete(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2> {
    this.receipts.set(receipt.manifestHashSha256, receipt)
    return receipt
  }
  async rollbackObject(importId: string, value: GhostMappedObject): Promise<void> {
    this.objects.delete(`${importId}:${value.kind}:${value.sourceId}`)
  }
  async rollbackMedia(importId: string, value: GhostMediaObject): Promise<void> {
    this.media.delete(`${importId}:${value.destinationKey}`)
  }
  async completeRollback(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2> {
    this.receipts.set(receipt.manifestHashSha256, receipt)
    return receipt
  }
}
