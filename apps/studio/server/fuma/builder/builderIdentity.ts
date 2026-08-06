/**
 * Hosted builder identity bridge.
 *
 * The hosted product owns platform concerns — organizations, workspaces,
 * domains, billing, publication content. Site design is not reimplemented
 * there: staff are handed the Instatic builder itself, rendered as the only
 * surface in the viewport.
 *
 * The builder is the pre-existing self-hosted admin application, and every
 * CMS endpoint it calls authenticates through `users` + `roles`. A hosted
 * staff member authenticates through Better Auth and has no `users` row, so
 * entering the builder requires a durable binding between the two identities.
 *
 * This module owns that binding and nothing else:
 *
 *  - the hosted staff session is already verified by the caller;
 *  - a CMS identity is provisioned once, idempotently, and linked through
 *    `auth_legacy_identity_links` — the same table the legacy backfill uses,
 *    in the opposite direction;
 *  - the provisioned row carries an unusable password so the CMS credential
 *    path can never authenticate it, and the hosted boundary keeps rejecting
 *    the legacy auth endpoints regardless;
 *  - the CMS role is derived from the site permissions the hosted resolver
 *    already granted, never from client input.
 */
import { randomBytes } from 'node:crypto'
import type { DbClient } from '../../db/client'
import { hashPassword } from '../../auth/tokens'
import { findUserById, toPublicUser } from '../../repositories/users'
import type { AuthUser } from '../../repositories/users'

export const BUILDER_SESSION_PATH = '/api/fuma/builder-session'

/**
 * CMS roles a hosted staff member can be bound to.
 *
 * `owner` is deliberately excluded: the CMS schema enforces a single active
 * owner per installation, and hosted authority already lives in
 * `auth_members`. Design authority maps to `admin`; copy-only authority maps
 * to `client`, whose capability set is text, image and link edits.
 */
export type BuilderCmsRole = 'admin' | 'client'

/** Permission that proves authority to change site design in the builder. */
const DESIGN_WRITE_PERMISSION = 'website.design.write'
/** Permission that proves authority to edit page copy through the builder. */
const CONTENT_WRITE_PERMISSION = 'content.pages.write'

/**
 * Maps already-resolved site permissions onto a CMS builder role.
 *
 * Returns `null` when the caller may not enter the builder at all. The
 * builder has no read-only mode, so read-only personas are refused rather
 * than admitted with write capabilities they were never granted.
 */
export function resolveBuilderCmsRole(
  permissions: readonly string[],
): BuilderCmsRole | null {
  if (permissions.includes(DESIGN_WRITE_PERMISSION)) return 'admin'
  if (permissions.includes(CONTENT_WRITE_PERMISSION)) return 'client'
  return null
}

type LinkRow = Readonly<{ legacy_user_id: string }>

/**
 * An argon2id hash of discarded random material.
 *
 * A syntactically valid hash keeps `Bun.password.verify` on its normal
 * comparison path — a sentinel string would make it throw — while no input
 * can ever satisfy it because the plaintext never leaves this function.
 */
async function unusablePasswordHash(): Promise<string> {
  return await hashPassword(randomBytes(48).toString('base64url'))
}

export class PostgresBuilderIdentityStore {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new TypeError('Hosted builder identity binding requires PostgreSQL.')
    }
    this.#db = db
  }

  /** CMS identity already bound to a hosted staff user, or null. */
  async findBound(authUserId: string): Promise<AuthUser | null> {
    if (!authUserId.trim()) return null
    const linked = await this.#db<LinkRow>`
      select legacy_user_id
      from auth_legacy_identity_links
      where auth_user_id=${authUserId}
      limit 1`
    const legacyUserId = linked.rows[0]?.legacy_user_id
    if (!legacyUserId) return null
    return await findUserById(this.#db, legacyUserId)
  }

  /**
   * Binds a hosted staff identity to a CMS identity, creating it once.
   *
   * Concurrent first entries are safe: the insert is conditional and the
   * link table's primary key plus unique constraint make a second writer a
   * no-op that then reads the winner's row.
   */
  async bind(input: Readonly<{
    authUserId: string
    email: string
    displayName: string
    role: BuilderCmsRole
  }>): Promise<AuthUser> {
    const existing = await this.findBound(input.authUserId)
    if (existing) return existing

    const email = input.email.trim()
    const normalized = email.toLowerCase()
    const displayName = input.displayName.trim() || email
    if (!email) throw new TypeError('Hosted builder identity requires an email.')
    const passwordHash = await unusablePasswordHash()

    await this.#db.transaction(async (db) => {
      // An operator may already hold a CMS account on this installation with
      // the same address. Adopt it instead of colliding with the active-email
      // unique index, and never downgrade an existing owner.
      await db`
        insert into users (
          id, email, email_normalized, display_name, password_hash, status, role_id
        )
        values (
          ${input.authUserId}, ${email}, ${normalized}, ${displayName},
          ${passwordHash}, 'active', ${input.role}
        )
        on conflict (id) do nothing`
      await db`
        insert into auth_legacy_identity_links (legacy_user_id, auth_user_id)
        select users.id, ${input.authUserId}
        from users
        where users.email_normalized=${normalized} and users.deleted_at is null
        order by case when users.id=${input.authUserId} then 0 else 1 end
        limit 1
        on conflict (legacy_user_id) do nothing`
    })

    const bound = await this.findBound(input.authUserId)
    if (!bound) throw new Error('Hosted builder identity binding did not persist.')
    return bound
  }
}

export type BuilderSessionBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

export type BuilderSessionAuthority = Readonly<{
  /** Verified hosted staff user id, or null when unauthenticated. */
  resolveStaffUserId(headers: Headers): Promise<string | null>
  /** Hosted staff profile fields needed to create the CMS identity. */
  readStaffProfile(userId: string): Promise<Readonly<{ email: string, displayName: string }> | null>
  /** Site permissions the hosted resolver granted for the requested site. */
  resolveSitePermissions(request: Request, userId: string): Promise<readonly string[]>
  handlesProductRequest(request: Request): boolean
  store: PostgresBuilderIdentityStore
}>

/**
 * `GET /api/fuma/builder-session` — exchanges a hosted staff session for the
 * CMS identity the builder boots with.
 *
 * The response is the same envelope the self-hosted `/admin/api/cms/me`
 * returns, so the builder needs no hosted-specific boot path.
 */
export function createBuilderSessionBoundary(
  input: BuilderSessionAuthority,
): BuilderSessionBoundary {
  function handles(request: Request): boolean {
    return new URL(request.url).pathname === BUILDER_SESSION_PATH
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    if (!input.handlesProductRequest(request)) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, allow: 'GET' },
      })
    }
    const userId = await input.resolveStaffUserId(request.headers)
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers })
    }
    const permissions = await input.resolveSitePermissions(request, userId)
    const role = resolveBuilderCmsRole(permissions)
    if (!role) {
      return new Response(JSON.stringify({ error: 'Builder access requires edit permission' }), {
        status: 403,
        headers,
      })
    }
    const profile = await input.readStaffProfile(userId)
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers })
    }
    const bound = await input.store.bind({
      authUserId: userId,
      email: profile.email,
      displayName: profile.displayName,
      role,
    })
    return new Response(JSON.stringify({ user: toPublicUser(bound) }), { status: 200, headers })
  }

  return Object.freeze({ handles, handle })
}
