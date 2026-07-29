import {
  DomainOperationReceiptSchema,
  credentialAuthorityKey,
  parseDomainContract,
  sameDomainScope,
  type DomainCredentialAuthority,
  type DomainCredentialEnvelope,
  type DomainOperationReceipt,
  type DomainProviderOperation,
  type DomainProviderResult,
  type DomainRecord,
  type DomainScope,
  type DomainTransition,
} from './contracts'
import {
  DomainError,
  type CredentialWriteOutcome,
  type DomainCommercialAuthority,
  type DomainInsertOutcome,
  type DomainRepository,
  type DomainTransitionOutcome,
  type OperationClaimOutcome,
} from './service'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function scopeKey(scope: DomainScope): string {
  return canonical([
    scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId,
    scope.ownerKey, scope.generation, scope.profileId,
  ])
}

function domainKey(scope: DomainScope, domainId: string): string {
  return `${scopeKey(scope)}:${domainId}`
}

function authorityKey(authority: DomainCredentialAuthority, credentialId: string): string {
  return `${credentialAuthorityKey(authority)}:${credentialId}`
}

/** Deterministic serialized authority used only by focused tests and demos. */
export class MemoryDomainRepository implements DomainRepository {
  readonly domains = new Map<string, DomainRecord>()
  readonly transitions: DomainTransition[] = []
  readonly credentials = new Map<string, DomainCredentialEnvelope>()
  readonly credentialHistory: DomainCredentialEnvelope[] = []
  readonly operations = new Map<string, DomainOperationReceipt>()
  #tail: Promise<void> = Promise.resolve()

  async #serialized<T>(work: () => T | Promise<T>): Promise<T> {
    const prior = this.#tail
    let unlock!: () => void
    this.#tail = new Promise<void>((resolve) => { unlock = resolve })
    await prior
    try { return await work() } finally { unlock() }
  }

  async insert(scope: DomainScope, record: DomainRecord): Promise<DomainInsertOutcome> {
    return await this.#serialized(() => {
      const key = domainKey(scope, record.domainId)
      const existing = this.domains.get(key)
      if (existing) return canonical(existing) === canonical(record) ? 'duplicate' : 'collision'
      if ([...this.domains.values()].some((value) => value.platformId === scope.platformId && value.hostname === record.hostname)) return 'collision'
      this.domains.set(key, structuredClone(record))
      return 'created'
    })
  }

  async exact(scope: DomainScope, domainId: string): Promise<DomainRecord | null> {
    return structuredClone(this.domains.get(domainKey(scope, domainId)) ?? null)
  }

  async list(scope: DomainScope): Promise<readonly DomainRecord[]> {
    return Object.freeze([...this.domains.values()]
      .filter((record) => sameDomainScope(record, scope))
      .sort((left, right) => left.hostname.localeCompare(right.hostname))
      .map((record) => structuredClone(record)))
  }

  async transitionByOperation(scope: DomainScope, operationId: string): Promise<DomainTransition | null> {
    return structuredClone(this.transitions.find((value) => sameDomainScope(value, scope) && value.operationId === operationId) ?? null)
  }

  async transition(scope: DomainScope, record: DomainRecord, evidence: DomainTransition): Promise<DomainTransitionOutcome> {
    return await this.#serialized(() => {
      const priorEvidence = this.transitions.find((value) => value.operationId === evidence.operationId)
      if (priorEvidence) return canonical(priorEvidence) === canonical(evidence) ? 'duplicate' : 'conflict'
      const key = domainKey(scope, record.domainId)
      const current = this.domains.get(key)
      if (!current || current.version !== evidence.expectedVersion || current.operationFence !== evidence.fromFence
        || evidence.fromDesired !== current.desired || evidence.fromObserved !== current.observed
        || evidence.fromCertificate !== current.certificate) return 'conflict'
      this.domains.set(key, structuredClone(record))
      this.transitions.push(structuredClone(evidence))
      return 'applied'
    })
  }

  async credentialExact(authority: DomainCredentialAuthority, credentialId: string): Promise<DomainCredentialEnvelope | null> {
    return structuredClone(this.credentials.get(authorityKey(authority, credentialId)) ?? null)
  }

  async storeCredential(envelope: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#serialized(() => {
      const key = authorityKey(envelope.authority, envelope.credentialId)
      const prior = this.credentials.get(key)
      if (prior) return canonical(prior) === canonical(envelope) ? 'duplicate' : 'conflict'
      this.credentials.set(key, structuredClone(envelope))
      this.credentialHistory.push(structuredClone(envelope))
      return 'created'
    })
  }

  async rotateCredential(current: DomainCredentialEnvelope, replacement: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#replaceCredential(current, replacement)
  }

  async revokeCredential(current: DomainCredentialEnvelope, revoked: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#replaceCredential(current, revoked)
  }

  async #replaceCredential(current: DomainCredentialEnvelope, replacement: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#serialized(() => {
      const key = authorityKey(current.authority, current.credentialId)
      const prior = this.credentials.get(key)
      if (!prior || prior.version !== current.version || prior.fence !== current.fence || canonical(prior) !== canonical(current)) return 'conflict'
      this.credentials.set(key, structuredClone(replacement))
      this.credentialHistory.push(structuredClone(replacement))
      return 'created'
    })
  }

  async claimOperation(command: DomainProviderOperation, commandSha256: string, now: string): Promise<OperationClaimOutcome> {
    return await this.#serialized(() => {
      const prior = this.operations.get(command.idempotencyKey)
      if (prior) {
        if (prior.commandSha256 !== commandSha256) throw new DomainError('stale', 'Provider idempotency identity changed.')
        if (prior.state === 'retryable') {
          const next = parseDomainContract(DomainOperationReceiptSchema, {
            ...prior, state: 'claimed', attempt: prior.attempt + 1, failureCode: null, updatedAt: now,
          }, 'Retried operation receipt') as DomainOperationReceipt
          this.operations.set(command.idempotencyKey, structuredClone(next))
          return Object.freeze({ kind: 'claimed' as const, receipt: next })
        }
        return Object.freeze({ kind: 'replay' as const, receipt: structuredClone(prior) })
      }
      const receipt = parseDomainContract(DomainOperationReceiptSchema, {
        command, commandSha256, state: 'claimed', attempt: 1, result: null, failureCode: null, updatedAt: now,
      }, 'Claimed operation receipt') as DomainOperationReceipt
      this.operations.set(command.idempotencyKey, structuredClone(receipt))
      return Object.freeze({ kind: 'claimed' as const, receipt })
    })
  }

  async retryOperation(command: DomainProviderOperation, commandSha256: string, failureCode: string, now: string): Promise<void> {
    await this.#serialized(() => {
      const prior = this.operations.get(command.idempotencyKey)
      if (!prior || prior.commandSha256 !== commandSha256 || prior.state !== 'claimed') throw new DomainError('stale', 'Provider retry receipt lost its claim fence.')
      this.operations.set(command.idempotencyKey, parseDomainContract(DomainOperationReceiptSchema, {
        ...prior, state: 'retryable', failureCode, updatedAt: now,
      }, 'Retryable operation receipt') as DomainOperationReceipt)
    })
  }

  async completeOperation(command: DomainProviderOperation, commandSha256: string, result: DomainProviderResult, now: string): Promise<void> {
    await this.#serialized(() => {
      const prior = this.operations.get(command.idempotencyKey)
      if (!prior || prior.commandSha256 !== commandSha256 || prior.state !== 'claimed') throw new DomainError('stale', 'Provider result lost its claim fence.')
      this.operations.set(command.idempotencyKey, parseDomainContract(DomainOperationReceiptSchema, {
        ...prior, state: 'succeeded', result, failureCode: null, updatedAt: now,
      }, 'Completed operation receipt') as DomainOperationReceipt)
    })
  }
}

export class NoopDomainCommercialAuthority implements DomainCommercialAuthority {
  async admitCreate(): Promise<void> {}
  async commitCreate(): Promise<void> {}
  async releaseCreate(): Promise<void> {}
}
