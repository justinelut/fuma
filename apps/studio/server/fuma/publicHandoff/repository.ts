import type { PublicHandoffRequest } from '@fuma/public-contracts'
import type { DbClient } from '../../db/client'
import {
  APP_HANDOFF_AUDIENCE,
  APP_HANDOFF_CALLBACK,
  StoredAppAuthCodeSchema,
  StoredPublicIntentSchema,
  parseHandoffValue,
  type StoredAppAuthCode,
  type StoredPublicIntent,
} from './contracts'

interface IntentRow {
  correlation: string
  request_json: unknown
  issued_at: string | Date
  expires_at: string | Date
  consumed_at: string | Date | null
  cancelled_at: string | Date | null
}

interface CodeRow extends IntentRow {
  state: string
  user_id: string
  identity_session_id: string
  code_issued_at: string | Date
  code_expires_at: string | Date
  code_consumed_at: string | Date | null
  code_cancelled_at: string | Date | null
}

interface SessionRow {
  user_id: string
  identity_session_id: string
  created_at: string | Date
  expires_at: string | Date
  revoked_at: string | Date | null
}

export type IssuedPublicIntent = Readonly<{ intent: string; correlation: string; expiresAt: string }>
export type IssuedAppAuthCode = Readonly<{ code: string; state: string; expiresAt: string }>
export type IssuedAppSession = Readonly<{ token: string; userId: string; identitySessionId: string; expiresAt: string }>

export class PublicHandoffStoreError extends Error {
  readonly code: 'invalid' | 'expired' | 'replayed' | 'cancelled'
  constructor(code: PublicHandoffStoreError['code']) {
    super(`Public handoff ${code}.`)
    this.name = 'PublicHandoffStoreError'
    this.code = code
  }
}

export interface PublicHandoffRepository {
  issueIntent(input: Readonly<{ tokenHash: string; token: string; correlation: string; request: PublicHandoffRequest; issuedAt: string; expiresAt: string }>): Promise<IssuedPublicIntent>
  readIntent(input: Readonly<{ tokenHash: string; correlation: string; now: string }>): Promise<StoredPublicIntent>
  authorizeIntent(input: Readonly<{ tokenHash: string; correlation: string; codeHash: string; code: string; state: string; now: string; expiresAt: string; userId: string; identitySessionId: string }>): Promise<IssuedAppAuthCode>
  inspectCode(input: Readonly<{ codeHash: string; state: string; now: string }>): Promise<StoredAppAuthCode>
  consumeCode(input: Readonly<{ codeHash: string; state: string; now: string }>): Promise<StoredAppAuthCode>
  cancelIntent(input: Readonly<{ tokenHash: string; correlation: string; now: string }>): Promise<void>
  cancelCode(input: Readonly<{ codeHash: string; state: string; now: string }>): Promise<void>
  createSession(input: Readonly<{ tokenHash: string; token: string; userId: string; identitySessionId: string; createdAt: string; expiresAt: string }>): Promise<IssuedAppSession>
  resolveSession(input: Readonly<{ tokenHash: string; now: string }>): Promise<IssuedAppSession | null>
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new PublicHandoffStoreError('invalid')
  return date.toISOString()
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { throw new PublicHandoffStoreError('invalid') }
}

function storedIntent(row: IntentRow): StoredPublicIntent {
  return parseHandoffValue(StoredPublicIntentSchema, {
    version: 1,
    recordKind: 'public-intent',
    audience: APP_HANDOFF_AUDIENCE,
    callback: APP_HANDOFF_CALLBACK,
    request: decoded(row.request_json),
    correlation: row.correlation,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
  }, 'Stored public intent')
}

function storedCode(row: CodeRow): StoredAppAuthCode {
  return parseHandoffValue(StoredAppAuthCodeSchema, {
    version: 1,
    recordKind: 'app-auth-code',
    audience: APP_HANDOFF_AUDIENCE,
    callback: APP_HANDOFF_CALLBACK,
    userId: row.user_id,
    identitySessionId: row.identity_session_id,
    intent: storedIntent(row),
    state: row.state,
    issuedAt: iso(row.code_issued_at),
    expiresAt: iso(row.code_expires_at),
  }, 'Stored app auth code')
}

function assertIntentUsable(row: IntentRow | undefined, correlation: string, now: string): asserts row is IntentRow {
  if (!row || row.correlation !== correlation) throw new PublicHandoffStoreError('invalid')
  if (row.cancelled_at !== null) throw new PublicHandoffStoreError('cancelled')
  if (row.consumed_at !== null) throw new PublicHandoffStoreError('replayed')
  if (Date.parse(iso(row.expires_at)) <= Date.parse(now)) throw new PublicHandoffStoreError('expired')
}

function assertCodeUsable(row: CodeRow | undefined, state: string, now: string): asserts row is CodeRow {
  if (!row || row.state !== state) throw new PublicHandoffStoreError('invalid')
  if (row.code_cancelled_at !== null || row.cancelled_at !== null) throw new PublicHandoffStoreError('cancelled')
  if (row.code_consumed_at !== null) throw new PublicHandoffStoreError('replayed')
  if (Date.parse(iso(row.code_expires_at)) <= Date.parse(now)) throw new PublicHandoffStoreError('expired')
}

export class PostgresPublicHandoffRepository implements PublicHandoffRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Public handoff authority requires PostgreSQL.')
    this.#db = db
  }

  issueIntent(input: Parameters<PublicHandoffRepository['issueIntent']>[0]): Promise<IssuedPublicIntent> {
    return this.#db.transaction(async (tx) => {
      const result = await tx`
        insert into fuma_public_handoff_intents_v1 (
          token_hash_sha256, audience, callback_path, correlation, request_json, issued_at, expires_at
        ) values (
          ${input.tokenHash}, ${APP_HANDOFF_AUDIENCE}, ${APP_HANDOFF_CALLBACK}, ${input.correlation},
          ${JSON.stringify(input.request)}::text::jsonb, ${input.issuedAt}, ${input.expiresAt}
        ) on conflict do nothing
      `
      if (result.rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      await tx`
        insert into fuma_public_handoff_events_v1 (event_id,intent_token_hash_sha256,code_hash_sha256,user_id,event_kind,source,occurred_at)
        values (${'issued:' + input.tokenHash},${input.tokenHash},${null},${null},'issued',${input.request.source},${input.issuedAt})
      `
      return Object.freeze({ intent: input.token, correlation: input.correlation, expiresAt: input.expiresAt })
    })
  }

  async readIntent(input: Parameters<PublicHandoffRepository['readIntent']>[0]): Promise<StoredPublicIntent> {
    const selected = await this.#db<IntentRow>`
      select correlation, request_json, issued_at, expires_at, consumed_at, cancelled_at
      from fuma_public_handoff_intents_v1
      where token_hash_sha256=${input.tokenHash} and audience=${APP_HANDOFF_AUDIENCE} and callback_path=${APP_HANDOFF_CALLBACK}
    `
    if (selected.rows.length !== 1) throw new PublicHandoffStoreError('invalid')
    assertIntentUsable(selected.rows[0], input.correlation, input.now)
    return storedIntent(selected.rows[0]!)
  }

  authorizeIntent(input: Parameters<PublicHandoffRepository['authorizeIntent']>[0]): Promise<IssuedAppAuthCode> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<IntentRow>`
        select correlation, request_json, issued_at, expires_at, consumed_at, cancelled_at
        from fuma_public_handoff_intents_v1
        where token_hash_sha256=${input.tokenHash} and audience=${APP_HANDOFF_AUDIENCE} and callback_path=${APP_HANDOFF_CALLBACK}
        for update
      `
      assertIntentUsable(selected.rows[0], input.correlation, input.now)
      const inserted = await tx`
        insert into fuma_app_handoff_codes_v1 (
          code_hash_sha256, intent_token_hash_sha256, audience, callback_path, state, user_id, identity_session_id, issued_at, expires_at
        ) select
          ${input.codeHash}, ${input.tokenHash}, ${APP_HANDOFF_AUDIENCE}, ${APP_HANDOFF_CALLBACK},
          ${input.state}, identity_session.user_id, identity_session.id, ${input.now}, ${input.expiresAt}
        from auth_sessions identity_session
        join auth_users identity_user on identity_user.id=identity_session.user_id
        where identity_session.id=${input.identitySessionId} and identity_session.user_id=${input.userId}
          and identity_session.expires_at>${input.now}
          and (identity_user.banned is not true or (identity_user.ban_expires is not null and identity_user.ban_expires<=${input.now}))
        on conflict do nothing
      `
      if (inserted.rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      const consumed = await tx`
        update fuma_public_handoff_intents_v1 set consumed_at=${input.now}
        where token_hash_sha256=${input.tokenHash} and consumed_at is null and cancelled_at is null
      `
      if (consumed.rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      await tx`
        insert into fuma_public_handoff_events_v1 (event_id,intent_token_hash_sha256,code_hash_sha256,user_id,event_kind,source,occurred_at)
        values (${'authorized:' + input.codeHash},${input.tokenHash},${input.codeHash},${input.userId},'authorized',${null},${input.now})
      `
      return Object.freeze({ code: input.code, state: input.state, expiresAt: input.expiresAt })
    })
  }

  async inspectCode(input: Parameters<PublicHandoffRepository['inspectCode']>[0]): Promise<StoredAppAuthCode> {
    const selected = await this.#db<CodeRow>`
      select i.correlation, i.request_json, i.issued_at, i.expires_at, i.consumed_at, i.cancelled_at,
        c.state, c.user_id, c.identity_session_id, c.issued_at as code_issued_at, c.expires_at as code_expires_at,
        c.consumed_at as code_consumed_at, c.cancelled_at as code_cancelled_at
      from fuma_app_handoff_codes_v1 c
      join fuma_public_handoff_intents_v1 i on i.token_hash_sha256=c.intent_token_hash_sha256
      where c.code_hash_sha256=${input.codeHash} and c.audience=${APP_HANDOFF_AUDIENCE} and c.callback_path=${APP_HANDOFF_CALLBACK}
    `
    assertCodeUsable(selected.rows[0], input.state, input.now)
    return storedCode(selected.rows[0])
  }

  consumeCode(input: Parameters<PublicHandoffRepository['consumeCode']>[0]): Promise<StoredAppAuthCode> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<CodeRow>`
        select i.correlation, i.request_json, i.issued_at, i.expires_at, i.consumed_at, i.cancelled_at,
          c.state, c.user_id, c.identity_session_id, c.issued_at as code_issued_at, c.expires_at as code_expires_at,
          c.consumed_at as code_consumed_at, c.cancelled_at as code_cancelled_at
        from fuma_app_handoff_codes_v1 c
        join fuma_public_handoff_intents_v1 i on i.token_hash_sha256=c.intent_token_hash_sha256
        where c.code_hash_sha256=${input.codeHash} and c.audience=${APP_HANDOFF_AUDIENCE} and c.callback_path=${APP_HANDOFF_CALLBACK}
        for update of c
      `
      assertCodeUsable(selected.rows[0], input.state, input.now)
      const consumed = await tx`
        update fuma_app_handoff_codes_v1 set consumed_at=${input.now}
        where code_hash_sha256=${input.codeHash} and consumed_at is null and cancelled_at is null
      `
      if (consumed.rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      await tx`
        insert into fuma_public_handoff_events_v1 (event_id,intent_token_hash_sha256,code_hash_sha256,user_id,event_kind,source,occurred_at)
        values (${'exchanged:' + input.codeHash},${null},${input.codeHash},${selected.rows[0].user_id},'exchanged',${null},${input.now})
      `
      return storedCode(selected.rows[0])
    })
  }

  cancelIntent(input: Parameters<PublicHandoffRepository['cancelIntent']>[0]): Promise<void> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<IntentRow>`select correlation,request_json,issued_at,expires_at,consumed_at,cancelled_at from fuma_public_handoff_intents_v1 where token_hash_sha256=${input.tokenHash} for update`
      assertIntentUsable(selected.rows[0], input.correlation, input.now)
      if ((await tx`update fuma_public_handoff_intents_v1 set cancelled_at=${input.now} where token_hash_sha256=${input.tokenHash} and consumed_at is null and cancelled_at is null`).rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      await tx`insert into fuma_public_handoff_events_v1 (event_id,intent_token_hash_sha256,code_hash_sha256,user_id,event_kind,source,occurred_at) values (${'cancelled:intent:' + input.tokenHash},${input.tokenHash},${null},${null},'cancelled',${null},${input.now})`
    })
  }

  cancelCode(input: Parameters<PublicHandoffRepository['cancelCode']>[0]): Promise<void> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<CodeRow>`
        select i.correlation,i.request_json,i.issued_at,i.expires_at,i.consumed_at,i.cancelled_at,c.state,c.user_id,c.identity_session_id,c.issued_at as code_issued_at,c.expires_at as code_expires_at,c.consumed_at as code_consumed_at,c.cancelled_at as code_cancelled_at
        from fuma_app_handoff_codes_v1 c join fuma_public_handoff_intents_v1 i on i.token_hash_sha256=c.intent_token_hash_sha256 where c.code_hash_sha256=${input.codeHash} for update of c
      `
      assertCodeUsable(selected.rows[0], input.state, input.now)
      if ((await tx`update fuma_app_handoff_codes_v1 set cancelled_at=${input.now} where code_hash_sha256=${input.codeHash} and consumed_at is null and cancelled_at is null`).rowCount !== 1) throw new PublicHandoffStoreError('replayed')
      await tx`insert into fuma_public_handoff_events_v1 (event_id,intent_token_hash_sha256,code_hash_sha256,user_id,event_kind,source,occurred_at) values (${'cancelled:code:' + input.codeHash},${null},${input.codeHash},${selected.rows[0].user_id},'cancelled',${null},${input.now})`
    })
  }

  async createSession(input: Parameters<PublicHandoffRepository['createSession']>[0]): Promise<IssuedAppSession> {
    const inserted = await this.#db<{ expires_at: string | Date }>`
      insert into fuma_app_handoff_sessions_v1 (token_hash_sha256,audience,user_id,identity_session_id,created_at,expires_at)
      select ${input.tokenHash},${APP_HANDOFF_AUDIENCE},identity_session.user_id,identity_session.id,${input.createdAt},least(${input.expiresAt}::timestamptz,identity_session.expires_at)
      from auth_sessions identity_session
      join auth_users identity_user on identity_user.id=identity_session.user_id
      where identity_session.id=${input.identitySessionId} and identity_session.user_id=${input.userId}
        and identity_session.expires_at>${input.createdAt}
        and (identity_user.banned is not true or (identity_user.ban_expires is not null and identity_user.ban_expires<=${input.createdAt}))
      on conflict do nothing
      returning expires_at
    `
    if (inserted.rowCount !== 1 || !inserted.rows[0]) throw new PublicHandoffStoreError('invalid')
    return Object.freeze({
      token: input.token,
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      expiresAt: iso(inserted.rows[0].expires_at),
    })
  }

  async resolveSession(input: Parameters<PublicHandoffRepository['resolveSession']>[0]): Promise<IssuedAppSession | null> {
    const { rows } = await this.#db<SessionRow>`
      select relying.user_id,relying.identity_session_id,relying.created_at,
        least(relying.expires_at,identity_session.expires_at) expires_at,relying.revoked_at
      from fuma_app_handoff_sessions_v1 relying
      join auth_sessions identity_session on identity_session.id=relying.identity_session_id and identity_session.user_id=relying.user_id
      join auth_users identity_user on identity_user.id=relying.user_id
      where relying.token_hash_sha256=${input.tokenHash} and relying.audience=${APP_HANDOFF_AUDIENCE}
        and identity_session.expires_at>${input.now}
        and (identity_user.banned is not true or (identity_user.ban_expires is not null and identity_user.ban_expires<=${input.now}))
    `
    const row = rows[0]
    if (!row || row.revoked_at !== null || Date.parse(iso(row.expires_at)) <= Date.parse(input.now)) return null
    return Object.freeze({ token: '', userId: row.user_id, identitySessionId: row.identity_session_id, expiresAt: iso(row.expires_at) })
  }
}
