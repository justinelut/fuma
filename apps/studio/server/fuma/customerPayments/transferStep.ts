import type { DbClient } from '../../db/client'
import type { TransferReceipt } from '../transfers/contracts'
import type {
  TransferSagaFence,
  TransferStepCompensation,
  TransferStepDefinition,
  TransferStepExecutionInput,
  TransferStepVerification,
} from '../transfers/stepRegistry'
import {
  CredentialTransferChoiceSchema,
  merchantScopeKey,
  strictValue,
  type CredentialTransferChoice,
  type PublicationMerchantScope,
} from './contracts'
import { CustomerPaymentError } from './service'

export const CUSTOMER_MERCHANT_CREDENTIAL_TRANSFER_STEP_ID = 'customer-merchant-credentials'
export const CUSTOMER_MERCHANT_CREDENTIAL_TRANSFER_STEP_ORDER = 610

type TransferState = Readonly<{
  choice: CredentialTransferChoice
  credentialId: string | null
  credentialVersion: number | null
  credentialState: 'active' | 'rekey-required' | 'detached' | null
  appliedFence: number | null
  applyReceipt: TransferReceipt | null
  compensatedFence: number | null
  compensationReceipt: TransferReceipt | null
}>

export interface CustomerCredentialTransferRepository {
  recordChoice(choice: CredentialTransferChoice): Promise<CredentialTransferChoice>
  inspect(transferId: string): Promise<TransferState | null>
  apply(transferId: string, saga: TransferSagaFence): Promise<TransferState>
  compensate(transferId: string, saga: TransferSagaFence): Promise<TransferState>
}

export interface CustomerCredentialTransferOwnerAuthority {
  assertCurrent(input: Readonly<{
    source: PublicationMerchantScope
    destination: PublicationMerchantScope
    saga: TransferSagaFence
    phase: 'apply' | 'verify' | 'compensate'
  }>): Promise<void>
}

function coordinateMatches(
  scope: PublicationMerchantScope,
  coordinate: TransferStepExecutionInput['manifest']['source'],
): boolean {
  return scope.platformId === coordinate.platformId
    && scope.organizationId === coordinate.organizationId
    && scope.workspaceId === coordinate.workspaceId
    && scope.siteId === coordinate.siteId
}
function receipt(choice: CredentialTransferChoice, state: TransferState, saga: TransferSagaFence): TransferReceipt {
  return Object.freeze({
    code: 'customer-merchant-credentials-applied',
    details: Object.freeze({
      transferId: choice.transferId,
      choice: choice.choice,
      sourceScopeKey: merchantScopeKey(choice.source),
      destinationScopeKey: merchantScopeKey(choice.destination),
      credentialId: state.credentialId ?? 'none',
      credentialVersion: state.credentialVersion ?? 0,
      fence: saga.fence,
    }),
  })
}
function compensatedReceipt(applyReceipt: TransferReceipt): TransferReceipt {
  return Object.freeze({
    code: 'customer-merchant-credentials-compensated',
    details: Object.freeze({ applyReceipt }),
  })
}
function sameReceipt(left: TransferReceipt | null, right: TransferReceipt): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}
function assertInput(input: TransferStepExecutionInput, choice: CredentialTransferChoice): void {
  if (input.manifest.transferId !== input.saga.transferId || choice.transferId !== input.saga.transferId
    || !coordinateMatches(choice.source, input.manifest.source)
    || !coordinateMatches(choice.destination, input.manifest.destination)
    || choice.source.siteId !== choice.destination.siteId) {
    throw new CustomerPaymentError('scope', 'Credential transfer choice does not match the immutable transfer manifest.')
  }
}

class CustomerCredentialTransferHandlers {
  readonly #repository: CustomerCredentialTransferRepository
  readonly #owner: CustomerCredentialTransferOwnerAuthority

  constructor(repository: CustomerCredentialTransferRepository, owner: CustomerCredentialTransferOwnerAuthority) {
    this.#repository = repository
    this.#owner = owner
  }

  async #state(input: TransferStepExecutionInput): Promise<TransferState> {
    const state = await this.#repository.inspect(input.saga.transferId)
    if (!state) throw new CustomerPaymentError('conflict', 'Transfer requires an explicit credential rekey or detach choice.')
    assertInput(input, state.choice)
    return state
  }

  async apply(input: TransferStepExecutionInput): Promise<TransferReceipt> {
    const before = await this.#state(input)
    await this.#owner.assertCurrent({
      source: before.choice.source,
      destination: before.choice.destination,
      saga: input.saga,
      phase: 'apply',
    })
    const expected = receipt(before.choice, before, input.saga)
    if (input.receipt !== null && !sameReceipt(input.receipt, expected)) {
      throw new CustomerPaymentError('conflict', 'Credential transfer receipt changed on retry.')
    }
    const after = await this.#repository.apply(input.saga.transferId, input.saga)
    const durable = receipt(after.choice, after, input.saga)
    if (!sameReceipt(after.applyReceipt, durable)) {
      throw new CustomerPaymentError('verification', 'Credential transfer did not persist its exact receipt.')
    }
    return durable
  }

  async verify(input: TransferStepExecutionInput): Promise<TransferStepVerification> {
    const state = await this.#state(input)
    await this.#owner.assertCurrent({
      source: state.choice.source,
      destination: state.choice.destination,
      saga: input.saga,
      phase: 'verify',
    })
    if (state.appliedFence === null || state.applyReceipt === null) {
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    const expected = receipt(state.choice, state, input.saga)
    if (state.appliedFence !== input.saga.fence || !sameReceipt(state.applyReceipt, expected)
      || (state.choice.choice === 'rekey' && state.credentialState !== 'rekey-required')
      || (state.choice.choice === 'detach' && state.credentialState !== 'detached')) {
      throw new CustomerPaymentError('verification', 'Credential transfer durable state drifted.')
    }
    if (input.receipt !== null && !sameReceipt(input.receipt, expected)) {
      throw new CustomerPaymentError('verification', 'Credential transfer replay receipt drifted.')
    }
    return Object.freeze({ status: 'verified', receipt: expected })
  }

  async compensate(input: TransferStepExecutionInput): Promise<TransferStepCompensation> {
    const before = await this.#state(input)
    await this.#owner.assertCurrent({
      source: before.choice.source,
      destination: before.choice.destination,
      saga: input.saga,
      phase: 'compensate',
    })
    if (before.appliedFence === null) return Object.freeze({ status: 'not-applied', receipt: null })
    const expected = receipt(before.choice, before, input.saga)
    if (!sameReceipt(input.receipt, expected) || !sameReceipt(before.applyReceipt, expected)) {
      throw new CustomerPaymentError('verification', 'Credential compensation requires the exact apply receipt.')
    }
    const after = await this.#repository.compensate(input.saga.transferId, input.saga)
    const compensation = compensatedReceipt(expected)
    if (!sameReceipt(after.compensationReceipt, compensation) || after.credentialState !== 'active') {
      throw new CustomerPaymentError('verification', 'Credential compensation did not restore source authority.')
    }
    return Object.freeze({ status: 'compensated', receipt: compensation })
  }
}

export function createCustomerMerchantCredentialTransferStep(
  repository: CustomerCredentialTransferRepository,
  owner: CustomerCredentialTransferOwnerAuthority,
): TransferStepDefinition {
  const handlers = new CustomerCredentialTransferHandlers(repository, owner)
  return Object.freeze({
    id: CUSTOMER_MERCHANT_CREDENTIAL_TRANSFER_STEP_ID,
    order: CUSTOMER_MERCHANT_CREDENTIAL_TRANSFER_STEP_ORDER,
    dependsOn: Object.freeze([]),
    apply: (input) => handlers.apply(input),
    verify: (input) => handlers.verify(input),
    compensate: (input) => handlers.compensate(input),
  })
}

type ChoiceRow = Readonly<{
  transfer_id: string
  source_scope_json: unknown
  destination_scope_json: unknown
  choice: 'rekey' | 'detach'
  recorded_at: Date | string
  applied_fence: number | string | null
  apply_receipt_json: unknown | null
  compensated_fence: number | string | null
  compensation_receipt_json: unknown | null
  credential_id: string | null
  credential_version: number | null
  credential_state: TransferState['credentialState']
}>

function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }
function integer(value: number | string | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CustomerPaymentError('verification', 'Stored transfer fence is invalid.')
  return parsed
}
function transferReceipt(value: unknown | null): TransferReceipt | null {
  if (value === null) return null
  const parsed = json(value)
  if (!parsed || typeof parsed !== 'object') throw new CustomerPaymentError('verification', 'Stored transfer receipt is invalid.')
  return parsed as TransferReceipt
}
function mapState(row: ChoiceRow): TransferState {
  const choice = strictValue(CredentialTransferChoiceSchema, {
    transferId: row.transfer_id,
    source: json(row.source_scope_json),
    destination: json(row.destination_scope_json),
    choice: row.choice,
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : new Date(row.recorded_at).toISOString(),
  }, 'Stored credential transfer choice')
  return Object.freeze({
    choice: Object.freeze(choice),
    credentialId: row.credential_id,
    credentialVersion: row.credential_version,
    credentialState: row.credential_state,
    appliedFence: integer(row.applied_fence),
    applyReceipt: transferReceipt(row.apply_receipt_json),
    compensatedFence: integer(row.compensated_fence),
    compensationReceipt: transferReceipt(row.compensation_receipt_json),
  })
}

const INSPECT_SQL = `
  select c.transfer_id, c.source_scope_json, c.destination_scope_json, c.choice,
    c.recorded_at, c.applied_fence, c.apply_receipt_json, c.compensated_fence,
    c.compensation_receipt_json, c.credential_id, c.credential_version,
    m.state as credential_state
  from fuma_customer_credential_transfer_choices_v2 c
  left join fuma_customer_merchant_credentials_v2 m
    on m.credential_id=c.credential_id and m.version=c.credential_version
  where c.transfer_id=$1
  limit 1
`

export class PostgresCustomerCredentialTransferRepository implements CustomerCredentialTransferRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Customer credential transfer requires PostgreSQL authority.')
    this.#db = db
  }

  recordChoice(choice: CredentialTransferChoice): Promise<CredentialTransferChoice> {
    strictValue(CredentialTransferChoiceSchema, choice, 'Credential transfer choice')
    return this.#db.transaction(async (tx) => {
      const credential = await tx.unsafe<Readonly<{ credential_id: string; version: number }>>(`
        select credential_id, version from fuma_customer_merchant_credentials_v2
        where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
          and owner_key=$5 and owner_generation=$6 and state='active'
        for update
      `, [choice.source.platformId, choice.source.organizationId, choice.source.workspaceId,
        choice.source.siteId, choice.source.ownerKey, choice.source.ownerGeneration])
      const selected = credential.rows[0] ?? null
      const inserted = await tx.unsafe(`
        insert into fuma_customer_credential_transfer_choices_v2 (
          transfer_id, site_id, source_scope_json, destination_scope_json, choice,
          credential_id, credential_version, recorded_at
        ) values ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) on conflict (transfer_id) do nothing
      `, [choice.transferId, choice.source.siteId, JSON.stringify(choice.source),
        JSON.stringify(choice.destination), choice.choice, selected?.credential_id ?? null,
        selected?.version ?? null, choice.recordedAt])
      const found = await tx.unsafe<ChoiceRow>(INSPECT_SQL, [choice.transferId])
      if (!found.rows[0]) throw new CustomerPaymentError('verification', 'Credential transfer choice was not durable.')
      const stored = mapState(found.rows[0]).choice
      if (!sameJson(stored, choice)) throw new CustomerPaymentError('conflict', 'Credential transfer choice changed on retry.')
      if (inserted.rowCount > 1) throw new CustomerPaymentError('verification', 'Credential transfer choice write was not singular.')
      return stored
    })
  }

  async inspect(transferId: string): Promise<TransferState | null> {
    const result = await this.#db.unsafe<ChoiceRow>(INSPECT_SQL, [transferId])
    return result.rows[0] ? mapState(result.rows[0]) : null
  }

  apply(transferId: string, saga: TransferSagaFence): Promise<TransferState> {
    return this.#db.transaction(async (tx) => {
      const locked = await tx.unsafe<ChoiceRow>(`${INSPECT_SQL.replace(' limit 1', ' limit 1 for update of c')}`, [transferId])
      if (!locked.rows[0]) throw new CustomerPaymentError('not-found', 'Credential transfer choice was not found.')
      const before = mapState(locked.rows[0])
      if (before.appliedFence !== null) {
        if (before.appliedFence !== saga.fence) throw new CustomerPaymentError('conflict', 'Credential transfer carries a stale fence.')
        return before
      }
      const expected = receipt(before.choice, before, saga)
      if (before.credentialId !== null) {
        const state = before.choice.choice === 'rekey' ? 'rekey-required' : 'detached'
        const destination = before.choice.destination
        const moved = await tx.unsafe(`
          update fuma_customer_merchant_credentials_v2 set
            platform_id=$1, organization_id=$2, workspace_id=$3, site_id=$4,
            owner_key=$5, owner_generation=$6, state=$7, updated_at=now()
          where credential_id=$8 and version=$9 and state='active'
        `, [destination.platformId, destination.organizationId, destination.workspaceId,
          destination.siteId, destination.ownerKey, destination.ownerGeneration, state,
          before.credentialId, before.credentialVersion])
        if (moved.rowCount !== 1) {
          throw new CustomerPaymentError('conflict', 'Credential changed before transfer application.')
        }
        await tx`
          update fuma_customer_card_authorizations_v2 set
            state=${before.choice.choice === 'rekey' ? 'rekey-required' : 'revoked'}, updated_at=now()
          where credential_id=${before.credentialId} and credential_version=${before.credentialVersion}
        `
      }
      await tx.unsafe(`
        update fuma_customer_credential_transfer_choices_v2
        set applied_fence=$1, apply_receipt_json=$2::jsonb
        where transfer_id=$3 and applied_fence is null
      `, [saga.fence, JSON.stringify(expected), transferId])
      const after = await tx.unsafe<ChoiceRow>(INSPECT_SQL, [transferId])
      if (!after.rows[0]) throw new CustomerPaymentError('verification', 'Credential transfer state disappeared.')
      return mapState(after.rows[0])
    })
  }

  compensate(transferId: string, saga: TransferSagaFence): Promise<TransferState> {
    return this.#db.transaction(async (tx) => {
      const locked = await tx.unsafe<ChoiceRow>(`${INSPECT_SQL.replace(' limit 1', ' limit 1 for update of c')}`, [transferId])
      if (!locked.rows[0]) throw new CustomerPaymentError('not-found', 'Credential transfer choice was not found.')
      const before = mapState(locked.rows[0])
      if (before.appliedFence !== saga.fence || before.applyReceipt === null) {
        throw new CustomerPaymentError('conflict', 'Credential compensation carries a stale or unapplied fence.')
      }
      if (before.compensatedFence !== null) {
        if (before.compensatedFence !== saga.fence) throw new CustomerPaymentError('conflict', 'Credential compensation fence changed.')
        return before
      }
      const source = before.choice.source
      if (before.credentialId !== null) {
        const restored = await tx.unsafe(`
          update fuma_customer_merchant_credentials_v2 set
            platform_id=$1, organization_id=$2, workspace_id=$3, site_id=$4,
            owner_key=$5, owner_generation=$6, state='active', updated_at=now()
          where credential_id=$7 and version=$8 and state in ('rekey-required','detached')
        `, [source.platformId, source.organizationId, source.workspaceId, source.siteId,
          source.ownerKey, source.ownerGeneration, before.credentialId, before.credentialVersion])
        if (restored.rowCount !== 1) throw new CustomerPaymentError('conflict', 'Credential changed after transfer and cannot be silently restored.')
        await tx`
          update fuma_customer_card_authorizations_v2 set state='active', updated_at=now()
          where credential_id=${before.credentialId} and credential_version=${before.credentialVersion}
            and state in ('rekey-required','revoked')
        `
      }
      const compensation = compensatedReceipt(before.applyReceipt)
      await tx.unsafe(`
        update fuma_customer_credential_transfer_choices_v2
        set compensated_fence=$1, compensation_receipt_json=$2::jsonb
        where transfer_id=$3 and compensated_fence is null
      `, [saga.fence, JSON.stringify(compensation), transferId])
      const after = await tx.unsafe<ChoiceRow>(INSPECT_SQL, [transferId])
      if (!after.rows[0]) throw new CustomerPaymentError('verification', 'Credential compensation state disappeared.')
      return mapState(after.rows[0])
    })
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class MemoryCustomerCredentialTransferRepository implements CustomerCredentialTransferRepository {
  readonly states = new Map<string, TransferState>()
  seedCredential(transferId: string, credentialId: string, credentialVersion: number): void {
    const prior = this.states.get(transferId)
    if (!prior || prior.appliedFence !== null || prior.compensatedFence !== null) {
      throw new CustomerPaymentError('conflict', 'Transfer credential fixture cannot replace durable state.')
    }
    this.states.set(transferId, Object.freeze({
      ...prior,
      credentialId,
      credentialVersion,
      credentialState: 'active',
    }))
  }
  async recordChoice(choice: CredentialTransferChoice) {
    const prior = this.states.get(choice.transferId)
    if (prior && !sameJson(prior.choice, choice)) throw new CustomerPaymentError('conflict', 'Credential transfer choice changed on retry.')
    if (!prior) this.states.set(choice.transferId, Object.freeze({
      choice, credentialId: null, credentialVersion: null, credentialState: null,
      appliedFence: null, applyReceipt: null, compensatedFence: null, compensationReceipt: null,
    }))
    return choice
  }
  async inspect(id: string) { return this.states.get(id) ?? null }
  async apply(id: string, saga: TransferSagaFence) {
    const prior = this.states.get(id)
    if (!prior) throw new CustomerPaymentError('not-found', 'Credential transfer choice was not found.')
    if (prior.appliedFence !== null && prior.appliedFence !== saga.fence) throw new CustomerPaymentError('conflict', 'Credential transfer carries a stale fence.')
    const next: TransferState = prior.appliedFence === null ? Object.freeze({
      ...prior,
      credentialState: prior.choice.choice === 'rekey' ? 'rekey-required' : 'detached',
      appliedFence: saga.fence,
      applyReceipt: receipt(prior.choice, prior, saga),
    }) : prior
    this.states.set(id, next)
    return next
  }
  async compensate(id: string, saga: TransferSagaFence) {
    const prior = this.states.get(id)
    if (!prior || prior.appliedFence !== saga.fence || prior.applyReceipt === null) throw new CustomerPaymentError('conflict', 'Credential compensation is stale.')
    const next: TransferState = Object.freeze({
      ...prior,
      credentialState: 'active',
      compensatedFence: saga.fence,
      compensationReceipt: compensatedReceipt(prior.applyReceipt),
    })
    this.states.set(id, next)
    return next
  }
}
