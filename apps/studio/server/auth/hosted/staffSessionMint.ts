/**
 * Staff session minting, shared by every path that completes a sign-in.
 *
 * The app host recognises exactly one staff credential: an HMAC-signed cookie
 * naming a row in `auth_sessions`. Two flows arrive at that point — the central
 * Google handoff and the marketing sign-in handoff — and both must mint the same
 * thing, or a visitor who authenticated on one path is met by a sign-in form on
 * the app. Keeping the logic here means there is one implementation rather than
 * two that can drift.
 *
 * Authority is re-established from the database at mint time: the identity
 * session must still be live, the account must not be banned, and it must carry a
 * staff profile — the protected owner being the single exception, whose profile is
 * created if it is missing.
 */
import type { DbClient } from '../../db/client'
import { sessionTokenAtRestValue } from './sessionTokenAdapter'

export const STAFF_SESSION_TTL_MS = 7 * 24 * 60 * 60_000

/** Same signature the app host verifies on the staff cookie. */
async function signedCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return `${value}.${Buffer.from(signature).toString('base64')}`
}

type StaffAuthorityRow = Readonly<{
  user_id: string
  email: string
  banned: boolean | null
  ban_expires: string | Date | null
  session_valid: boolean
  staff_profile: boolean
}>

export type StaffSessionMint = Readonly<{
  /** Signed value for the staff cookie. */
  cookieValue: string
  /** Email of the account the session belongs to. */
  email: string
  expiresAt: Date
}>

export type MintStaffSessionInput = Readonly<{
  db: DbClient
  userId: string
  identitySessionId: string
  protectedOwnerEmail: string
  staffAuthSecret: string
  ipAddress: string | null
  userAgent: string | null
  now: Date
}>

/**
 * Mints an app-host staff session, or returns null when the request has no
 * standing to receive one. Null is the fail-closed answer: callers must not
 * distinguish why.
 */
export async function mintStaffSession(
  input: MintStaffSessionInput,
): Promise<StaffSessionMint | null> {
  const ownerEmail = input.protectedOwnerEmail.trim().toLowerCase()
  const at = input.now
  const expiresAt = new Date(at.getTime() + STAFF_SESSION_TTL_MS)
  const rawSessionToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const storedSessionToken = await sessionTokenAtRestValue(rawSessionToken)

  const email = await input.db.transaction(async (db) => {
    const authority = await db<StaffAuthorityRow>`
      select account.id user_id,account.email,account.banned,account.ban_expires,
        exists(
          select 1 from auth_sessions identity
          where identity.id=${input.identitySessionId}
            and identity.user_id=account.id
            and identity.expires_at>${at.toISOString()}
        ) session_valid,
        exists(select 1 from auth_staff_profiles profile where profile.user_id=account.id) staff_profile
      from auth_users account where account.id=${input.userId}
    `
    const row = authority.rows[0]
    if (!row) return null
    const owner = row.email.trim().toLowerCase() === ownerEmail
    const banned = row.banned === true
      && (row.ban_expires === null || Date.parse(String(row.ban_expires)) > at.getTime())
    if (!row.session_valid || banned || (!owner && !row.staff_profile)) return null
    if (owner && !row.staff_profile) {
      await db`
        insert into auth_staff_profiles(user_id,source,created_at,updated_at)
        values(${row.user_id},${'native'},${at.toISOString()},${at.toISOString()})
        on conflict(user_id) do nothing
      `
    }
    await db`
      insert into auth_sessions(
        id,expires_at,token,created_at,updated_at,ip_address,user_agent,user_id,
        active_organization_id,impersonated_by
      )
      values(
        ${crypto.randomUUID()},${expiresAt.toISOString()},${storedSessionToken},
        ${at.toISOString()},${at.toISOString()},${input.ipAddress},${input.userAgent},
        ${row.user_id},${null},${null}
      )
    `
    return row.email
  })

  if (!email) return null
  return Object.freeze({
    cookieValue: await signedCookieValue(rawSessionToken, input.staffAuthSecret),
    email,
    expiresAt,
  })
}

/** `Set-Cookie` value for a minted staff session. */
export function staffSessionCookie(
  name: string,
  value: string,
  secureCookies: boolean,
): string {
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STAFF_SESSION_TTL_MS / 1000)}`
  return `${name}=${encodeURIComponent(value)}; ${attributes}${secureCookies ? '; Secure' : ''}`
}
