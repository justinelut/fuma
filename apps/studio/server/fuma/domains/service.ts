import { Value } from '@core/utils/typeboxHelpers'
import type { DomainSecretCipher } from './credentialCipher'
import {
  CreateDomainCommandSchema,
  DomainCredentialEnvelopeSchema,
  DomainProviderOperationSchema,
  DomainProviderResultSchema,
  DomainPublicProjectionSchema,
  DomainRecordSchema,
  DomainScopeSchema,
  DomainTransitionSchema,
  RedactedDomainCredentialSchema,
  RevokeCredentialCommandSchema,
  RotateCredentialCommandSchema,
  StoreCredentialCommandSchema,
  TransitionDomainCommandSchema,
  credentialAuthorityKey,
  customerCredentialAuthority,
  normalizeDomainHostname,
  parseDomainContract,
  platformCredentialAuthority,
  sameDomainScope,
  type CertificateState,
  type CreateDomainCommand,
  type CredentialScope,
  type DomainCredentialAuthority,
  type DomainCredentialEnvelope,
  type DomainDesiredState,
  type DomainObservedState,
  type DomainOperationReceipt,
  type DomainProviderOperation,
  type DomainProviderResult,
  type DomainPublicProjection,
  type DomainRecord,
  type DomainScope,
  type DomainTransition,
  type RedactedDomainCredential,
  type RevokeCredentialCommand,
  type RotateCredentialCommand,
  type StoreCredentialCommand,
  type TransitionDomainCommand,
} from './contracts'

export * from './contracts'
export type { DomainSecretCipher } from './credentialCipher'

export type DomainInsertOutcome = 'created' | 'duplicate' | 'collision'
export type DomainTransitionOutcome = 'applied' | 'duplicate' | 'conflict'
export type CredentialWriteOutcome = 'created' | 'duplicate' | 'conflict'
export type OperationClaimOutcome = Readonly<{
  kind: 'claimed' | 'replay'
  receipt: DomainOperationReceipt
}>

/** Internal persistence port. It is intentionally never accepted by route/plugin/AI constructors. */
export interface DomainRepository {
  insert(scope: DomainScope, record: DomainRecord): Promise<DomainInsertOutcome>
  exact(scope: DomainScope, domainId: string): Promise<DomainRecord | null>
  list(scope: DomainScope): Promise<readonly DomainRecord[]>
  transitionByOperation(scope: DomainScope, operationId: string): Promise<DomainTransition | null>
  transition(scope: DomainScope, record: DomainRecord, evidence: DomainTransition): Promise<DomainTransitionOutcome>
  credentialExact(authority: DomainCredentialAuthority, credentialId: string): Promise<DomainCredentialEnvelope | null>
  storeCredential(envelope: DomainCredentialEnvelope): Promise<CredentialWriteOutcome>
  rotateCredential(current: DomainCredentialEnvelope, replacement: DomainCredentialEnvelope): Promise<CredentialWriteOutcome>
  revokeCredential(current: DomainCredentialEnvelope, revoked: DomainCredentialEnvelope): Promise<CredentialWriteOutcome>
  claimOperation(command: DomainProviderOperation, commandSha256: string, now: string): Promise<OperationClaimOutcome>
  retryOperation(command: DomainProviderOperation, commandSha256: string, failureCode: string, now: string): Promise<void>
  completeOperation(command: DomainProviderOperation, commandSha256: string, result: DomainProviderResult, now: string): Promise<void>
}

export interface DomainCommercialAuthority {
  admitCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void>
  commitCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void>
  releaseCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void>
}

export interface DomainCredentialProvider {
  execute(input: Readonly<{
    operationId: string
    action: DomainProviderOperation['action']
    hostname: string
    credentialScope: CredentialScope
    secret: Uint8Array
  }>): Promise<Readonly<{ status: DomainProviderResult['status']; providerCode: string }>>
}

export class DomainError extends Error {
  readonly code:
    | 'invalid'
    | 'scope'
    | 'transition'
    | 'collision'
    | 'secret'
    | 'stale'
    | 'revoked'
    | 'provider'
    | 'not-found'

  constructor(code: DomainError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'DomainError'
  }
}

function immutableStates<const T extends readonly string[]>(values: T): T {
  return Object.freeze(values)
}

const DESIRED_TRANSITIONS = Object.freeze({
  detached: immutableStates(['validating', 'deleted']),
  validating: immutableStates(['active', 'detached', 'suspended', 'deleted']),
  active: immutableStates(['suspended', 'detached', 'deleted']),
  suspended: immutableStates(['validating', 'active', 'detached', 'deleted']),
  deleted: immutableStates([]),
}) satisfies Readonly<Record<DomainDesiredState, readonly DomainDesiredState[]>>
const OBSERVED_TRANSITIONS = Object.freeze({
  unknown: immutableStates(['dns-pending', 'dns-valid', 'degraded', 'detached', 'deleted']),
  'dns-pending': immutableStates(['dns-valid', 'degraded', 'detached', 'deleted']),
  'dns-valid': immutableStates(['dns-pending', 'tls-pending', 'active', 'degraded', 'detached', 'deleted']),
  'tls-pending': immutableStates(['dns-pending', 'active', 'degraded', 'detached', 'deleted']),
  active: immutableStates(['dns-pending', 'degraded', 'detached', 'deleted']),
  degraded: immutableStates(['dns-pending', 'dns-valid', 'tls-pending', 'active', 'detached', 'deleted']),
  detached: immutableStates(['dns-pending', 'dns-valid', 'deleted']),
  deleted: immutableStates([]),
}) satisfies Readonly<Record<DomainObservedState, readonly DomainObservedState[]>>
const CERTIFICATE_TRANSITIONS = Object.freeze({
  none: immutableStates(['provisioning', 'revoked']),
  provisioning: immutableStates(['none', 'active', 'failed', 'revoked']),
  active: immutableStates(['expiring', 'expired', 'failed', 'revoked']),
  expiring: immutableStates(['active', 'expired', 'failed', 'revoked']),
  expired: immutableStates(['provisioning', 'revoked']),
  failed: immutableStates(['none', 'provisioning', 'revoked']),
  revoked: immutableStates(['provisioning']),
}) satisfies Readonly<Record<CertificateState, readonly CertificateState[]>>

function hash(value: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function sameAuthority(left: DomainCredentialAuthority, right: DomainCredentialAuthority): boolean {
  return credentialAuthorityKey(left) === credentialAuthorityKey(right)
}

function authorityForDomain(record: DomainRecord): DomainCredentialAuthority {
  return record.kind === 'fuma-registered'
    ? platformCredentialAuthority(record.platformId)
    : customerCredentialAuthority(record)
}

function assertDomainCredentialBinding(record: DomainRecord, envelope: DomainCredentialEnvelope | null): void {
  if (record.kind === 'fuma-registered' && record.credentialId === null) {
    throw new DomainError('scope', 'Fuma-registered domains require an explicit platform credential.')
  }
  if (record.credentialId === null) return
  if (!envelope || envelope.state !== 'active' || !sameAuthority(envelope.authority, authorityForDomain(record))) {
    throw new DomainError('scope', 'Domain credential authority is unavailable or does not exactly match the domain.')
  }
}

function legal<T extends string>(ledger: Readonly<Record<T, readonly T[]>>, from: T, to: T): boolean {
  return from === to || ledger[from].includes(to)
}

export function assertDomainState(record: DomainRecord): void {
  if (!Value.Check(DomainRecordSchema, record)) throw new DomainError('invalid', 'Domain record failed strict TypeBox validation.')
  const normalized = normalizeDomainHostname(record.hostname)
  if (normalized.hostname !== record.hostname || normalized.unicodeHostname !== record.unicodeHostname) {
    throw new DomainError('invalid', 'Domain record hostname identity is not canonical.')
  }
  if (record.observed === 'active' && (record.desired !== 'active' || record.certificate !== 'active')) {
    throw new DomainError('transition', 'Observed routing cannot be active before desired routing and TLS are active.')
  }
  if (record.certificate === 'active' && !['dns-valid', 'tls-pending', 'active', 'degraded'].includes(record.observed)) {
    throw new DomainError('transition', 'An active certificate requires observed DNS ownership evidence.')
  }
  if (record.desired === 'deleted'
    && (record.observed !== 'deleted' || !['none', 'revoked'].includes(record.certificate) || record.credentialId !== null)) {
    throw new DomainError('transition', 'Deleted domains cannot retain routing, active TLS, or a credential binding.')
  }
  if (record.desired === 'detached' && record.observed === 'active') {
    throw new DomainError('transition', 'Detached domains cannot remain observed active.')
  }
}

function assertLegalTransition(current: DomainRecord, next: DomainRecord): void {
  if (!legal(DESIRED_TRANSITIONS, current.desired, next.desired)
    || !legal(OBSERVED_TRANSITIONS, current.observed, next.observed)
    || !legal(CERTIFICATE_TRANSITIONS, current.certificate, next.certificate)) {
    throw new DomainError('transition', 'Domain desired, observed, or certificate transition is not in its legal ledger.')
  }
  if (current.desired === next.desired && current.observed === next.observed && current.certificate === next.certificate) {
    throw new DomainError('transition', 'A transition must change at least one state machine.')
  }
  assertDomainState(next)
}

function project(record: DomainRecord, credential: DomainCredentialEnvelope | null): DomainPublicProjection {
  const value = Object.freeze({
    domainId: record.domainId,
    hostname: record.hostname,
    unicodeHostname: record.unicodeHostname,
    kind: record.kind,
    desired: record.desired,
    observed: record.observed,
    certificate: record.certificate,
    version: record.version,
    updatedAt: record.updatedAt,
    credential: credential ? Object.freeze({ configured: true as const, scope: credential.authority.scope }) : null,
  })
  return parseDomainContract(DomainPublicProjectionSchema, value, 'Domain projection') as DomainPublicProjection
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new DomainError('invalid', `${label} is invalid.`)
}

function sameCommand(left: DomainProviderOperation, right: DomainProviderOperation): boolean {
  return canonical(left) === canonical(right)
}

export type DomainServiceOptions = Readonly<{
  repository: DomainRepository
  cipher: DomainSecretCipher
  commercial: DomainCommercialAuthority
  provider: DomainCredentialProvider
  now?: () => Date
}>

export class DomainService {
  readonly #repository: DomainRepository
  readonly #cipher: DomainSecretCipher
  readonly #commercial: DomainCommercialAuthority
  readonly #provider: DomainCredentialProvider
  readonly #now: () => Date

  constructor(options: DomainServiceOptions) {
    this.#repository = options.repository
    this.#cipher = options.cipher
    this.#commercial = options.commercial
    this.#provider = options.provider
    this.#now = options.now ?? (() => new Date())
  }

  async create(scopeInput: DomainScope, raw: unknown): Promise<DomainPublicProjection> {
    const scope = parseDomainContract(DomainScopeSchema, scopeInput, 'Domain scope') as DomainScope
    const command = parseDomainContract(CreateDomainCommandSchema, raw, 'Create domain command') as CreateDomainCommand
    assertTimestamp(command.requestedAt, 'Domain request time')
    const normalized = normalizeDomainHostname(command.hostname)
    const record = Object.freeze({
      ...scope,
      domainId: command.domainId,
      ...normalized,
      kind: command.kind,
      desired: 'detached' as const,
      observed: 'unknown' as const,
      certificate: 'none' as const,
      credentialId: command.credentialId,
      version: 1,
      operationFence: 1,
      createdAt: command.requestedAt,
      updatedAt: command.requestedAt,
    })
    assertDomainState(record)
    const credential = command.credentialId === null
      ? null
      : await this.#repository.credentialExact(authorityForDomain(record), command.credentialId)
    assertDomainCredentialBinding(record, credential)

    await this.#commercial.admitCreate(scope, command)
    try {
      const outcome = await this.#repository.insert(scope, record)
      if (outcome === 'collision') throw new DomainError('collision', 'Hostname or domain identity already exists.')
      if (outcome === 'duplicate') {
        const prior = await this.#repository.exact(scope, command.domainId)
        if (!prior || prior.hostname !== record.hostname || prior.kind !== record.kind || prior.credentialId !== record.credentialId) {
          throw new DomainError('collision', 'Domain create replay changed immutable authority.')
        }
      }
      await this.#commercial.commitCreate(scope, command)
      return project(record, credential)
    } catch (error) {
      const existing = await this.#repository.exact(scope, command.domainId)
      if (!existing) await this.#commercial.releaseCreate(scope, command)
      throw error
    }
  }

  async exact(scopeInput: DomainScope, domainId: string): Promise<DomainPublicProjection | null> {
    const scope = parseDomainContract(DomainScopeSchema, scopeInput, 'Domain scope') as DomainScope
    const record = await this.#repository.exact(scope, domainId)
    if (!record) return null
    assertDomainState(record)
    const credential = record.credentialId === null
      ? null
      : await this.#repository.credentialExact(authorityForDomain(record), record.credentialId)
    return project(record, credential?.state === 'active' ? credential : null)
  }

  async list(scopeInput: DomainScope): Promise<readonly DomainPublicProjection[]> {
    const scope = parseDomainContract(DomainScopeSchema, scopeInput, 'Domain scope') as DomainScope
    const records = await this.#repository.list(scope)
    const output: DomainPublicProjection[] = []
    for (const record of records) {
      assertDomainState(record)
      const credential = record.credentialId === null
        ? null
        : await this.#repository.credentialExact(authorityForDomain(record), record.credentialId)
      output.push(project(record, credential?.state === 'active' ? credential : null))
    }
    return Object.freeze(output)
  }

  async transition(scopeInput: DomainScope, raw: unknown): Promise<DomainPublicProjection> {
    const scope = parseDomainContract(DomainScopeSchema, scopeInput, 'Domain scope') as DomainScope
    const command = parseDomainContract(TransitionDomainCommandSchema, raw, 'Domain transition command') as TransitionDomainCommand
    const replay = await this.#repository.transitionByOperation(scope, command.operationId)
    if (replay) {
      if (replay.domainId !== command.domainId || replay.expectedVersion !== command.expectedVersion
        || replay.fromFence !== command.expectedFence || replay.toDesired !== command.desired
        || replay.toObserved !== command.observed || replay.toCertificate !== command.certificate
        || replay.actorId !== command.actorId || replay.reasonCode !== command.reasonCode
        || replay.occurredAt !== command.occurredAt) {
        throw new DomainError('stale', 'Transition operation identity was reused with different immutable evidence.')
      }
      const currentReplay = await this.exact(scope, command.domainId)
      if (!currentReplay || currentReplay.version !== command.expectedVersion + 1) {
        throw new DomainError('stale', 'Transition retry is older than the current domain generation.')
      }
      return currentReplay
    }

    const current = await this.#repository.exact(scope, command.domainId)
    if (!current) throw new DomainError('not-found', 'Domain is unavailable.')
    if (current.version !== command.expectedVersion || current.operationFence !== command.expectedFence) {
      throw new DomainError('stale', 'Domain version or operation fence is stale.')
    }
    const deleting = command.desired === 'deleted'
    const next = Object.freeze({
      ...current,
      desired: command.desired,
      observed: command.observed,
      certificate: command.certificate,
      credentialId: deleting ? null : current.credentialId,
      version: current.version + 1,
      operationFence: current.operationFence + 1,
      updatedAt: command.occurredAt,
    })
    assertLegalTransition(current, next)
    const evidenceBase = Object.freeze({
      transitionId: `transition:${command.operationId}`,
      ...scope,
      domainId: current.domainId,
      expectedVersion: command.expectedVersion,
      fromDesired: current.desired,
      toDesired: next.desired,
      fromObserved: current.observed,
      toObserved: next.observed,
      fromCertificate: current.certificate,
      toCertificate: next.certificate,
      fromFence: current.operationFence,
      toFence: next.operationFence,
      actorId: command.actorId,
      reasonCode: command.reasonCode,
      operationId: command.operationId,
      occurredAt: command.occurredAt,
    })
    const evidence = parseDomainContract(DomainTransitionSchema, {
      ...evidenceBase,
      evidenceSha256: hash(canonical(evidenceBase)),
    }, 'Domain transition evidence') as DomainTransition
    const outcome = await this.#repository.transition(scope, next, evidence)
    if (outcome !== 'applied') throw new DomainError('stale', 'Concurrent or conflicting domain transition denied.')
    const credential = next.credentialId === null
      ? null
      : await this.#repository.credentialExact(authorityForDomain(next), next.credentialId)
    return project(next, credential?.state === 'active' ? credential : null)
  }

  async storeCredential(raw: unknown): Promise<RedactedDomainCredential> {
    const command = parseDomainContract(StoreCredentialCommandSchema, raw, 'Store credential command') as StoreCredentialCommand
    assertTimestamp(command.createdAt, 'Credential creation time')
    const secret = Uint8Array.from(command.plaintext)
    try {
      const fingerprintSha256 = hash(secret)
      const existing = await this.#repository.credentialExact(command.authority, command.credentialId)
      if (existing) {
        if (existing.fingerprintSha256 !== fingerprintSha256 || existing.createdAt !== command.createdAt) {
          throw new DomainError('secret', 'Credential identity already has different immutable evidence.')
        }
        return this.redacted(existing)
      }
      const encrypted = await this.#cipher.encrypt(command.authority, secret)
      const envelope = parseDomainContract(DomainCredentialEnvelopeSchema, {
        credentialId: command.credentialId,
        authority: command.authority,
        ciphertext: encrypted.ciphertext,
        keyId: encrypted.keyId,
        algorithm: 'AES-256-GCM',
        fingerprintSha256,
        state: 'active',
        version: 1,
        fence: 1,
        createdAt: command.createdAt,
        rotatedAt: null,
        revokedAt: null,
        rotatedFrom: null,
      }, 'Encrypted domain credential') as DomainCredentialEnvelope
      const outcome = await this.#repository.storeCredential(envelope)
      if (outcome === 'conflict') throw new DomainError('secret', 'Credential identity already has different immutable evidence.')
      if (outcome === 'duplicate') {
        const winner = await this.#repository.credentialExact(command.authority, command.credentialId)
        if (!winner || winner.fingerprintSha256 !== fingerprintSha256 || winner.createdAt !== command.createdAt) {
          throw new DomainError('secret', 'Concurrent credential evidence did not match the winning record.')
        }
        return this.redacted(winner)
      }
      return this.redacted(envelope)
    } finally {
      secret.fill(0)
    }
  }

  async rotateCredential(raw: unknown): Promise<RedactedDomainCredential> {
    const command = parseDomainContract(RotateCredentialCommandSchema, raw, 'Rotate credential command') as RotateCredentialCommand
    assertTimestamp(command.rotatedAt, 'Credential rotation time')
    const current = await this.#repository.credentialExact(command.authority, command.credentialId)
    if (!current) throw new DomainError('not-found', 'Credential is unavailable.')
    if (current.state !== 'active') throw new DomainError('revoked', 'Revoked credentials cannot rotate.')
    if (current.version !== command.expectedVersion || current.fence !== command.expectedFence) {
      throw new DomainError('stale', 'Credential version or fence is stale.')
    }
    const secret = Uint8Array.from(command.replacementPlaintext)
    try {
      const encrypted = await this.#cipher.encrypt(command.authority, secret)
      const replacement = parseDomainContract(DomainCredentialEnvelopeSchema, {
        ...current,
        ciphertext: encrypted.ciphertext,
        keyId: encrypted.keyId,
        fingerprintSha256: hash(secret),
        version: current.version + 1,
        fence: current.fence + 1,
        rotatedAt: command.rotatedAt,
        rotatedFrom: current.fingerprintSha256,
      }, 'Rotated domain credential') as DomainCredentialEnvelope
      const outcome = await this.#repository.rotateCredential(current, replacement)
      if (outcome !== 'created') throw new DomainError('stale', 'Concurrent credential rotation or changed replay denied.')
      return this.redacted(replacement)
    } finally {
      secret.fill(0)
    }
  }

  async revokeCredential(raw: unknown): Promise<RedactedDomainCredential> {
    const command = parseDomainContract(RevokeCredentialCommandSchema, raw, 'Revoke credential command') as RevokeCredentialCommand
    assertTimestamp(command.revokedAt, 'Credential revocation time')
    const current = await this.#repository.credentialExact(command.authority, command.credentialId)
    if (!current) throw new DomainError('not-found', 'Credential is unavailable.')
    if (current.state === 'revoked') {
      if (current.version !== command.expectedVersion + 1 || current.fence !== command.expectedFence + 1
        || current.revokedAt !== command.revokedAt) {
        throw new DomainError('stale', 'Credential revocation retry changed immutable evidence.')
      }
      return this.redacted(current)
    }
    if (current.version !== command.expectedVersion || current.fence !== command.expectedFence) {
      throw new DomainError('stale', 'Credential version or fence is stale.')
    }
    const revoked = parseDomainContract(DomainCredentialEnvelopeSchema, {
      ...current,
      state: 'revoked',
      version: current.version + 1,
      fence: current.fence + 1,
      revokedAt: command.revokedAt,
    }, 'Revoked domain credential') as DomainCredentialEnvelope
    const outcome = await this.#repository.revokeCredential(current, revoked)
    if (outcome !== 'created') throw new DomainError('stale', 'Concurrent credential revocation denied.')
    return this.redacted(revoked)
  }

  async operate(scopeInput: DomainScope, raw: unknown): Promise<DomainProviderResult> {
    const scope = parseDomainContract(DomainScopeSchema, scopeInput, 'Domain scope') as DomainScope
    const command = parseDomainContract(DomainProviderOperationSchema, raw, 'Domain provider operation') as DomainProviderOperation
    const commandScope = parseDomainContract(DomainScopeSchema, {
      platformId: command.platformId,
      organizationId: command.organizationId,
      workspaceId: command.workspaceId,
      siteId: command.siteId,
      ownerKey: command.ownerKey,
      generation: command.generation,
      state: command.state,
      transferFence: command.transferFence,
      profileId: command.profileId,
    }, 'Domain operation scope') as DomainScope
    if (!sameDomainScope(scope, commandScope)) throw new DomainError('scope', 'Domain operation scope substitution denied.')
    const commandSha256 = hash(canonical(command))
    const claim = await this.#repository.claimOperation(command, commandSha256, this.#now().toISOString())
    if (!sameCommand(claim.receipt.command, command)) throw new DomainError('stale', 'Operation replay changed immutable command evidence.')
    if (claim.kind === 'replay') {
      if (claim.receipt.state === 'succeeded' && claim.receipt.result) return claim.receipt.result
      throw new DomainError('stale', 'Provider operation is already claimed by an active worker.')
    }

    const domain = await this.#repository.exact(scope, command.domainId)
    if (!domain) throw new DomainError('not-found', 'Domain is unavailable.')
    if (domain.version !== command.expectedDomainVersion || domain.operationFence !== command.expectedDomainFence
      || domain.credentialId !== command.credentialId) {
      throw new DomainError('stale', 'Provider operation domain authority is stale.')
    }
    const authority = authorityForDomain(domain)
    const credential = await this.#repository.credentialExact(authority, command.credentialId)
    if (!credential || credential.state !== 'active') throw new DomainError('revoked', 'Provider credential is unavailable.')
    if (credential.version !== command.expectedCredentialVersion || credential.fence !== command.expectedCredentialFence) {
      throw new DomainError('stale', 'Provider credential version or fence is stale.')
    }
    assertDomainCredentialBinding(domain, credential)

    let plaintext: Uint8Array | null = null
    try {
      plaintext = await this.#cipher.decrypt(authority, credential)
      const provider = await this.#provider.execute({
        operationId: command.operationId,
        action: command.action,
        hostname: domain.hostname,
        credentialScope: credential.authority.scope,
        secret: plaintext,
      })
      const result = parseDomainContract(DomainProviderResultSchema, {
        operationId: command.operationId,
        status: provider.status,
        providerCode: provider.providerCode,
        observedAt: this.#now().toISOString(),
      }, 'Domain provider result') as DomainProviderResult
      await this.#repository.completeOperation(command, commandSha256, result, result.observedAt)
      return result
    } catch (error) {
      await this.#repository.retryOperation(command, commandSha256, 'provider-unavailable', this.#now().toISOString())
      if (error instanceof DomainError) throw error
      throw new DomainError('provider', 'Provider operation failed and is safe to retry with the same fenced command.')
    } finally {
      plaintext?.fill(0)
    }
  }

  redacted(envelopeInput: DomainCredentialEnvelope): RedactedDomainCredential {
    const envelope = parseDomainContract(DomainCredentialEnvelopeSchema, envelopeInput, 'Credential envelope') as DomainCredentialEnvelope
    const value = Object.freeze({
      credentialId: envelope.credentialId,
      scope: envelope.authority.scope,
      organizationId: envelope.authority.organizationId,
      keyId: envelope.keyId,
      algorithm: envelope.algorithm,
      fingerprintSha256: envelope.fingerprintSha256,
      state: envelope.state,
      version: envelope.version,
      fence: envelope.fence,
      rotatedAt: envelope.rotatedAt,
      revokedAt: envelope.revokedAt,
      secret: '[REDACTED]' as const,
    })
    return parseDomainContract(RedactedDomainCredentialSchema, value, 'Redacted credential') as RedactedDomainCredential
  }
}
