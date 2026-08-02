import { createHash } from 'node:crypto'

import { ContactRequestSchema, type ContactRequest } from '@fuma/public-contracts'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'

const ROUTING_LEASE_MS = 30_000
const MAXIMUM_RETENTION_DAYS = 400
const DAY_MS = 24 * 60 * 60 * 1_000

const TimestampSchema = Type.String({
  minLength: 20,
  maxLength: 20,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
})
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const ContactKindSchema = Type.Union([
  Type.Literal('general'),
  Type.Literal('security'),
  Type.Literal('privacy'),
  Type.Literal('abuse'),
  Type.Literal('expert_inquiry'),
])

export const PublicContactRoutingReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  disposition: Type.Union([Type.Literal('accepted'), Type.Literal('replayed')]),
  receiptId: Type.String({ minLength: 16, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]+$' }),
  replayToken: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  requestSha256: HashSchema,
  routedAs: ContactKindSchema,
  acceptedAt: TimestampSchema,
  deleteAfter: TimestampSchema,
  retentionPolicyVersion: Type.String({ minLength: 1, maxLength: 80, pattern: '^[0-9A-Za-z._-]+$' }),
  auditProjection: Type.Literal('metadata-only'),
}, { additionalProperties: false })

export const PublicContactRoutingResponseSchema = Type.Object({
  outcome: Type.Literal('accepted'),
  receipt: PublicContactRoutingReceiptSchema,
}, { additionalProperties: false })

export type PublicContactRoutingReceipt = Readonly<Static<typeof PublicContactRoutingReceiptSchema>>
export type PublicContactRoutingResult =
  | Readonly<{ outcome: 'accepted'; receipt: PublicContactRoutingReceipt }>
  | Readonly<{ outcome: 'conflict' }>
  | Readonly<{ outcome: 'busy'; retryAfterSeconds: number }>
  | Readonly<{ outcome: 'unavailable' }>

export interface PublicContactSink {
  accept(value: ContactRequest): Promise<boolean>
}

export interface PublicContactRoutingAuthority {
  route(value: ContactRequest): Promise<PublicContactRoutingResult>
}

export type PublicContactSinkConfig = Readonly<{
  url: string
  token: string
  timeoutMs: number
  retentionDays: number
  retentionPolicyVersion: string
}>

type ContactClaim = Readonly<{
  replayToken: string
  requestSha256: string
  routedAs: ContactRequest['kind']
  receiptId: string
  leaseOwner: string
  leaseUntil: string
  createdAt: string
}>

type ContactClaimResult =
  | Readonly<{ outcome: 'acquired' }>
  | Readonly<{ outcome: 'replay'; receipt: PublicContactRoutingReceipt }>
  | Readonly<{ outcome: 'conflict' }>
  | Readonly<{ outcome: 'busy'; retryAfterSeconds: number }>

export interface PublicContactReceiptRepository {
  claim(value: ContactClaim): Promise<ContactClaimResult>
  complete(value: Readonly<{ claim: ContactClaim; receipt: PublicContactRoutingReceipt }>): Promise<boolean>
  release(value: Readonly<{ replayToken: string; leaseOwner: string; releasedAt: string }>): Promise<void>
}

function optional(env: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = env[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Invalid ${key}.`)
  return value.trim()
}

export function readPublicContactSinkConfig(env: Readonly<Record<string, unknown>> = process.env): PublicContactSinkConfig | null {
  const rawUrl = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_URL')
  const token = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_TOKEN')
  const rawRetentionDays = optional(env, 'FUMA_PUBLIC_CONTACT_RETENTION_DAYS')
  const retentionPolicyVersion = optional(env, 'FUMA_PUBLIC_CONTACT_RETENTION_POLICY_VERSION')
  const configured = [rawUrl, token, rawRetentionDays, retentionPolicyVersion].filter((value) => value !== undefined).length
  if (configured === 0) return null
  if (configured !== 4 || !token || token.length < 32 || token.length > 512) {
    throw new TypeError('Public contact routing configuration is incomplete.')
  }
  const url = new URL(rawUrl!)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname === '/') {
    throw new TypeError('Public contact routing URL must be a dedicated HTTPS endpoint.')
  }
  const rawTimeout = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_TIMEOUT_MS')
  const timeoutMs = rawTimeout === undefined ? 3_000 : Number(rawTimeout)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new TypeError('Public contact routing timeout is invalid.')
  const retentionDays = Number(rawRetentionDays)
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > MAXIMUM_RETENTION_DAYS) {
    throw new TypeError('Public contact retention period is invalid.')
  }
  if (!/^[0-9A-Za-z._-]{1,80}$/.test(retentionPolicyVersion!)) {
    throw new TypeError('Public contact retention policy version is invalid.')
  }
  return Object.freeze({ url: url.toString(), token, timeoutMs, retentionDays, retentionPolicyVersion: retentionPolicyVersion! })
}

export class ConfiguredPublicContactSink implements PublicContactSink {
  readonly #config: PublicContactSinkConfig
  readonly #fetch: typeof fetch
  constructor(config: PublicContactSinkConfig, fetchImpl: typeof fetch = fetch) { this.#config = config; this.#fetch = fetchImpl }

  async accept(value: ContactRequest): Promise<boolean> {
    if (!safeParseValue(ContactRequestSchema, value).ok) return false
    try {
      const response = await this.#fetch(this.#config.url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#config.token}`,
          'content-type': 'application/json; charset=utf-8',
          'x-fuma-idempotency-key': value.replayToken,
          'x-fuma-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify(value),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      })
      return response.status === 202
    } catch {
      return false
    }
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function publicContactRequestSha256(value: ContactRequest): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function timestamp(value: number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function replayReceipt(receipt: PublicContactRoutingReceipt): PublicContactRoutingReceipt {
  return Object.freeze({ ...receipt, disposition: 'replayed' })
}

export class DurablePublicContactRoutingAuthority implements PublicContactRoutingAuthority {
  readonly #repository: PublicContactReceiptRepository
  readonly #sink: PublicContactSink
  readonly #retentionDays: number
  readonly #retentionPolicyVersion: string
  readonly #now: () => number

  constructor(input: Readonly<{
    repository: PublicContactReceiptRepository
    sink: PublicContactSink
    retentionDays: number
    retentionPolicyVersion: string
    now?: () => number
  }>) {
    if (!Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > MAXIMUM_RETENTION_DAYS) {
      throw new TypeError('Contact routing retention days are invalid.')
    }
    if (!/^[0-9A-Za-z._-]{1,80}$/.test(input.retentionPolicyVersion)) {
      throw new TypeError('Contact routing retention policy version is invalid.')
    }
    this.#repository = input.repository
    this.#sink = input.sink
    this.#retentionDays = input.retentionDays
    this.#retentionPolicyVersion = input.retentionPolicyVersion
    this.#now = input.now ?? Date.now
  }

  async route(value: ContactRequest): Promise<PublicContactRoutingResult> {
    const parsed = safeParseValue(ContactRequestSchema, value)
    if (!parsed.ok) return Object.freeze({ outcome: 'unavailable' })
    const current = this.#now()
    const claim: ContactClaim = Object.freeze({
      replayToken: parsed.value.replayToken,
      requestSha256: publicContactRequestSha256(parsed.value),
      routedAs: parsed.value.kind,
      receiptId: `contact:${crypto.randomUUID()}`,
      leaseOwner: crypto.randomUUID(),
      leaseUntil: timestamp(current + ROUTING_LEASE_MS),
      createdAt: timestamp(current),
    })
    let claimed: ContactClaimResult
    try { claimed = await this.#repository.claim(claim) } catch { return Object.freeze({ outcome: 'unavailable' }) }
    if (claimed.outcome === 'conflict') return claimed
    if (claimed.outcome === 'busy') return claimed
    if (claimed.outcome === 'replay') return Object.freeze({ outcome: 'accepted', receipt: replayReceipt(claimed.receipt) })

    if (!await this.#sink.accept(parsed.value)) {
      try { await this.#repository.release({ replayToken: claim.replayToken, leaseOwner: claim.leaseOwner, releasedAt: timestamp(this.#now()) }) } catch { /* lease expiry remains the recovery fence */ }
      return Object.freeze({ outcome: 'unavailable' })
    }

    const acceptedAtMs = this.#now()
    const receipt: PublicContactRoutingReceipt = Object.freeze({
      schemaVersion: 1,
      disposition: 'accepted',
      receiptId: claim.receiptId,
      replayToken: claim.replayToken,
      requestSha256: claim.requestSha256,
      routedAs: claim.routedAs,
      acceptedAt: timestamp(acceptedAtMs),
      deleteAfter: timestamp(acceptedAtMs + this.#retentionDays * DAY_MS),
      retentionPolicyVersion: this.#retentionPolicyVersion,
      auditProjection: 'metadata-only',
    })
    if (!safeParseValue(PublicContactRoutingReceiptSchema, receipt).ok) return Object.freeze({ outcome: 'unavailable' })
    try {
      if (await this.#repository.complete({ claim, receipt })) return Object.freeze({ outcome: 'accepted', receipt })
      const raced = await this.#repository.claim({ ...claim, leaseOwner: crypto.randomUUID() })
      if (raced.outcome === 'replay') return Object.freeze({ outcome: 'accepted', receipt: replayReceipt(raced.receipt) })
    } catch { /* fail closed below */ }
    return Object.freeze({ outcome: 'unavailable' })
  }
}

type ContactReceiptRow = Readonly<{
  replay_token: string
  request_sha256: string
  routed_as: string
  receipt_id: string
  state: string
  accepted_at: string | Date | null
  delete_after: string | Date | null
  retention_policy_version: string | null
  lease_owner: string
  lease_expires_at: string | Date
}>

function iso(value: string | Date): string {
  return timestamp(new Date(value).getTime())
}

function rowReceipt(row: ContactReceiptRow): PublicContactRoutingReceipt | null {
  if (row.state !== 'accepted' || row.accepted_at === null || row.delete_after === null || row.retention_policy_version === null) return null
  const candidate = {
    schemaVersion: 1,
    disposition: 'accepted',
    receiptId: row.receipt_id,
    replayToken: row.replay_token,
    requestSha256: row.request_sha256,
    routedAs: row.routed_as,
    acceptedAt: iso(row.accepted_at),
    deleteAfter: iso(row.delete_after),
    retentionPolicyVersion: row.retention_policy_version,
    auditProjection: 'metadata-only',
  }
  const parsed = safeParseValue(PublicContactRoutingReceiptSchema, candidate)
  return parsed.ok ? Object.freeze(parsed.value) : null
}

/**
 * PostgreSQL adapter for the WEB-014 metadata-only receipt table. The table is
 * intentionally migration-owned; this adapter never creates schema at runtime.
 */
export class PostgresPublicContactReceiptRepository implements PublicContactReceiptRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted contact routing receipts require PostgreSQL authority.')
    this.#db = db
  }

  async claim(value: ContactClaim): Promise<ContactClaimResult> {
    return await this.#db.transaction(async (tx) => {
      const inserted = await tx.unsafe<ContactReceiptRow>(`
        insert into fuma_public_contact_routing_receipts_v2 (
          replay_token,request_sha256,routed_as,receipt_id,state,accepted_at,delete_after,
          retention_policy_version,lease_owner,lease_expires_at,created_at,updated_at
        ) values ($1,$2,$3,$4,'routing',null,null,null,$5,$6,$7,$7)
        on conflict (replay_token) do nothing returning *
      `, [value.replayToken, value.requestSha256, value.routedAs, value.receiptId, value.leaseOwner, value.leaseUntil, value.createdAt])
      if (inserted.rows.length === 1) return Object.freeze({ outcome: 'acquired' as const })
      const existing = await tx.unsafe<ContactReceiptRow>(
        'select * from fuma_public_contact_routing_receipts_v2 where replay_token=$1 for update',
        [value.replayToken],
      )
      const row = existing.rows[0]
      if (!row || row.request_sha256 !== value.requestSha256 || row.routed_as !== value.routedAs) {
        return Object.freeze({ outcome: 'conflict' as const })
      }
      const receipt = rowReceipt(row)
      if (receipt) return Object.freeze({ outcome: 'replay' as const, receipt })
      const leaseUntil = new Date(row.lease_expires_at).getTime()
      const now = new Date(value.createdAt).getTime()
      if (Number.isFinite(leaseUntil) && leaseUntil > now) {
        return Object.freeze({ outcome: 'busy' as const, retryAfterSeconds: Math.max(1, Math.ceil((leaseUntil - now) / 1_000)) })
      }
      const claimed = await tx.unsafe(`
        update fuma_public_contact_routing_receipts_v2
        set lease_owner=$1,lease_expires_at=$2,updated_at=$3
        where replay_token=$4 and state='routing'
      `, [value.leaseOwner, value.leaseUntil, value.createdAt, value.replayToken])
      return claimed.rowCount === 1
        ? Object.freeze({ outcome: 'acquired' as const })
        : Object.freeze({ outcome: 'busy' as const, retryAfterSeconds: 1 })
    })
  }

  async complete(value: Readonly<{ claim: ContactClaim; receipt: PublicContactRoutingReceipt }>): Promise<boolean> {
    const result = await this.#db.unsafe(`
      update fuma_public_contact_routing_receipts_v2
      set state='accepted',accepted_at=$1,delete_after=$2,retention_policy_version=$3,updated_at=$1
      where replay_token=$4 and request_sha256=$5 and routed_as=$6 and receipt_id=$7
        and state='routing' and lease_owner=$8
    `, [value.receipt.acceptedAt, value.receipt.deleteAfter, value.receipt.retentionPolicyVersion,
      value.claim.replayToken, value.claim.requestSha256, value.claim.routedAs, value.claim.receiptId, value.claim.leaseOwner])
    return result.rowCount === 1
  }

  async release(value: Readonly<{ replayToken: string; leaseOwner: string; releasedAt: string }>): Promise<void> {
    await this.#db.unsafe(`
      update fuma_public_contact_routing_receipts_v2 set lease_expires_at=$1,updated_at=$1
      where replay_token=$2 and state='routing' and lease_owner=$3
    `, [value.releasedAt, value.replayToken, value.leaseOwner])
  }
}
