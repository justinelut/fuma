import type { DbClient } from '../../db/client'
import type { CustomerPaymentReceipt, CustomerPaymentRefund } from '@core/plugin-sdk/paymentSchemas'
import type { VerifiedPaystackTransaction } from '../paystack/transport'
import { CustomerPaymentError, sha256 } from './service'
import {
  CustomerPaymentReceiptSchema,
  CustomerPluginPaymentMetadataSchema,
  CustomerPluginPaymentSchema,
  CustomerPluginRefundRecordSchema,
  parseCustomerPluginContract,
  type CustomerPluginPayment,
  type CustomerPluginPaymentMetadata,
  type CustomerPluginRefundRecord,
  type ReviewedCustomerPaymentPluginAuthority,
} from './pluginContracts'
import type { CustomerPluginPaymentRepository } from './plugin'

interface PaymentRow {
  metadata_json: unknown
  payer_email_sha256: string
  reference: string | null
  authorization_url: string | null
  state: CustomerPluginPayment['state']
  created_at: Date | string
  settled_at: Date | string | null
  refunded_at: Date | string | null
}
interface ReceiptRow { receipt_json: unknown }
interface RefundRow { record_json: unknown }

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function iso(value: Date | string): string {
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  if (!Number.isFinite(Date.parse(result))) throw new CustomerPaymentError('verification', 'Stored plugin payment timestamp is invalid.')
  return result
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right) }
function mapPayment(row: PaymentRow): CustomerPluginPayment {
  return parseCustomerPluginContract(CustomerPluginPaymentSchema, {
    metadata: json(row.metadata_json),
    payerEmailSha256: row.payer_email_sha256,
    reference: row.reference,
    authorizationUrl: row.authorization_url,
    state: row.state,
    createdAt: iso(row.created_at),
    settledAt: row.settled_at === null ? null : iso(row.settled_at),
    refundedAt: row.refunded_at === null ? null : iso(row.refunded_at),
  }, 'Stored plugin payment') as CustomerPluginPayment
}
function mapReceipt(row: ReceiptRow): CustomerPaymentReceipt {
  return parseCustomerPluginContract(CustomerPaymentReceiptSchema, json(row.receipt_json), 'Stored plugin payment receipt') as CustomerPaymentReceipt
}
function mapRefund(row: RefundRow): CustomerPluginRefundRecord {
  return parseCustomerPluginContract(CustomerPluginRefundRecordSchema, json(row.record_json), 'Stored plugin payment refund') as CustomerPluginRefundRecord
}
function publicRefund(value: CustomerPluginRefundRecord): CustomerPaymentRefund {
  if (value.state !== 'refunded' || value.providerRefundSha256 === null || value.refundedAt === null) throw new CustomerPaymentError('verification', 'Stored plugin refund is incomplete.')
  return Object.freeze({ refundId: value.refundId, receiptId: value.receiptId, paymentId: value.paymentId, amountMinor: value.amountMinor, currency: value.currency, providerRefundSha256: value.providerRefundSha256, state: 'refunded', refundedAt: value.refundedAt })
}

const PAYMENT_COLUMNS = `metadata_json,payer_email_sha256,reference,authorization_url,state,created_at,settled_at,refunded_at`

export class PostgresCustomerPluginPaymentRepository implements CustomerPluginPaymentRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Customer payment plugin requires PostgreSQL authority.')
    this.#db = db
  }

  preparePayment(metadata: CustomerPluginPaymentMetadata, payerEmailSha256: string, createdAt: string): Promise<CustomerPluginPayment> {
    parseCustomerPluginContract(CustomerPluginPaymentMetadataSchema, metadata, 'Plugin payment metadata')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-plugin-payment:${metadata.paymentId}`},0))`
      const selected = await tx.unsafe<PaymentRow>(`select ${PAYMENT_COLUMNS} from fuma_customer_plugin_payments_v1 where payment_id=$1 for update`, [metadata.paymentId])
      if (selected.rows[0]) {
        const existing = mapPayment(selected.rows[0])
        if (!same(existing.metadata, metadata) || existing.payerEmailSha256 !== payerEmailSha256) throw new CustomerPaymentError('conflict', 'Plugin payment identity changed on retry.')
        return existing
      }
      const installation = await tx<{ state: string }>`
        select state from fuma_artifact_installations_v2
        where platform_id=${metadata.platformId} and organization_id=${metadata.organizationId}
          and workspace_id=${metadata.workspaceId} and site_id=${metadata.siteId}
          and owner_key=${metadata.ownerKey} and owner_generation=${metadata.ownerGeneration}
          and installation_id=${metadata.installationId} and artifact_id=${metadata.artifactId}
          and content_hash_sha256=${metadata.contentHashSha256} and package_id='fuma.customer-payments'
          and exact_version=${metadata.exactVersion} and artifact_kind='plugin'
          and execution_policy='plugin-sandbox-worker' and secret_json is null for update
      `
      if (installation.rows[0]?.state !== 'active') throw new CustomerPaymentError('scope', 'Exact reviewed plugin installation is unavailable.')
      const credential = await tx<{ state: string; version: number }>`
        select state,version from fuma_customer_merchant_credentials_v2
        where credential_id=${metadata.credentialId} and platform_id=${metadata.platformId}
          and organization_id=${metadata.organizationId} and workspace_id=${metadata.workspaceId}
          and site_id=${metadata.siteId} and owner_key=${metadata.ownerKey}
          and owner_generation=${metadata.ownerGeneration} for update
      `
      if (credential.rows[0]?.state !== 'active' || credential.rows[0].version !== metadata.credentialVersion) throw new CustomerPaymentError('scope', 'Customer merchant credential authority changed.')
      await tx.unsafe(`
        insert into fuma_customer_plugin_payments_v1 (
          payment_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,
          installation_id,artifact_id,content_hash_sha256,review_submission_id,review_decision_id,
          review_signature_key_id,credential_id,credential_version,purpose,amount_minor,currency,
          payer_email_sha256,metadata_json,reference,authorization_url,state,created_at,settled_at,refunded_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::text::jsonb,null,null,'prepared',$21,null,null)
      `, [metadata.paymentId,metadata.platformId,metadata.organizationId,metadata.workspaceId,metadata.siteId,
        metadata.ownerKey,metadata.ownerGeneration,metadata.installationId,metadata.artifactId,metadata.contentHashSha256,
        metadata.reviewSubmissionId,metadata.reviewDecisionId,metadata.reviewSignatureKeyId,metadata.credentialId,
        metadata.credentialVersion,metadata.purpose,metadata.amountMinor,metadata.currency,payerEmailSha256,
        JSON.stringify(metadata),createdAt])
      return mapPayment({ metadata_json: metadata, payer_email_sha256: payerEmailSha256, reference: null, authorization_url: null, state: 'prepared', created_at: createdAt, settled_at: null, refunded_at: null })
    })
  }

  recordInitialization(metadata: CustomerPluginPaymentMetadata, reference: string, authorizationUrl: string): Promise<CustomerPluginPayment> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx.unsafe<PaymentRow>(`select ${PAYMENT_COLUMNS} from fuma_customer_plugin_payments_v1 where payment_id=$1 for update`, [metadata.paymentId])
      if (!selected.rows[0]) throw new CustomerPaymentError('not-found', 'Plugin payment was not prepared.')
      const current = mapPayment(selected.rows[0])
      if (!same(current.metadata, metadata)) throw new CustomerPaymentError('scope', 'Plugin payment authority changed.')
      if (current.reference !== null && (current.reference !== reference || current.authorizationUrl !== authorizationUrl)) throw new CustomerPaymentError('conflict', 'Plugin payment initialization changed on retry.')
      if (current.state === 'prepared') await tx`update fuma_customer_plugin_payments_v1 set reference=${reference},authorization_url=${authorizationUrl},state='initialized' where payment_id=${metadata.paymentId} and state='prepared'`
      return Object.freeze({ ...current, reference, authorizationUrl, state: current.state === 'prepared' ? 'initialized' as const : current.state })
    })
  }

  async exactPayment(metadata: CustomerPluginPaymentMetadata): Promise<CustomerPluginPayment | null> {
    const result = await this.#db.unsafe<PaymentRow>(`select ${PAYMENT_COLUMNS} from fuma_customer_plugin_payments_v1 where payment_id=$1`, [metadata.paymentId])
    if (!result.rows[0]) return null
    const payment = mapPayment(result.rows[0])
    return same(payment.metadata, metadata) ? payment : null
  }

  async payment(authority: ReviewedCustomerPaymentPluginAuthority, paymentId: string): Promise<CustomerPluginPayment | null> {
    const scope = authority.merchantScope
    const result = await this.#db.unsafe<PaymentRow>(`
      select ${PAYMENT_COLUMNS} from fuma_customer_plugin_payments_v1
      where payment_id=$1 and platform_id=$2 and organization_id=$3 and workspace_id=$4 and site_id=$5
        and owner_key=$6 and owner_generation=$7 and installation_id=$8 and artifact_id=$9
        and content_hash_sha256=$10 and review_submission_id=$11 and review_decision_id=$12
        and review_signature_key_id=$13
    `, [paymentId,scope.platformId,scope.organizationId,scope.workspaceId,scope.siteId,scope.ownerKey,
      scope.ownerGeneration,authority.installationId,authority.artifactId,authority.contentHashSha256,
      authority.reviewSubmissionId,authority.reviewDecisionId,authority.reviewSignatureKeyId])
    return result.rows[0] ? mapPayment(result.rows[0]) : null
  }

  settle(metadata: CustomerPluginPaymentMetadata, transaction: VerifiedPaystackTransaction, settledAt: string): Promise<CustomerPaymentReceipt> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx.unsafe<PaymentRow>(`select ${PAYMENT_COLUMNS} from fuma_customer_plugin_payments_v1 where payment_id=$1 for update`, [metadata.paymentId])
      if (!selected.rows[0]) throw new CustomerPaymentError('verification', 'Plugin settlement obligation is unavailable.')
      const payment = mapPayment(selected.rows[0])
      if (!same(payment.metadata, metadata) || payment.reference !== transaction.reference) throw new CustomerPaymentError('verification', 'Plugin settlement obligation changed.')
      const receiptId = `plugin-receipt:${sha256(metadata.paymentId).slice(0,40)}`
      const receipt = parseCustomerPluginContract(CustomerPaymentReceiptSchema, {
        receiptId,paymentId:metadata.paymentId,purpose:metadata.purpose,amountMinor:metadata.amountMinor,currency:metadata.currency,
        providerReferenceSha256:sha256(transaction.reference),providerTransactionSha256:sha256(transaction.providerTransactionId),settledAt,
      }, 'Plugin payment receipt') as CustomerPaymentReceipt
      const duplicate = await tx<ReceiptRow>`
        select receipt_json from fuma_customer_plugin_receipts_v1
        where payment_id=${metadata.paymentId} or provider_transaction_sha256=${receipt.providerTransactionSha256} for update
      `
      if (duplicate.rows[0]) {
        const existing = mapReceipt(duplicate.rows[0])
        if (!same(existing, receipt)) throw new CustomerPaymentError('conflict', 'Provider transaction was already used by another plugin obligation.')
        return existing
      }
      await tx.unsafe(`insert into fuma_customer_plugin_receipts_v1 (receipt_id,payment_id,provider_reference_sha256,provider_transaction_sha256,receipt_json,settled_at) values ($1,$2,$3,$4,$5::text::jsonb,$6)`, [receipt.receiptId,receipt.paymentId,receipt.providerReferenceSha256,receipt.providerTransactionSha256,JSON.stringify(receipt),settledAt])
      await tx`update fuma_customer_plugin_payments_v1 set state='settled',settled_at=${settledAt} where payment_id=${metadata.paymentId} and state in ('initialized','settled')`
      return receipt
    })
  }

  async receipt(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPaymentReceipt | null> {
    const scope = authority.merchantScope
    const result = await this.#db.unsafe<ReceiptRow>(`
      select r.receipt_json from fuma_customer_plugin_receipts_v1 r
      join fuma_customer_plugin_payments_v1 p on p.payment_id=r.payment_id
      where r.receipt_id=$1 and p.platform_id=$2 and p.organization_id=$3 and p.workspace_id=$4
        and p.site_id=$5 and p.owner_key=$6 and p.owner_generation=$7 and p.installation_id=$8
        and p.artifact_id=$9 and p.content_hash_sha256=$10 and p.review_submission_id=$11
        and p.review_decision_id=$12 and p.review_signature_key_id=$13
    `, [receiptId,scope.platformId,scope.organizationId,scope.workspaceId,scope.siteId,scope.ownerKey,
      scope.ownerGeneration,authority.installationId,authority.artifactId,authority.contentHashSha256,
      authority.reviewSubmissionId,authority.reviewDecisionId,authority.reviewSignatureKeyId])
    return result.rows[0] ? mapReceipt(result.rows[0]) : null
  }

  prepareRefund(payment: CustomerPluginPayment, receipt: CustomerPaymentReceipt, requestId: string, reasonSha256: string, createdAt: string): Promise<CustomerPluginRefundRecord> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:customer-plugin-refund:${receipt.receiptId}`},0))`
      const selected = await tx<RefundRow>`select record_json from fuma_customer_plugin_refunds_v1 where receipt_id=${receipt.receiptId} for update`
      const refundId = `plugin-refund:${sha256(`${receipt.receiptId}:${requestId}`).slice(0,40)}`
      const candidate = parseCustomerPluginContract(CustomerPluginRefundRecordSchema, { refundId,receiptId:receipt.receiptId,paymentId:payment.metadata.paymentId,requestId,reasonSha256,amountMinor:receipt.amountMinor,currency:receipt.currency,providerRefundSha256:null,state:'prepared',createdAt,refundedAt:null }, 'Plugin refund record') as CustomerPluginRefundRecord
      if (selected.rows[0]) {
        const existing = mapRefund(selected.rows[0])
        if (existing.refundId !== refundId || existing.reasonSha256 !== reasonSha256 || existing.paymentId !== candidate.paymentId) throw new CustomerPaymentError('conflict', 'Plugin receipt already has another refund.')
        return existing
      }
      await tx.unsafe(`insert into fuma_customer_plugin_refunds_v1 (refund_id,receipt_id,payment_id,request_id,reason_sha256,amount_minor,currency,provider_refund_sha256,state,record_json,created_at,refunded_at) values ($1,$2,$3,$4,$5,$6,$7,null,'prepared',$8::text::jsonb,$9,null)`, [refundId,receipt.receiptId,payment.metadata.paymentId,requestId,reasonSha256,receipt.amountMinor,receipt.currency,JSON.stringify(candidate),createdAt])
      return candidate
    })
  }

  completeRefund(record: CustomerPluginRefundRecord, providerRefundSha256: string, refundedAt: string): Promise<CustomerPaymentRefund> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<RefundRow>`select record_json from fuma_customer_plugin_refunds_v1 where refund_id=${record.refundId} for update`
      if (!selected.rows[0]) throw new CustomerPaymentError('not-found', 'Plugin refund claim is unavailable.')
      const current = mapRefund(selected.rows[0])
      if (current.state === 'refunded') {
        if (current.providerRefundSha256 !== providerRefundSha256) throw new CustomerPaymentError('conflict', 'Plugin refund provider identity changed.')
        return publicRefund(current)
      }
      if (!same(current, record)) throw new CustomerPaymentError('conflict', 'Plugin refund claim changed.')
      const completed = parseCustomerPluginContract(CustomerPluginRefundRecordSchema, { ...record,providerRefundSha256,state:'refunded',refundedAt }, 'Completed plugin refund') as CustomerPluginRefundRecord
      await tx.unsafe(`update fuma_customer_plugin_refunds_v1 set provider_refund_sha256=$1,state='refunded',record_json=$2::text::jsonb,refunded_at=$3 where refund_id=$4 and state='prepared'`, [providerRefundSha256,JSON.stringify(completed),refundedAt,record.refundId])
      await tx`update fuma_customer_plugin_payments_v1 set state='refunded',refunded_at=${refundedAt} where payment_id=${record.paymentId} and state='settled'`
      return publicRefund(completed)
    })
  }

  async refund(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPluginRefundRecord | null> {
    const scope = authority.merchantScope
    const result = await this.#db.unsafe<RefundRow>(`
      select f.record_json from fuma_customer_plugin_refunds_v1 f
      join fuma_customer_plugin_payments_v1 p on p.payment_id=f.payment_id
      where f.receipt_id=$1 and f.state='refunded' and p.platform_id=$2 and p.organization_id=$3
        and p.workspace_id=$4 and p.site_id=$5 and p.owner_key=$6 and p.owner_generation=$7
        and p.installation_id=$8 and p.artifact_id=$9 and p.content_hash_sha256=$10
        and p.review_submission_id=$11 and p.review_decision_id=$12 and p.review_signature_key_id=$13
    `, [receiptId,scope.platformId,scope.organizationId,scope.workspaceId,scope.siteId,scope.ownerKey,
      scope.ownerGeneration,authority.installationId,authority.artifactId,authority.contentHashSha256,
      authority.reviewSubmissionId,authority.reviewDecisionId,authority.reviewSignatureKeyId])
    return result.rows[0] ? mapRefund(result.rows[0]) : null
  }
}
