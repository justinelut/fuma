import type { DbClient } from '../../db/client'
import type { DomainScope } from '../domains/contracts'
import {
  DomainRegistrationSchema,
  RegistrarDnsHandoffSchema,
  RegistrarOperationSchema,
  RegistrarPurchaseReceiptSchema,
  RegistrarQuoteSchema,
  RegistrarRenewalReceiptSchema,
  canonicalRegistrarJson,
  registrarHash,
  strictRegistrarValue,
  type DomainRegistration,
  type RegistrarDnsHandoff,
  type RegistrarOperation,
  type RegistrarPurchaseReceipt,
  type RegistrarQuote,
  type RegistrarRenewalReceipt,
} from './contracts'
import { RegistrarWorkflowError, type RegistrarWorkflowRepository } from './workflow'

type JsonRow = Readonly<{ value_json: unknown }>
type OperationRow = Readonly<{
  operation_id: string; kind: 'purchase' | 'renew'; platform_id: string; organization_id: string; workspace_id: string
  site_id: string; owner_key: string; owner_generation: number | string; owner_state: 'active' | 'transferring'
  transfer_fence: number | string | null; profile_id: string; authority_json: unknown; request_hash_sha256: string
  request_json: unknown; quote_id: string; registration_id: string | null; idempotency_key: string
  state: 'pending' | 'ambiguous' | 'succeeded'; attempts: number; created_at: Date | string; updated_at: Date | string
}>
type HandoffRow = Readonly<{ handoff_json: unknown; state: 'pending' | 'completed'; completed_at: Date | string | null }>

const OP_COLUMNS = `operation_id, kind, platform_id, organization_id, workspace_id, site_id, owner_key,
  owner_generation, owner_state, transfer_fence, profile_id, authority_json, request_hash_sha256,
  request_json, quote_id, registration_id, idempotency_key, state, attempts, created_at, updated_at`
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function integer(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new RegistrarWorkflowError('conflict', 'Stored registrar integer is invalid.')
  return result
}
function operation(row: OperationRow): RegistrarOperation {
  const scope = {
    platformId: row.platform_id, organizationId: row.organization_id, workspaceId: row.workspace_id,
    siteId: row.site_id, ownerKey: row.owner_key, generation: integer(row.owner_generation), state: row.owner_state,
    transferFence: row.transfer_fence === null ? null : integer(row.transfer_fence), profileId: row.profile_id,
  }
  return strictRegistrarValue(RegistrarOperationSchema, {
    operationId: row.operation_id, kind: row.kind, scope, authority: json(row.authority_json),
    requestHash: row.request_hash_sha256, request: json(row.request_json), quoteId: row.quote_id,
    registrationId: row.registration_id, idempotencyKey: row.idempotency_key, state: row.state,
    attempts: row.attempts, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }, 'Stored registrar operation')
}
function same(left: unknown, right: unknown): boolean { return canonicalRegistrarJson(left) === canonicalRegistrarJson(right) }
const SCOPE_WHERE = `platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
  and owner_key=$5 and owner_generation=$6 and owner_state=$7 and transfer_fence is not distinct from $8 and profile_id=$9`
function scopeArgs(scope: DomainScope): readonly unknown[] {
  return [
    scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey,
    scope.generation, scope.state, scope.transferFence, scope.profileId,
  ]
}

export class PostgresRegistrarWorkflowRepository implements RegistrarWorkflowRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Registrar lifecycle requires PostgreSQL authority.')
    this.#db = db
  }

  async saveQuote(scope: DomainScope, quote: RegistrarQuote, createdAt: string): Promise<RegistrarQuote> {
    strictRegistrarValue(RegistrarQuoteSchema, quote, 'Registrar quote')
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:registrar-quote:${scope.platformId}:${scope.organizationId}:${quote.quoteId}`},0))`
      const existing = await tx.unsafe<JsonRow>(`select quote_json as value_json from fuma_registrar_quotes_v2 where ${SCOPE_WHERE} and quote_id=$10 for update`, [...scopeArgs(scope), quote.quoteId])
      if (existing.rows[0]) {
        const prior = strictRegistrarValue(RegistrarQuoteSchema, json(existing.rows[0].value_json), 'Stored registrar quote')
        if (!same(prior, quote)) throw new RegistrarWorkflowError('conflict', 'Quote identity changed on replay.')
        return prior
      }
      await tx.unsafe(`insert into fuma_registrar_quotes_v2 (
        platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, owner_state,
        transfer_fence, profile_id, quote_id, quote_json, quote_hash_sha256, expires_at, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`, [
        scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation,
        scope.state, scope.transferFence, scope.profileId, quote.quoteId, JSON.stringify(quote), registrarHash(quote), quote.expiresAt, createdAt,
      ])
      return structuredClone(quote)
    })
  }
  async quote(scope: DomainScope, quoteId: string): Promise<RegistrarQuote | null> {
    const result = await this.#db.unsafe<JsonRow>(`select quote_json as value_json from fuma_registrar_quotes_v2 where ${SCOPE_WHERE} and quote_id=$10`, [...scopeArgs(scope), quoteId])
    return result.rows[0] ? strictRegistrarValue(RegistrarQuoteSchema, json(result.rows[0].value_json), 'Stored registrar quote') : null
  }
  async begin(input: RegistrarOperation): Promise<RegistrarOperation> {
    strictRegistrarValue(RegistrarOperationSchema, input, 'Registrar operation')
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:registrar-operation:${input.operationId}`},0))`
      const prior = await tx.unsafe<OperationRow>(`select ${OP_COLUMNS} from fuma_registrar_operations_v2 where operation_id=$1 or idempotency_key=$2 for update`, [input.operationId, input.idempotencyKey])
      if (prior.rows[0]) {
        const stored = operation(prior.rows[0])
        if (!same(stored, input)) throw new RegistrarWorkflowError('conflict', 'Registrar operation identity changed on replay.')
        return stored
      }
      await tx.unsafe(`insert into fuma_registrar_operations_v2 (
        operation_id, kind, platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation,
        owner_state, transfer_fence, profile_id, authority_json, request_hash_sha256, request_json, quote_id,
        registration_id, idempotency_key, state, attempts, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21)`, [
        input.operationId, input.kind, input.scope.platformId, input.scope.organizationId, input.scope.workspaceId,
        input.scope.siteId, input.scope.ownerKey, input.scope.generation, input.scope.state, input.scope.transferFence,
        input.scope.profileId, JSON.stringify(input.authority), input.requestHash, JSON.stringify(input.request), input.quoteId,
        input.registrationId, input.idempotencyKey, input.state, input.attempts, input.createdAt, input.updatedAt,
      ])
      return structuredClone(input)
    })
  }
  async operation(scope: DomainScope, operationId: string): Promise<RegistrarOperation | null> {
    const result = await this.#db.unsafe<OperationRow>(`select ${OP_COLUMNS} from fuma_registrar_operations_v2 where ${SCOPE_WHERE} and operation_id=$10`, [...scopeArgs(scope), operationId])
    return result.rows[0] ? operation(result.rows[0]) : null
  }
  async recordAttempt(scope: DomainScope, operationId: string, at: string): Promise<RegistrarOperation> {
    const result = await this.#db.unsafe<OperationRow>(`update fuma_registrar_operations_v2 set attempts=attempts+1,state='pending',updated_at=$11
      where ${SCOPE_WHERE} and operation_id=$10 and state in ('pending','ambiguous') and attempts<100 returning ${OP_COLUMNS}`,
    [...scopeArgs(scope), operationId, at])
    if (!result.rows[0]) throw new RegistrarWorkflowError('conflict', 'Registrar operation cannot be attempted.')
    return operation(result.rows[0])
  }
  async markAmbiguous(scope: DomainScope, operationId: string, at: string): Promise<void> {
    const result = await this.#db.unsafe(`update fuma_registrar_operations_v2 set state='ambiguous',updated_at=$11 where ${SCOPE_WHERE} and operation_id=$10 and state<>'succeeded'`, [...scopeArgs(scope), operationId, at])
    if (result.rowCount !== 1) throw new RegistrarWorkflowError('conflict', 'Registrar operation cannot become ambiguous.')
  }
  async registration(scope: DomainScope, registrationId: string): Promise<DomainRegistration | null> {
    const result = await this.#db.unsafe<JsonRow>(`select registration_json as value_json from fuma_domain_registrations_v2 where ${SCOPE_WHERE} and registration_id=$10`, [...scopeArgs(scope), registrationId])
    return result.rows[0] ? strictRegistrarValue(DomainRegistrationSchema, json(result.rows[0].value_json), 'Stored registration') : null
  }
  async registrationForQuote(scope: DomainScope, quoteId: string): Promise<DomainRegistration | null> {
    const result = await this.#db.unsafe<JsonRow>(`select registration_json as value_json from fuma_domain_registrations_v2 where ${SCOPE_WHERE} and quote_id=$10`, [...scopeArgs(scope), quoteId])
    return result.rows[0] ? strictRegistrarValue(DomainRegistrationSchema, json(result.rows[0].value_json), 'Stored registration') : null
  }
  async registrations(scope: DomainScope): Promise<readonly DomainRegistration[]> {
    const result = await this.#db.unsafe<JsonRow>(`select registration_json as value_json from fuma_domain_registrations_v2 where ${SCOPE_WHERE} order by expires_at,registration_id`, [...scopeArgs(scope)])
    return Object.freeze(result.rows.map((row) => strictRegistrarValue(DomainRegistrationSchema, json(row.value_json), 'Stored registration')))
  }
  async purchaseReceipt(scope: DomainScope, operationId: string): Promise<RegistrarPurchaseReceipt | null> {
    const result = await this.#db.unsafe<JsonRow>(`select r.receipt_json as value_json from fuma_registrar_purchase_receipts_v2 r join fuma_registrar_operations_v2 o using(operation_id) where o.platform_id=$1 and o.organization_id=$2 and o.workspace_id=$3 and o.site_id=$4 and o.owner_key=$5 and o.owner_generation=$6 and o.owner_state=$7 and o.transfer_fence is not distinct from $8 and o.profile_id=$9 and r.operation_id=$10`, [...scopeArgs(scope), operationId])
    return result.rows[0] ? strictRegistrarValue(RegistrarPurchaseReceiptSchema, json(result.rows[0].value_json), 'Stored purchase receipt') : null
  }
  async renewalReceipt(scope: DomainScope, operationId: string): Promise<RegistrarRenewalReceipt | null> {
    const result = await this.#db.unsafe<JsonRow>(`select r.receipt_json as value_json from fuma_registrar_renewal_receipts_v2 r join fuma_registrar_operations_v2 o using(operation_id) where o.platform_id=$1 and o.organization_id=$2 and o.workspace_id=$3 and o.site_id=$4 and o.owner_key=$5 and o.owner_generation=$6 and o.owner_state=$7 and o.transfer_fence is not distinct from $8 and o.profile_id=$9 and r.operation_id=$10`, [...scopeArgs(scope), operationId])
    return result.rows[0] ? strictRegistrarValue(RegistrarRenewalReceiptSchema, json(result.rows[0].value_json), 'Stored renewal receipt') : null
  }

  async completePurchase(input: Readonly<{ operation: RegistrarOperation; registration: DomainRegistration; receipt: RegistrarPurchaseReceipt; handoff: RegistrarDnsHandoff; completedAt: string }>): Promise<RegistrarPurchaseReceipt> {
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:registrar-complete:${input.operation.operationId}`},0))`
      const prior = await tx<JsonRow>`select receipt_json as value_json from fuma_registrar_purchase_receipts_v2 where operation_id=${input.operation.operationId}`
      if (prior.rows[0]) {
        const receipt = strictRegistrarValue(RegistrarPurchaseReceiptSchema, json(prior.rows[0].value_json), 'Stored purchase receipt')
        if (!same(receipt, input.receipt)) throw new RegistrarWorkflowError('conflict', 'Purchase receipt changed on replay.')
        return receipt
      }
      const scope = input.operation.scope
      await tx.unsafe(`insert into fuma_domain_registrations_v2 (
        registration_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,owner_state,
        transfer_fence,profile_id,quote_id,hostname,provider_reference,registration_json,expires_at,updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) on conflict do nothing`, [
        input.registration.registrationId, scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId,
        scope.ownerKey, scope.generation, scope.state, scope.transferFence, scope.profileId, input.registration.quoteId,
        input.registration.hostname, input.registration.providerReference, JSON.stringify(input.registration),
        input.registration.expiresAt, input.completedAt,
      ])
      const exact = await tx.unsafe<JsonRow>(`select registration_json as value_json from fuma_domain_registrations_v2 where ${SCOPE_WHERE} and registration_id=$10 for update`, [...scopeArgs(scope), input.registration.registrationId])
      if (!exact.rows[0] || !same(json(exact.rows[0].value_json), input.registration)) throw new RegistrarWorkflowError('conflict', 'Registration identity changed concurrently.')
      await tx`insert into fuma_registrar_purchase_receipts_v2 (receipt_id,operation_id,receipt_json,created_at)
        values (${input.receipt.receiptId},${input.operation.operationId},${JSON.stringify(input.receipt)}::text::jsonb,${input.completedAt})`
      await tx`insert into fuma_registrar_dns_handoffs_v2 (handoff_id,operation_id,handoff_json,state,created_at,completed_at)
        values (${input.handoff.handoffId},${input.operation.operationId},${JSON.stringify(input.handoff)}::text::jsonb,'pending',${input.handoff.createdAt},null)`
      await tx`update fuma_registrar_operations_v2 set state='succeeded',registration_id=${input.registration.registrationId},updated_at=${input.completedAt}
        where operation_id=${input.operation.operationId} and request_hash_sha256=${input.operation.requestHash}`
      return structuredClone(input.receipt)
    })
  }
  async completeRenewal(input: Readonly<{ operation: RegistrarOperation; registration: DomainRegistration; receipt: RegistrarRenewalReceipt; completedAt: string }>): Promise<RegistrarRenewalReceipt> {
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:registrar-renew:${input.receipt.registrationId}:${input.receipt.previousExpiresAt}`},0))`
      const prior = await tx<JsonRow>`select receipt_json as value_json from fuma_registrar_renewal_receipts_v2 where operation_id=${input.operation.operationId} or (registration_id=${input.receipt.registrationId} and previous_expires_at=${input.receipt.previousExpiresAt}) for update`
      if (prior.rows[0]) {
        const receipt = strictRegistrarValue(RegistrarRenewalReceiptSchema, json(prior.rows[0].value_json), 'Stored renewal receipt')
        if (!same(receipt, input.receipt)) throw new RegistrarWorkflowError('conflict', 'Prior expiry was already renewed with different evidence.')
        return receipt
      }
      const current = await tx.unsafe<JsonRow>(`select registration_json as value_json from fuma_domain_registrations_v2 where ${SCOPE_WHERE} and registration_id=$10 for update`, [...scopeArgs(input.operation.scope), input.registration.registrationId])
      if (!current.rows[0]) throw new RegistrarWorkflowError('not-found', 'Registration is unavailable.')
      const priorRegistration = strictRegistrarValue(DomainRegistrationSchema, json(current.rows[0].value_json), 'Stored registration')
      if (priorRegistration.expiresAt !== input.receipt.previousExpiresAt) throw new RegistrarWorkflowError('conflict', 'Registration expiry changed concurrently.')
      await tx`insert into fuma_registrar_renewal_receipts_v2 (receipt_id,operation_id,registration_id,previous_expires_at,receipt_json,created_at)
        values (${input.receipt.receiptId},${input.operation.operationId},${input.receipt.registrationId},${input.receipt.previousExpiresAt},${JSON.stringify(input.receipt)}::text::jsonb,${input.completedAt})`
      await tx.unsafe(`update fuma_domain_registrations_v2 set registration_json=$11::jsonb,
        expires_at=$12,updated_at=$13 where ${SCOPE_WHERE} and registration_id=$10`, [
        ...scopeArgs(input.operation.scope), input.registration.registrationId, JSON.stringify(input.registration),
        input.registration.expiresAt, input.completedAt,
      ])
      await tx`update fuma_registrar_operations_v2 set state='succeeded',updated_at=${input.completedAt} where operation_id=${input.operation.operationId}`
      return structuredClone(input.receipt)
    })
  }
  async pendingHandoff(scope: DomainScope, operationId: string): Promise<RegistrarDnsHandoff | null> {
    const result = await this.#db.unsafe<HandoffRow>(`select h.handoff_json,h.state,h.completed_at from fuma_registrar_dns_handoffs_v2 h join fuma_registrar_operations_v2 o using(operation_id) where o.platform_id=$1 and o.organization_id=$2 and o.workspace_id=$3 and o.site_id=$4 and o.owner_key=$5 and o.owner_generation=$6 and o.owner_state=$7 and o.transfer_fence is not distinct from $8 and o.profile_id=$9 and h.operation_id=$10`, [...scopeArgs(scope), operationId])
    if (!result.rows[0] || result.rows[0].state !== 'pending') return null
    return strictRegistrarValue(RegistrarDnsHandoffSchema, json(result.rows[0].handoff_json), 'Stored DNS handoff')
  }
  async completeHandoff(scope: DomainScope, handoffId: string, completedAt: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const result = await tx.unsafe<{ handoff_json: unknown; operation_id: string }>(`select h.handoff_json,h.operation_id from fuma_registrar_dns_handoffs_v2 h join fuma_registrar_operations_v2 o using(operation_id) where o.platform_id=$1 and o.organization_id=$2 and o.workspace_id=$3 and o.site_id=$4 and o.owner_key=$5 and o.owner_generation=$6 and o.owner_state=$7 and o.transfer_fence is not distinct from $8 and o.profile_id=$9 and h.handoff_id=$10 for update`, [...scopeArgs(scope), handoffId])
      if (!result.rows[0]) throw new RegistrarWorkflowError('not-found', 'DNS onboarding handoff is unavailable.')
      const handoff = strictRegistrarValue(RegistrarDnsHandoffSchema, json(result.rows[0].handoff_json), 'Stored DNS handoff')
      if (handoff.state === 'completed') return
      const completed = strictRegistrarValue(RegistrarDnsHandoffSchema, { ...handoff, state: 'completed', completedAt }, 'Completed DNS handoff')
      await tx`update fuma_registrar_dns_handoffs_v2 set handoff_json=${JSON.stringify(completed)}::text::jsonb,state='completed',completed_at=${completedAt} where handoff_id=${handoffId}`
    })
  }
}
