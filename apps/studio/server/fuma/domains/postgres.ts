import type { DbClient } from '../../db/client'
import {
  DomainCredentialAuthoritySchema,
  DomainCredentialEnvelopeSchema,
  DomainOperationReceiptSchema,
  DomainProviderOperationSchema,
  DomainProviderResultSchema,
  DomainRecordSchema,
  DomainTransitionSchema,
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
  type DomainInsertOutcome,
  type DomainRepository,
  type DomainTransitionOutcome,
  type OperationClaimOutcome,
} from './service'

type DomainRow = Readonly<{
  domain_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: number | string | bigint
  owner_state: 'active' | 'transferring'
  transfer_fence: number | string | bigint | null
  profile_id: string
  hostname_ascii: string
  hostname_unicode: string
  kind: DomainRecord['kind']
  desired_state: DomainRecord['desired']
  observed_state: DomainRecord['observed']
  certificate_state: DomainRecord['certificate']
  credential_id: string | null
  credential_scope: DomainCredentialAuthority['scope'] | null
  version: number | string | bigint
  operation_fence: number | string | bigint
  created_at: string | Date
  updated_at: string | Date
}>

type TransitionRow = Readonly<{
  transition_id: string
  operation_id: string
  domain_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: number | string | bigint
  owner_state: 'active' | 'transferring'
  transfer_fence: number | string | bigint | null
  profile_id: string
  expected_version: number | string | bigint
  from_desired: DomainTransition['fromDesired']
  to_desired: DomainTransition['toDesired']
  from_observed: DomainTransition['fromObserved']
  to_observed: DomainTransition['toObserved']
  from_certificate: DomainTransition['fromCertificate']
  to_certificate: DomainTransition['toCertificate']
  from_fence: number | string | bigint
  to_fence: number | string | bigint
  actor_id: string
  reason_code: string
  evidence_sha256: string
  occurred_at: string | Date
}>

type CredentialRow = Readonly<{
  authority_sha256: string
  credential_id: string
  credential_version: number | string | bigint
  scope: DomainCredentialAuthority['scope']
  platform_id: string
  organization_id: string | null
  workspace_id: string | null
  site_id: string | null
  owner_key: string | null
  owner_generation: number | string | bigint | null
  profile_id: string | null
  ciphertext: string
  key_id: string
  algorithm: 'AES-256-GCM'
  fingerprint_sha256: string
  state: DomainCredentialEnvelope['state']
  fence: number | string | bigint
  created_at: string | Date
  rotated_at: string | Date | null
  revoked_at: string | Date | null
  rotated_from_fingerprint_sha256: string | null
}>

type OperationRow = Readonly<{
  idempotency_key: string
  operation_id: string
  command_sha256: string
  command_json: unknown
  state: DomainOperationReceipt['state']
  attempt: number | string | bigint
  result_json: unknown
  failure_code: string | null
  updated_at: string | Date
}>

const DOMAIN_COLUMNS = `domain_id,platform_id,organization_id,workspace_id,site_id,owner_key,
  owner_generation,owner_state,transfer_fence,profile_id,hostname_ascii,hostname_unicode,kind,
  desired_state,observed_state,certificate_state,credential_id,credential_scope,version,
  operation_fence,created_at,updated_at`
const TRANSITION_COLUMNS = `transition_id,operation_id,domain_id,platform_id,organization_id,
  workspace_id,site_id,owner_key,owner_generation,owner_state,transfer_fence,profile_id,
  expected_version,from_desired,to_desired,from_observed,to_observed,from_certificate,
  to_certificate,from_fence,to_fence,actor_id,reason_code,evidence_sha256,occurred_at`
const CREDENTIAL_COLUMNS = `v.authority_sha256,v.credential_id,v.credential_version,v.scope,
  v.platform_id,v.organization_id,v.workspace_id,v.site_id,v.owner_key,v.owner_generation,
  v.profile_id,v.ciphertext,v.key_id,v.algorithm,v.fingerprint_sha256,v.state,v.fence,
  v.created_at,v.rotated_at,v.revoked_at,v.rotated_from_fingerprint_sha256`
const OPERATION_COLUMNS = `idempotency_key,operation_id,command_sha256,command_json,state,
  attempt,result_json,failure_code,updated_at`
const SCOPE_WHERE = `platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
  and owner_key=$5 and owner_generation=$6 and owner_state=$7
  and transfer_fence is not distinct from $8 and profile_id=$9`

function scopeArgs(scope: DomainScope): unknown[] {
  return [
    scope.platformId,
    scope.organizationId,
    scope.workspaceId,
    scope.siteId,
    scope.ownerKey,
    scope.generation,
    scope.state,
    scope.transferFence,
    scope.profileId,
  ]
}

function integer(value: number | string | bigint, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new DomainError('invalid', `Stored ${label} is not a safe positive integer.`)
  }
  return parsed
}

function timestamp(value: string | Date | null): string | null {
  if (value === null) return null
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  if (!Number.isFinite(Date.parse(result))) throw new DomainError('invalid', 'Stored domain timestamp is invalid.')
  return result
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { throw new DomainError('invalid', 'Stored domain JSON is invalid.') }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

function authoritySha256(authority: DomainCredentialAuthority): string {
  return new Bun.CryptoHasher('sha256').update(credentialAuthorityKey(authority)).digest('hex')
}

function sameCredentialIntent(left: DomainCredentialEnvelope, right: DomainCredentialEnvelope): boolean {
  return left.credentialId === right.credentialId
    && same(left.authority, right.authority)
    && left.keyId === right.keyId
    && left.algorithm === right.algorithm
    && left.fingerprintSha256 === right.fingerprintSha256
    && left.state === right.state
    && left.version === right.version
    && left.fence === right.fence
    && left.createdAt === right.createdAt
    && left.rotatedAt === right.rotatedAt
    && left.revokedAt === right.revokedAt
    && left.rotatedFrom === right.rotatedFrom
}

function credentialScope(record: DomainRecord): DomainCredentialAuthority['scope'] | null {
  if (record.credentialId === null) return null
  return record.kind === 'fuma-registered' ? 'fuma-platform' : 'customer-automation'
}

function domainFromRow(row: DomainRow): DomainRecord {
  const expectedCredentialScope = row.credential_id === null
    ? null
    : row.kind === 'fuma-registered' ? 'fuma-platform' : 'customer-automation'
  if (row.credential_scope !== expectedCredentialScope) {
    throw new DomainError('scope', 'Stored domain credential binding is inconsistent.')
  }
  return parseDomainContract(DomainRecordSchema, {
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    generation: integer(row.owner_generation, 'domain owner generation'),
    state: row.owner_state,
    transferFence: row.transfer_fence === null ? null : integer(row.transfer_fence, 'domain transfer fence'),
    profileId: row.profile_id,
    domainId: row.domain_id,
    hostname: row.hostname_ascii,
    unicodeHostname: row.hostname_unicode,
    kind: row.kind,
    desired: row.desired_state,
    observed: row.observed_state,
    certificate: row.certificate_state,
    credentialId: row.credential_id,
    version: integer(row.version, 'domain version'),
    operationFence: integer(row.operation_fence, 'domain operation fence'),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }, 'Stored domain record') as DomainRecord
}

function transitionFromRow(row: TransitionRow): DomainTransition {
  return parseDomainContract(DomainTransitionSchema, {
    transitionId: row.transition_id,
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    generation: integer(row.owner_generation, 'transition owner generation'),
    state: row.owner_state,
    transferFence: row.transfer_fence === null ? null : integer(row.transfer_fence, 'transition transfer fence'),
    profileId: row.profile_id,
    domainId: row.domain_id,
    expectedVersion: integer(row.expected_version, 'transition expected version'),
    fromDesired: row.from_desired,
    toDesired: row.to_desired,
    fromObserved: row.from_observed,
    toObserved: row.to_observed,
    fromCertificate: row.from_certificate,
    toCertificate: row.to_certificate,
    fromFence: integer(row.from_fence, 'transition source fence'),
    toFence: integer(row.to_fence, 'transition target fence'),
    actorId: row.actor_id,
    reasonCode: row.reason_code,
    operationId: row.operation_id,
    evidenceSha256: row.evidence_sha256,
    occurredAt: timestamp(row.occurred_at),
  }, 'Stored domain transition') as DomainTransition
}

function authorityFromRow(row: CredentialRow): DomainCredentialAuthority {
  return parseDomainContract(DomainCredentialAuthoritySchema, row.scope === 'fuma-platform' ? {
    scope: row.scope,
    platformId: row.platform_id,
    organizationId: null,
    workspaceId: null,
    siteId: null,
    ownerKey: null,
    ownerGeneration: null,
    profileId: null,
  } : {
    scope: row.scope,
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    ownerGeneration: row.owner_generation === null ? null : integer(row.owner_generation, 'credential owner generation'),
    profileId: row.profile_id,
  }, 'Stored credential authority') as DomainCredentialAuthority
}

function credentialFromRow(row: CredentialRow): DomainCredentialEnvelope {
  const authority = authorityFromRow(row)
  if (authoritySha256(authority) !== row.authority_sha256) {
    throw new DomainError('scope', 'Stored credential authority digest does not match its coordinates.')
  }
  return parseDomainContract(DomainCredentialEnvelopeSchema, {
    credentialId: row.credential_id,
    authority,
    ciphertext: row.ciphertext,
    keyId: row.key_id,
    algorithm: row.algorithm,
    fingerprintSha256: row.fingerprint_sha256,
    state: row.state,
    version: integer(row.credential_version, 'credential version'),
    fence: integer(row.fence, 'credential fence'),
    createdAt: timestamp(row.created_at),
    rotatedAt: timestamp(row.rotated_at),
    revokedAt: timestamp(row.revoked_at),
    rotatedFrom: row.rotated_from_fingerprint_sha256,
  }, 'Stored domain credential') as DomainCredentialEnvelope
}

function operationFromRow(row: OperationRow): DomainOperationReceipt {
  const command = parseDomainContract(
    DomainProviderOperationSchema,
    json(row.command_json),
    'Stored domain provider command',
  ) as DomainProviderOperation
  const result = row.result_json === null
    ? null
    : parseDomainContract(DomainProviderResultSchema, json(row.result_json), 'Stored domain provider result') as DomainProviderResult
  return parseDomainContract(DomainOperationReceiptSchema, {
    command,
    commandSha256: row.command_sha256,
    state: row.state,
    attempt: integer(row.attempt, 'provider operation attempt'),
    result,
    failureCode: row.failure_code,
    updatedAt: timestamp(row.updated_at),
  }, 'Stored domain provider operation') as DomainOperationReceipt
}

function assertScope(scope: DomainScope, record: DomainRecord): void {
  if (!sameDomainScope(scope, record)) throw new DomainError('scope', 'Domain repository scope substitution denied.')
}

/** PostgreSQL authority over the finalized FUMA-059 v2 records and immutable evidence tables. */
export class PostgresDomainRepository implements DomainRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Domain authority requires PostgreSQL.')
    this.#db = db
  }

  async insert(scope: DomainScope, record: DomainRecord): Promise<DomainInsertOutcome> {
    assertScope(scope, record)
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:domain-record:${record.platformId}:${record.hostname}`},0))`
      const inserted = await tx.unsafe(`insert into fuma_domain_records_v2 (
        domain_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,
        owner_state,transfer_fence,profile_id,hostname_ascii,hostname_unicode,kind,desired_state,
        observed_state,certificate_state,credential_id,credential_scope,version,operation_fence,
        created_at,updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      on conflict do nothing`, [
        record.domainId,
        record.platformId,
        record.organizationId,
        record.workspaceId,
        record.siteId,
        record.ownerKey,
        record.generation,
        record.state,
        record.transferFence,
        record.profileId,
        record.hostname,
        record.unicodeHostname,
        record.kind,
        record.desired,
        record.observed,
        record.certificate,
        record.credentialId,
        credentialScope(record),
        record.version,
        record.operationFence,
        record.createdAt,
        record.updatedAt,
      ])
      if (inserted.rowCount === 1) return 'created'
      const prior = await tx.unsafe<DomainRow>(`select ${DOMAIN_COLUMNS} from fuma_domain_records_v2
        where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
        and owner_key=$5 and owner_generation=$6 and profile_id=$7 and domain_id=$8 limit 2`, [
        record.platformId,
        record.organizationId,
        record.workspaceId,
        record.siteId,
        record.ownerKey,
        record.generation,
        record.profileId,
        record.domainId,
      ])
      if (prior.rows.length > 1) throw new DomainError('collision', 'Domain identity is ambiguous.')
      return prior.rows[0] && same(domainFromRow(prior.rows[0]), record) ? 'duplicate' : 'collision'
    })
  }

  async exact(scope: DomainScope, domainId: string): Promise<DomainRecord | null> {
    const result = await this.#db.unsafe<DomainRow>(`select ${DOMAIN_COLUMNS} from fuma_domain_records_v2
      where ${SCOPE_WHERE} and domain_id=$10 limit 2`, [...scopeArgs(scope), domainId])
    if (result.rows.length > 1) throw new DomainError('collision', 'Domain identity is ambiguous.')
    return result.rows[0] ? domainFromRow(result.rows[0]) : null
  }

  async list(scope: DomainScope): Promise<readonly DomainRecord[]> {
    const result = await this.#db.unsafe<DomainRow>(`select ${DOMAIN_COLUMNS} from fuma_domain_records_v2
      where ${SCOPE_WHERE} order by hostname_ascii,domain_id`, scopeArgs(scope))
    return Object.freeze(result.rows.map(domainFromRow))
  }

  async transitionByOperation(scope: DomainScope, operationId: string): Promise<DomainTransition | null> {
    const result = await this.#db.unsafe<TransitionRow>(`select ${TRANSITION_COLUMNS} from fuma_domain_transitions_v2
      where ${SCOPE_WHERE} and operation_id=$10 limit 2`, [...scopeArgs(scope), operationId])
    if (result.rows.length > 1) throw new DomainError('collision', 'Domain transition identity is ambiguous.')
    return result.rows[0] ? transitionFromRow(result.rows[0]) : null
  }

  async transition(scope: DomainScope, record: DomainRecord, evidence: DomainTransition): Promise<DomainTransitionOutcome> {
    assertScope(scope, record)
    if (!sameDomainScope(scope, evidence) || record.domainId !== evidence.domainId) return 'conflict'
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:domain-transition:${evidence.operationId}`},0))`
      const prior = await tx.unsafe<TransitionRow>(`select ${TRANSITION_COLUMNS} from fuma_domain_transitions_v2
        where operation_id=$1 for update`, [evidence.operationId])
      if (prior.rows[0]) return same(transitionFromRow(prior.rows[0]), evidence) ? 'duplicate' : 'conflict'
      const updated = await tx.unsafe(`update fuma_domain_records_v2 set
        desired_state=$11,observed_state=$12,certificate_state=$13,credential_id=$14,
        credential_scope=$15,version=$16,operation_fence=$17,updated_at=$18
        where ${SCOPE_WHERE} and domain_id=$10 and version=$19 and operation_fence=$20
        and desired_state=$21 and observed_state=$22 and certificate_state=$23`, [
        ...scopeArgs(scope),
        record.domainId,
        record.desired,
        record.observed,
        record.certificate,
        record.credentialId,
        credentialScope(record),
        record.version,
        record.operationFence,
        record.updatedAt,
        evidence.expectedVersion,
        evidence.fromFence,
        evidence.fromDesired,
        evidence.fromObserved,
        evidence.fromCertificate,
      ])
      if (updated.rowCount !== 1) return 'conflict'
      const inserted = await tx.unsafe(`insert into fuma_domain_transitions_v2 (
        transition_id,operation_id,domain_id,platform_id,organization_id,workspace_id,site_id,
        owner_key,owner_generation,owner_state,transfer_fence,profile_id,expected_version,
        from_desired,to_desired,from_observed,to_observed,from_certificate,to_certificate,
        from_fence,to_fence,actor_id,reason_code,evidence_sha256,occurred_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`, [
        evidence.transitionId,
        evidence.operationId,
        evidence.domainId,
        evidence.platformId,
        evidence.organizationId,
        evidence.workspaceId,
        evidence.siteId,
        evidence.ownerKey,
        evidence.generation,
        evidence.state,
        evidence.transferFence,
        evidence.profileId,
        evidence.expectedVersion,
        evidence.fromDesired,
        evidence.toDesired,
        evidence.fromObserved,
        evidence.toObserved,
        evidence.fromCertificate,
        evidence.toCertificate,
        evidence.fromFence,
        evidence.toFence,
        evidence.actorId,
        evidence.reasonCode,
        evidence.evidenceSha256,
        evidence.occurredAt,
      ])
      return inserted.rowCount === 1 ? 'applied' : 'conflict'
    })
  }

  async credentialExact(authority: DomainCredentialAuthority, credentialId: string): Promise<DomainCredentialEnvelope | null> {
    return await this.#credentialExactWith(this.#db, authority, credentialId, false)
  }

  async storeCredential(envelope: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#db.transaction(async (tx) => {
      await this.#lockCredential(tx, envelope.authority, envelope.credentialId)
      const prior = await this.#credentialExactWith(tx, envelope.authority, envelope.credentialId, true)
      if (prior) return sameCredentialIntent(prior, envelope) ? 'duplicate' : 'conflict'
      await this.#insertCredentialVersion(tx, envelope)
      const digest = authoritySha256(envelope.authority)
      const head = await tx.unsafe(`insert into fuma_domain_credential_heads_v2 (
        authority_sha256,credential_id,credential_version,fence,state,updated_at
      ) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`, [
        digest,
        envelope.credentialId,
        envelope.version,
        envelope.fence,
        envelope.state,
        envelope.rotatedAt ?? envelope.revokedAt ?? envelope.createdAt,
      ])
      if (head.rowCount !== 1) throw new DomainError('stale', 'Credential head changed concurrently.')
      return 'created'
    })
  }

  async rotateCredential(current: DomainCredentialEnvelope, replacement: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#replaceCredential(current, replacement)
  }

  async revokeCredential(current: DomainCredentialEnvelope, revoked: DomainCredentialEnvelope): Promise<CredentialWriteOutcome> {
    return await this.#replaceCredential(current, revoked)
  }

  async claimOperation(command: DomainProviderOperation, commandSha256: string, now: string): Promise<OperationClaimOutcome> {
    return await this.#db.transaction(async (tx) => {
      const locks = [
        `fuma:domain-operation-id:${command.operationId}`,
        `fuma:domain-operation-key:${command.idempotencyKey}`,
      ].sort()
      for (const lock of locks) await tx`select pg_advisory_xact_lock(hashtextextended(${lock},0))`
      const prior = await tx.unsafe<OperationRow>(`select ${OPERATION_COLUMNS}
        from fuma_domain_provider_operations_v2 where idempotency_key=$1 or operation_id=$2 for update`, [
        command.idempotencyKey,
        command.operationId,
      ])
      if (prior.rows.length > 1) throw new DomainError('stale', 'Provider operation identities are split across receipts.')
      if (prior.rows[0]) {
        const receipt = operationFromRow(prior.rows[0])
        if (receipt.commandSha256 !== commandSha256 || !same(receipt.command, command)) {
          throw new DomainError('stale', 'Provider operation identity changed.')
        }
        if (receipt.state !== 'retryable') return Object.freeze({ kind: 'replay' as const, receipt })
        if (receipt.attempt >= 100) throw new DomainError('stale', 'Provider operation retry limit is exhausted.')
        const retried = parseDomainContract(DomainOperationReceiptSchema, {
          ...receipt,
          state: 'claimed',
          attempt: receipt.attempt + 1,
          failureCode: null,
          updatedAt: now,
        }, 'Retried domain provider operation') as DomainOperationReceipt
        const updated = await tx.unsafe(`update fuma_domain_provider_operations_v2 set
          state='claimed',attempt=$2,failure_code=null,updated_at=$3
          where idempotency_key=$1 and command_sha256=$4 and state='retryable'`, [
          command.idempotencyKey,
          retried.attempt,
          now,
          commandSha256,
        ])
        if (updated.rowCount !== 1) throw new DomainError('stale', 'Provider operation retry lost its durable fence.')
        return Object.freeze({ kind: 'claimed' as const, receipt: retried })
      }
      const receipt = parseDomainContract(DomainOperationReceiptSchema, {
        command,
        commandSha256,
        state: 'claimed',
        attempt: 1,
        result: null,
        failureCode: null,
        updatedAt: now,
      }, 'Claimed domain provider operation') as DomainOperationReceipt
      const inserted = await tx.unsafe(`insert into fuma_domain_provider_operations_v2 (
        idempotency_key,operation_id,command_sha256,command_json,state,attempt,result_json,
        failure_code,updated_at
      ) values ($1,$2,$3,$4::jsonb,'claimed',1,null,null,$5)`, [
        command.idempotencyKey,
        command.operationId,
        commandSha256,
        JSON.stringify(command),
        now,
      ])
      if (inserted.rowCount !== 1) throw new DomainError('stale', 'Provider operation claim conflicted.')
      return Object.freeze({ kind: 'claimed' as const, receipt })
    })
  }

  async retryOperation(command: DomainProviderOperation, commandSha256: string, failureCode: string, now: string): Promise<void> {
    const result = await this.#db.unsafe(`update fuma_domain_provider_operations_v2 set
      state='retryable',failure_code=$3,updated_at=$4
      where idempotency_key=$1 and operation_id=$2 and command_sha256=$5 and state='claimed'`, [
      command.idempotencyKey,
      command.operationId,
      failureCode,
      now,
      commandSha256,
    ])
    if (result.rowCount !== 1) throw new DomainError('stale', 'Provider retry receipt lost its durable claim fence.')
  }

  async completeOperation(
    command: DomainProviderOperation,
    commandSha256: string,
    result: DomainProviderResult,
    now: string,
  ): Promise<void> {
    const completed = await this.#db.unsafe(`update fuma_domain_provider_operations_v2 set
      state='succeeded',result_json=$3::jsonb,failure_code=null,updated_at=$4
      where idempotency_key=$1 and operation_id=$2 and command_sha256=$5 and state='claimed'`, [
      command.idempotencyKey,
      command.operationId,
      JSON.stringify(result),
      now,
      commandSha256,
    ])
    if (completed.rowCount !== 1) throw new DomainError('stale', 'Provider result lost its durable claim fence.')
  }

  async #replaceCredential(
    current: DomainCredentialEnvelope,
    replacement: DomainCredentialEnvelope,
  ): Promise<CredentialWriteOutcome> {
    if (credentialAuthorityKey(current.authority) !== credentialAuthorityKey(replacement.authority)
      || current.credentialId !== replacement.credentialId
      || replacement.version !== current.version + 1
      || replacement.fence !== current.fence + 1) return 'conflict'
    return await this.#db.transaction(async (tx) => {
      await this.#lockCredential(tx, current.authority, current.credentialId)
      const winner = await this.#credentialExactWith(tx, current.authority, current.credentialId, true)
      if (!winner || !same(winner, current)) return 'conflict'
      await this.#insertCredentialVersion(tx, replacement)
      const updatedAt = replacement.revokedAt ?? replacement.rotatedAt
      if (!updatedAt) throw new DomainError('invalid', 'Replacement credential lacks lifecycle evidence.')
      const updated = await tx.unsafe(`update fuma_domain_credential_heads_v2 set
        credential_version=$3,fence=$4,state=$5,updated_at=$6
        where authority_sha256=$1 and credential_id=$2 and credential_version=$7 and fence=$8 and state=$9`, [
        authoritySha256(current.authority),
        current.credentialId,
        replacement.version,
        replacement.fence,
        replacement.state,
        updatedAt,
        current.version,
        current.fence,
        current.state,
      ])
      return updated.rowCount === 1 ? 'created' : 'conflict'
    })
  }

  async #credentialExactWith(
    db: DbClient,
    authority: DomainCredentialAuthority,
    credentialId: string,
    lock: boolean,
  ): Promise<DomainCredentialEnvelope | null> {
    const result = await db.unsafe<CredentialRow>(`select ${CREDENTIAL_COLUMNS}
      from fuma_domain_credential_heads_v2 h
      join fuma_domain_credential_versions_v2 v
        on v.authority_sha256=h.authority_sha256 and v.credential_id=h.credential_id
        and v.credential_version=h.credential_version
      where h.authority_sha256=$1 and h.credential_id=$2${lock ? ' for update of h' : ''}`, [
      authoritySha256(authority),
      credentialId,
    ])
    if (result.rows.length > 1) throw new DomainError('collision', 'Credential head is ambiguous.')
    const envelope = result.rows[0] ? credentialFromRow(result.rows[0]) : null
    if (envelope && credentialAuthorityKey(envelope.authority) !== credentialAuthorityKey(authority)) {
      throw new DomainError('scope', 'Credential digest resolved to foreign authority.')
    }
    return envelope
  }

  async #lockCredential(db: DbClient, authority: DomainCredentialAuthority, credentialId: string): Promise<void> {
    await db`select pg_advisory_xact_lock(hashtextextended(${`fuma:domain-credential:${authoritySha256(authority)}:${credentialId}`},0))`
  }

  async #insertCredentialVersion(db: DbClient, envelope: DomainCredentialEnvelope): Promise<void> {
    const authority = envelope.authority
    const inserted = await db.unsafe(`insert into fuma_domain_credential_versions_v2 (
      authority_sha256,credential_id,credential_version,scope,platform_id,organization_id,
      workspace_id,site_id,owner_key,owner_generation,profile_id,ciphertext,key_id,algorithm,
      fingerprint_sha256,state,fence,created_at,rotated_at,revoked_at,
      rotated_from_fingerprint_sha256
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [
      authoritySha256(authority),
      envelope.credentialId,
      envelope.version,
      authority.scope,
      authority.platformId,
      authority.organizationId,
      authority.workspaceId,
      authority.siteId,
      authority.ownerKey,
      authority.ownerGeneration,
      authority.profileId,
      envelope.ciphertext,
      envelope.keyId,
      envelope.algorithm,
      envelope.fingerprintSha256,
      envelope.state,
      envelope.fence,
      envelope.createdAt,
      envelope.rotatedAt,
      envelope.revokedAt,
      envelope.rotatedFrom,
    ])
    if (inserted.rowCount !== 1) throw new DomainError('stale', 'Credential version evidence conflicted.')
  }
}
