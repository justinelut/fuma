import type { DbClient } from '../../db/client'
import {
  CustomerMerchantCredentialEnvelopeSchema,
  CustomerMerchantCredentialSchema,
  MembershipPurchaseSchema,
  PaidMembershipSchema,
  PublicationMembershipMetadataSchema,
  PublicationMerchantScopeSchema,
  merchantScopeKey,
  strictValue,
  type CustomerMerchantCredential,
  type MembershipPurchase,
  type PaidMembership,
  type PublicationMembershipMetadata,
  type PublicationMerchantScope,
} from './contracts'
import {
  CustomerPaymentError,
  type CardRenewalAuthority,
  type CustomerPaymentRepository,
  type MembershipActivation,
  type MembershipReminder,
} from './service'

const DAY_MS = 86_400_000

type CredentialRow = Readonly<{
  credential_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: number | string
  version: number
  envelope_json: unknown
  state: CustomerMerchantCredential['state']
  created_at: Date | string
  updated_at: Date | string
}>
type PurchaseRow = Readonly<{
  metadata_json: unknown
  reference: string | null
  authorization_url: string | null
  state: MembershipPurchase['state']
  created_at: Date | string
  settled_at: Date | string | null
}>
type MembershipRow = Readonly<{
  membership_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: number | string
  member_id: string
  tier_id: string
  access_from: Date | string
  access_until: Date | string
  grace_until: Date | string
  renewal: PaidMembership['renewal']
  state: PaidMembership['state']
  provider_reference: string
  provider_transaction_id: string
  credential_id: string
  credential_version: number
  revision: number | string
  updated_at: Date | string
}>
type CardAuthorizationRow = Readonly<{
  membership_id: string
  credential_id: string
  credential_version: number | string
  envelope_json: unknown
  source_metadata_json: unknown
  customer_code: string | null
  state: 'active' | 'revoked' | 'rekey-required'
}>
type TransactionRow = Readonly<{
  purchase_id: string
  membership_id: string
  provider_reference: string
  provider_transaction_id: string
  amount_minor: number | string
  currency: string
  channel: string
  mobile_provider: string | null
}>

function iso(value: Date | string): string {
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  if (!Number.isFinite(Date.parse(result))) throw new CustomerPaymentError('verification', 'Stored timestamp is invalid.')
  return result
}
function positive(value: number | string, label: string): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new CustomerPaymentError('verification', `Stored ${label} is invalid.`)
  return result
}
function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
function scopeFrom(row: CredentialRow | MembershipRow): PublicationMerchantScope {
  return Object.freeze(strictValue(PublicationMerchantScopeSchema, {
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    ownerGeneration: positive(row.owner_generation, 'owner generation'),
  }, 'Stored merchant scope'))
}
function mapCredential(row: CredentialRow): CustomerMerchantCredential {
  return Object.freeze(strictValue(CustomerMerchantCredentialSchema, {
    credentialId: row.credential_id,
    scope: 'customer_merchant',
    merchantScope: scopeFrom(row),
    version: row.version,
    envelope: json(row.envelope_json),
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }, 'Stored customer merchant credential'))
}
function mapPurchase(row: PurchaseRow): MembershipPurchase {
  return Object.freeze(strictValue(MembershipPurchaseSchema, {
    metadata: json(row.metadata_json),
    reference: row.reference,
    authorizationUrl: row.authorization_url,
    state: row.state,
    createdAt: iso(row.created_at),
    settledAt: row.settled_at === null ? null : iso(row.settled_at),
  }, 'Stored membership purchase'))
}
function mapMembership(row: MembershipRow): PaidMembership {
  return Object.freeze(strictValue(PaidMembershipSchema, {
    membershipId: row.membership_id,
    scope: scopeFrom(row),
    memberId: row.member_id,
    tierId: row.tier_id,
    accessFrom: iso(row.access_from),
    accessUntil: iso(row.access_until),
    graceUntil: iso(row.grace_until),
    renewal: row.renewal,
    state: row.state,
    providerReference: row.provider_reference,
    providerTransactionId: row.provider_transaction_id,
    credentialId: row.credential_id,
    credentialVersion: row.credential_version,
    revision: positive(row.revision, 'membership revision'),
    updatedAt: iso(row.updated_at),
  }, 'Stored Publication membership'))
}
function membershipId(metadata: PublicationMembershipMetadata): string {
  const digest = new Bun.CryptoHasher('sha256')
    .update(`${metadata.siteId}:${metadata.memberId}:${metadata.tierId}`)
    .digest('hex')
  return `membership:${digest.slice(0, 40)}`
}
function reminderId(key: string): string {
  return `reminder:${new Bun.CryptoHasher('sha256').update(key).digest('hex').slice(0, 40)}`
}
function exactTransaction(row: TransactionRow, input: MembershipActivation): boolean {
  return row.purchase_id === input.metadata.purchaseId
    && row.provider_reference === input.transaction.reference
    && row.provider_transaction_id === input.transaction.providerTransactionId
    && positive(row.amount_minor, 'payment amount') === input.metadata.amountMinor
    && row.currency === input.metadata.currency
    && row.channel === input.metadata.channel
    && row.mobile_provider === input.metadata.mobileProvider
}

const CREDENTIAL_COLUMNS = `credential_id, platform_id, organization_id, workspace_id, site_id,
  owner_key, owner_generation, version, envelope_json, state, created_at, updated_at`
const MEMBERSHIP_COLUMNS = `membership_id, platform_id, organization_id, workspace_id, site_id,
  owner_key, owner_generation, member_id, tier_id, access_from, access_until, grace_until,
  renewal, state, provider_reference, provider_transaction_id, credential_id,
  credential_version, revision, updated_at`

export class PostgresCustomerPaymentRepository implements CustomerPaymentRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Customer merchant payments require PostgreSQL authority.')
    this.#db = db
  }

  async activeCredential(scope: PublicationMerchantScope): Promise<CustomerMerchantCredential | null> {
    strictValue(PublicationMerchantScopeSchema, scope, 'Merchant scope')
    const result = await this.#db.unsafe<CredentialRow>(`
      select ${CREDENTIAL_COLUMNS} from fuma_customer_merchant_credentials_v2
      where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
        and owner_key=$5 and owner_generation=$6 and state='active'
    `, [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration])
    return result.rows[0] ? mapCredential(result.rows[0]) : null
  }

  async credentialById(credentialId: string): Promise<CustomerMerchantCredential | null> {
    const result = await this.#db.unsafe<CredentialRow>(`
      select ${CREDENTIAL_COLUMNS} from fuma_customer_merchant_credentials_v2 where credential_id=$1
    `, [credentialId])
    return result.rows[0] ? mapCredential(result.rows[0]) : null
  }

  saveCredential(input: CustomerMerchantCredential): Promise<CustomerMerchantCredential> {
    strictValue(CustomerMerchantCredentialSchema, input, 'Customer merchant credential')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-merchant:${merchantScopeKey(input.merchantScope)}`}, 0))`
      const prior = await tx.unsafe<CredentialRow>(`
        select ${CREDENTIAL_COLUMNS} from fuma_customer_merchant_credentials_v2
        where credential_id=$1 for update
      `, [input.credentialId])
      if (prior.rows[0]) {
        const current = mapCredential(prior.rows[0])
        if (merchantScopeKey(current.merchantScope) !== merchantScopeKey(input.merchantScope)
          || input.version < current.version) {
          throw new CustomerPaymentError('conflict', 'Credential identity or version changed.')
        }
      }
      await tx.unsafe(`
        update fuma_customer_merchant_credentials_v2 set state='rekey-required', updated_at=$7
        where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
          and owner_key=$5 and owner_generation=$6 and state='active' and credential_id<>$8
      `, [input.merchantScope.platformId, input.merchantScope.organizationId, input.merchantScope.workspaceId,
        input.merchantScope.siteId, input.merchantScope.ownerKey, input.merchantScope.ownerGeneration,
        input.updatedAt, input.credentialId])
      await tx.unsafe(`
        insert into fuma_customer_merchant_credentials_v2 (
          credential_id, platform_id, organization_id, workspace_id, site_id, owner_key,
          owner_generation, version, envelope_json, state, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
        on conflict (credential_id) do update set
          version=excluded.version, envelope_json=excluded.envelope_json, state=excluded.state,
          updated_at=excluded.updated_at
      `, [input.credentialId, input.merchantScope.platformId, input.merchantScope.organizationId,
        input.merchantScope.workspaceId, input.merchantScope.siteId, input.merchantScope.ownerKey,
        input.merchantScope.ownerGeneration, input.version, JSON.stringify(input.envelope), input.state,
        input.createdAt, input.updatedAt])
      const saved = await tx.unsafe<CredentialRow>(`
        select ${CREDENTIAL_COLUMNS} from fuma_customer_merchant_credentials_v2 where credential_id=$1
      `, [input.credentialId])
      if (!saved.rows[0]) throw new CustomerPaymentError('verification', 'Credential write was not durable.')
      return mapCredential(saved.rows[0])
    })
  }

  preparePurchase(metadata: PublicationMembershipMetadata, createdAt: string): Promise<MembershipPurchase> {
    strictValue(PublicationMembershipMetadataSchema, metadata, 'Membership metadata')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-purchase:${metadata.purchaseId}`}, 0))`
      const existing = await tx<PurchaseRow>`
        select metadata_json, reference, authorization_url, state, created_at, settled_at
        from fuma_customer_membership_purchases_v2 where purchase_id=${metadata.purchaseId} for update
      `
      if (existing.rows[0]) {
        const purchase = mapPurchase(existing.rows[0])
        if (!sameJson(purchase.metadata, metadata)) throw new CustomerPaymentError('conflict', 'Purchase identity changed on retry.')
        return purchase
      }
      if (metadata.renewalConfirmationId !== null) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-confirmation:${metadata.siteId}:${metadata.memberId}:${metadata.renewalConfirmationId}`}, 0))`
        const consumed = await tx<{ purchase_id: string }>`
          select purchase_id from fuma_customer_membership_purchases_v2
          where site_id=${metadata.siteId} and member_id=${metadata.memberId}
            and renewal_confirmation_id=${metadata.renewalConfirmationId}
          limit 1
        `
        if (consumed.rows[0]?.purchase_id !== undefined) {
          throw new CustomerPaymentError('conflict', 'Mobile-money renewal confirmation was already consumed.')
        }
      }
      const credential = await tx<{ state: string; version: number }>`
        select state, version from fuma_customer_merchant_credentials_v2
        where credential_id=${metadata.credentialId} and platform_id=${metadata.platformId}
          and organization_id=${metadata.organizationId} and workspace_id=${metadata.workspaceId}
          and site_id=${metadata.siteId} and owner_key=${metadata.ownerKey}
          and owner_generation=${metadata.ownerGeneration} for update
      `
      if (credential.rows[0]?.state !== 'active' || credential.rows[0].version !== metadata.credentialVersion) {
        throw new CustomerPaymentError('scope', 'Customer merchant credential authority changed.')
      }
      await tx.unsafe(`
        insert into fuma_customer_membership_purchases_v2 (
          purchase_id, platform_id, organization_id, workspace_id, site_id, owner_key,
          owner_generation, member_id, credential_id, credential_version,
          renewal_confirmation_id, metadata_json,
          reference, authorization_url, state, created_at, settled_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,null,null,'prepared',$13,null)
      `, [metadata.purchaseId, metadata.platformId, metadata.organizationId, metadata.workspaceId,
        metadata.siteId, metadata.ownerKey, metadata.ownerGeneration, metadata.memberId,
        metadata.credentialId, metadata.credentialVersion, metadata.renewalConfirmationId,
        JSON.stringify(metadata), createdAt])
      return mapPurchase({ metadata_json: metadata, reference: null, authorization_url: null,
        state: 'prepared', created_at: createdAt, settled_at: null })
    })
  }

  recordInitialization(
    metadata: PublicationMembershipMetadata,
    reference: string,
    authorizationUrl: string | null,
  ): Promise<MembershipPurchase> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<PurchaseRow>`
        select metadata_json, reference, authorization_url, state, created_at, settled_at
        from fuma_customer_membership_purchases_v2 where purchase_id=${metadata.purchaseId} for update
      `
      if (!selected.rows[0]) throw new CustomerPaymentError('not-found', 'Purchase was not prepared.')
      const current = mapPurchase(selected.rows[0])
      if (!sameJson(current.metadata, metadata)) throw new CustomerPaymentError('scope', 'Purchase authority changed.')
      if (current.reference !== null && (current.reference !== reference || current.authorizationUrl !== authorizationUrl)) {
        throw new CustomerPaymentError('conflict', 'Initialization changed on retry.')
      }
      await tx`
        update fuma_customer_membership_purchases_v2 set
          reference=${reference}, authorization_url=${authorizationUrl}, state='initialized'
        where purchase_id=${metadata.purchaseId} and state in ('prepared','initialized')
      `
      return Object.freeze({ ...current, reference, authorizationUrl, state: 'initialized' as const })
    })
  }

  async exactPurchase(metadata: PublicationMembershipMetadata): Promise<MembershipPurchase | null> {
    const result = await this.#db<PurchaseRow>`
      select metadata_json, reference, authorization_url, state, created_at, settled_at
      from fuma_customer_membership_purchases_v2 where purchase_id=${metadata.purchaseId}
    `
    if (!result.rows[0]) return null
    const purchase = mapPurchase(result.rows[0])
    return sameJson(purchase.metadata, metadata) ? purchase : null
  }

  async purchase(scope: PublicationMerchantScope, memberId: string, purchaseId: string): Promise<MembershipPurchase | null> {
    const result = await this.#db.unsafe<PurchaseRow>(`
      select metadata_json, reference, authorization_url, state, created_at, settled_at
      from fuma_customer_membership_purchases_v2 where purchase_id=$1 and platform_id=$2
        and organization_id=$3 and workspace_id=$4 and site_id=$5 and owner_key=$6
        and owner_generation=$7 and member_id=$8
    `, [purchaseId, scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId,
      scope.ownerKey, scope.ownerGeneration, memberId])
    return result.rows[0] ? mapPurchase(result.rows[0]) : null
  }

  activate(input: MembershipActivation): Promise<PaidMembership> {
    return this.#db.transaction(async (tx) => {
      const id = membershipId(input.metadata)
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-membership:${id}`}, 0))`
      const purchaseResult = await tx<PurchaseRow>`
        select metadata_json, reference, authorization_url, state, created_at, settled_at
        from fuma_customer_membership_purchases_v2 where purchase_id=${input.metadata.purchaseId} for update
      `
      if (!purchaseResult.rows[0]) throw new CustomerPaymentError('verification', 'Activation purchase does not exist.')
      const purchase = mapPurchase(purchaseResult.rows[0])
      if (!sameJson(purchase.metadata, input.metadata) || purchase.reference !== input.transaction.reference) {
        throw new CustomerPaymentError('verification', 'Activation does not match the initialized purchase.')
      }
      const duplicate = await tx<TransactionRow>`
        select purchase_id, membership_id, provider_reference, provider_transaction_id,
          amount_minor, currency, channel, mobile_provider
        from fuma_customer_payment_transactions_v2
        where credential_id=${input.metadata.credentialId} and (
          purchase_id=${input.metadata.purchaseId}
          or provider_transaction_id=${input.transaction.providerTransactionId}
          or provider_reference=${input.transaction.reference}
        ) for update
      `
      if (duplicate.rows[0]) {
        if (!exactTransaction(duplicate.rows[0], input) || duplicate.rows[0].membership_id !== id) {
          throw new CustomerPaymentError('conflict', 'Verified provider transaction was already used for another obligation.')
        }
        const prior = await tx.unsafe<MembershipRow>(`
          select ${MEMBERSHIP_COLUMNS} from fuma_publication_memberships_v2 where membership_id=$1
        `, [id])
        if (!prior.rows[0]) throw new CustomerPaymentError('verification', 'Settled transaction has no membership.')
        return mapMembership(prior.rows[0])
      }
      const previousResult = await tx.unsafe<MembershipRow>(`
        select ${MEMBERSHIP_COLUMNS} from fuma_publication_memberships_v2 where membership_id=$1 for update
      `, [id])
      const previous = previousResult.rows[0] ? mapMembership(previousResult.rows[0]) : null
      if (input.metadata.renewalOfMembershipId !== null && input.metadata.renewalOfMembershipId !== id) {
        throw new CustomerPaymentError('verification', 'Renewal target does not match the exact membership identity.')
      }
      const start = Math.max(Date.parse(input.activatedAt), previous ? Date.parse(previous.accessUntil) : Number.NEGATIVE_INFINITY)
      const accessFrom = new Date(start).toISOString()
      const accessUntil = new Date(start + input.metadata.periodDays * DAY_MS).toISOString()
      const graceUntil = new Date(Date.parse(accessUntil) + input.metadata.graceDays * DAY_MS).toISOString()
      const renewal = input.metadata.channel === 'card' ? 'supported-card-recurring' : 'manual-mobile-money'
      await tx.unsafe(`
        insert into fuma_publication_memberships_v2 (
          membership_id, platform_id, organization_id, workspace_id, site_id, owner_key,
          owner_generation, member_id, tier_id, access_from, access_until, grace_until,
          renewal, state, provider_reference, provider_transaction_id, credential_id,
          credential_version, revision, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16,$17,$18,$19)
        on conflict (membership_id) do update set
          access_from=excluded.access_from, access_until=excluded.access_until,
          grace_until=excluded.grace_until, renewal=excluded.renewal, state='active',
          provider_reference=excluded.provider_reference,
          provider_transaction_id=excluded.provider_transaction_id,
          credential_id=excluded.credential_id, credential_version=excluded.credential_version,
          revision=excluded.revision, updated_at=excluded.updated_at
      `, [id, input.metadata.platformId, input.metadata.organizationId, input.metadata.workspaceId,
        input.metadata.siteId, input.metadata.ownerKey, input.metadata.ownerGeneration,
        input.metadata.memberId, input.metadata.tierId, accessFrom, accessUntil, graceUntil,
        renewal, input.transaction.reference, input.transaction.providerTransactionId,
        input.metadata.credentialId, input.metadata.credentialVersion, (previous?.revision ?? 0) + 1,
        input.activatedAt])
      await tx`
        insert into fuma_customer_payment_transactions_v2 (
          purchase_id, membership_id, credential_id, provider_reference, provider_transaction_id,
          amount_minor, currency, channel, mobile_provider, verified_at
        ) values (
          ${input.metadata.purchaseId}, ${id}, ${input.metadata.credentialId},
          ${input.transaction.reference}, ${input.transaction.providerTransactionId},
          ${input.metadata.amountMinor}, ${input.metadata.currency}, ${input.metadata.channel},
          ${input.metadata.mobileProvider}, ${input.activatedAt}
        )
      `
      if (input.metadata.channel === 'card') {
        if (!input.recurringAuthorization) throw new CustomerPaymentError('verification', 'Recurring card authorization is missing.')
        strictValue(CustomerMerchantCredentialEnvelopeSchema, input.recurringAuthorization, 'Recurring authorization envelope')
        await tx.unsafe(`
          insert into fuma_customer_card_authorizations_v2 (
            membership_id, credential_id, credential_version, envelope_json,
            source_metadata_json, customer_code, state, updated_at
          ) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'active',$7)
          on conflict (membership_id) do update set
            credential_id=excluded.credential_id, credential_version=excluded.credential_version,
            envelope_json=excluded.envelope_json,
            source_metadata_json=excluded.source_metadata_json,
            customer_code=excluded.customer_code, state='active', updated_at=excluded.updated_at
        `, [id, input.metadata.credentialId, input.metadata.credentialVersion,
          JSON.stringify(input.recurringAuthorization), JSON.stringify(input.metadata),
          input.recurringCustomerCode, input.activatedAt])
      }
      await tx`
        update fuma_customer_membership_purchases_v2
        set state='settled', settled_at=${input.activatedAt}
        where purchase_id=${input.metadata.purchaseId}
      `
      const saved = await tx.unsafe<MembershipRow>(`
        select ${MEMBERSHIP_COLUMNS} from fuma_publication_memberships_v2 where membership_id=$1
      `, [id])
      if (!saved.rows[0]) throw new CustomerPaymentError('verification', 'Membership activation was not durable.')
      return mapMembership(saved.rows[0])
    })
  }

  async membership(scope: PublicationMerchantScope, memberId: string, id: string): Promise<PaidMembership | null> {
    const result = await this.#db.unsafe<MembershipRow>(`
      select ${MEMBERSHIP_COLUMNS} from fuma_publication_memberships_v2
      where membership_id=$1 and platform_id=$2 and organization_id=$3 and workspace_id=$4
        and site_id=$5 and owner_key=$6 and owner_generation=$7 and member_id=$8
    `, [id, scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId,
      scope.ownerKey, scope.ownerGeneration, memberId])
    return result.rows[0] ? mapMembership(result.rows[0]) : null
  }

  async cardRenewalAuthority(
    scope: PublicationMerchantScope,
    memberId: string,
    id: string,
  ): Promise<CardRenewalAuthority | null> {
    const membership = await this.membership(scope, memberId, id)
    if (!membership || membership.renewal !== 'supported-card-recurring') return null
    const result = await this.#db.unsafe<CardAuthorizationRow>(`
      select membership_id, credential_id, credential_version, envelope_json,
        source_metadata_json, customer_code, state
      from fuma_customer_card_authorizations_v2
      where membership_id=$1 and credential_id=$2 and credential_version=$3 and state='active'
    `, [id, membership.credentialId, membership.credentialVersion])
    const row = result.rows[0]
    if (!row) return null
    return Object.freeze({
      membership,
      sourceMetadata: Object.freeze(strictValue(
        PublicationMembershipMetadataSchema,
        json(row.source_metadata_json),
        'Stored card authorization metadata',
      )),
      authorization: Object.freeze(strictValue(
        CustomerMerchantCredentialEnvelopeSchema,
        json(row.envelope_json),
        'Stored recurring authorization envelope',
      )),
      customerCode: row.customer_code,
    })
  }

  async acknowledgeReminder(reminderIdValue: string, deliveredAt: string): Promise<void> {
    const result = await this.#db.unsafe(`
      update fuma_customer_membership_reminders_v2 set delivered_at=$1
      where reminder_id=$2 and delivered_at is null
    `, [deliveredAt, reminderIdValue])
    if (result.rowCount > 1) throw new CustomerPaymentError('verification', 'Reminder acknowledgement was not singular.')
  }

  processLifecycle(now: string, limit: number, cursor: string | null): Promise<Readonly<{
    processed: number
    nextCursor: string | null
    reminders: readonly MembershipReminder[]
    memberships: readonly PaidMembership[]
  }>> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx.unsafe<MembershipRow>(`
        select ${MEMBERSHIP_COLUMNS} from fuma_publication_memberships_v2
        where ($1::text is null or membership_id > $1)
        order by membership_id for update skip locked limit $2
      `, [cursor, limit])
      const reminders: MembershipReminder[] = []
      const memberships: PaidMembership[] = []
      const instant = Date.parse(now)
      for (const raw of selected.rows) {
        const row = mapMembership(raw)
        const state: PaidMembership['state'] = instant < Date.parse(row.accessUntil)
          ? 'active'
          : instant < Date.parse(row.graceUntil) ? 'grace' : 'expired'
        if (state !== row.state) {
          const updated = await tx.unsafe(`
            update fuma_publication_memberships_v2 set state=$1, revision=revision+1, updated_at=$2
            where membership_id=$3 and revision=$4
          `, [state, now, row.membershipId, row.revision])
          if (updated.rowCount !== 1) throw new CustomerPaymentError('conflict', 'Membership lifecycle authority changed.')
        }
        memberships.push(Object.freeze(state === row.state ? row : {
          ...row,
          state,
          revision: row.revision + 1,
          updatedAt: now,
        }))
        const kind: MembershipReminder['kind'] | null = state === 'active'
          ? Date.parse(row.accessUntil) - instant <= 3 * DAY_MS ? 'renewal-due' : null
          : state === 'grace' ? 'grace-started' : 'expired'
        if (kind === null) continue
        const key = `${row.membershipId}:${row.accessUntil}:${kind}`
        const reminder: MembershipReminder = Object.freeze({
          reminderId: reminderId(key),
          membershipId: row.membershipId,
          siteId: row.scope.siteId,
          memberId: row.memberId,
          kind,
          dueAt: kind === 'expired' ? row.graceUntil : row.accessUntil,
          renewal: row.renewal,
        })
        const inserted = await tx.unsafe(`
          insert into fuma_customer_membership_reminders_v2 (
            reminder_id, membership_id, period_access_until, kind, due_at, payload_json, created_at
          ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)
          on conflict (membership_id, period_access_until, kind) do nothing
        `, [reminder.reminderId, reminder.membershipId, row.accessUntil, reminder.kind,
          reminder.dueAt, JSON.stringify(reminder), now])
        if (inserted.rowCount === 1) {
          reminders.push(reminder)
        } else {
          const pending = await tx<{ delivered_at: Date | string | null }>`
            select delivered_at from fuma_customer_membership_reminders_v2
            where reminder_id=${reminder.reminderId}
          `
          if (pending.rows[0]?.delivered_at === null) reminders.push(reminder)
        }
      }
      return Object.freeze({
        processed: selected.rows.length,
        nextCursor: selected.rows.length === limit ? mapMembership(selected.rows.at(-1) as MembershipRow).membershipId : null,
        reminders: Object.freeze(reminders),
        memberships: Object.freeze(memberships),
      })
    })
  }
}
