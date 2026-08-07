import type { DbClient } from '../db/client'
import { SESSION_COOKIE_NAME, hashSessionToken } from './tokens'
import { roleHasCapability, type CoreCapability } from './capabilities'
import { findUserBySessionHash, getSessionStepUpExpiresAt, sessionRequiresMfa } from './sessions'
import { jsonResponse } from '../http'
import type { AuthUser } from '../repositories/users'

/**
 * Step-up auth window — sensitive actions (delete user, revoke another
 * device, sign out all devices, ...) require the user to have re-entered
 * their password inside their configured window. Stored on the session row
 * as `step_up_expires_at`; cleared automatically by elapse, or refreshed by
 * `POST /admin/api/cms/auth/step-up`.
 */
interface RequireStepUpOptions {
  policy?: 'user' | 'always'
}

function readCookie(req: Request, name: string): string {
  const cookie = req.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return rawValue.join('=')
  }
  return ''
}

/**
 * Hash of the request's session cookie, or `null` when no session cookie is
 * present. Returning `null` (rather than an empty string) keeps "no
 * identifiable session" distinct from a real hash — critical for
 * `revokeAllOtherSessions`, whose `keepSessionHash === null` path revokes
 * EVERY session. An empty-string sentinel would silently collapse into that
 * fallback.
 */
export async function getSessionHash(req: Request): Promise<string | null> {
  const token = readCookie(req, SESSION_COOKIE_NAME)
  return token ? hashSessionToken(token) : null
}

/**
 * Hosted builder bridge.
 *
 * Self-hosted installations authenticate CMS requests with the admin session
 * cookie and nothing else. In the hosted product that cookie is invalidated at
 * the boundary, yet staff are handed the real builder to design their site, so
 * its CMS requests must resolve the identity bound to their hosted staff
 * session. Registration is composition-time and process-wide, matching how the
 * rest of this module reads configured server state; when no resolver is
 * registered the behaviour below is byte-for-byte the self-hosted behaviour.
 */
export type HostedBuilderIdentityResolver = (
  req: Request,
  db: DbClient,
) => Promise<AuthUser | null>

let hostedBuilderIdentityResolver: HostedBuilderIdentityResolver | null = null

export function setHostedBuilderIdentityResolver(
  resolver: HostedBuilderIdentityResolver | null,
): void {
  hostedBuilderIdentityResolver = resolver
}

/**
 * Whether hosted identities are bridged into the CMS on this installation.
 *
 * Read by the step-up handler to know that NO CMS staff password is usable: every hosted
 * identity's CMS user is created with `unusablePasswordHash()`, so verifying a submitted
 * password against it can only ever fail. Following the same module-level precedent as the
 * resolver itself - null means self-host, and self-host behaviour is unchanged.
 */
export function hostedIdentityBridgeActive(): boolean {
  return hostedBuilderIdentityResolver !== null
}

export async function requireAuthenticatedUser(
  req: Request,
  db: DbClient,
): Promise<AuthUser | Response> {
  const idHash = await getSessionHash(req)
  const user = idHash ? await findUserBySessionHash(db, idHash) : null
  if (!user) {
    const bridged = hostedBuilderIdentityResolver
      ? await hostedBuilderIdentityResolver(req, db)
      : null
    if (bridged) return bridged
    if (idHash && await sessionRequiresMfa(db, idHash)) {
      return jsonResponse({ error: 'mfa_required' }, { status: 401 })
    }
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

export async function requireCapability(
  req: Request,
  db: DbClient,
  capability: CoreCapability,
): Promise<AuthUser | Response> {
  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user
  if (!userHasCapability(user, capability)) {
    return jsonResponse({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}

export function userHasCapability(user: Pick<AuthUser, 'capabilities'>, capability: CoreCapability): boolean {
  return roleHasCapability(user.capabilities, capability)
}

export function userHasAnyCapability(
  user: Pick<AuthUser, 'capabilities'>,
  capabilities: readonly CoreCapability[],
): boolean {
  return capabilities.some((capability) => userHasCapability(user, capability))
}

export async function requireAnyCapability(
  req: Request,
  db: DbClient,
  capabilities: readonly CoreCapability[],
): Promise<AuthUser | Response> {
  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user
  if (!userHasAnyCapability(user, capabilities)) {
    return jsonResponse({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}

/**
 * Step-up gate for an ALREADY-AUTHENTICATED request. Returns `null` when the
 * caller's session is inside a fresh step-up window (the action may proceed),
 * or a 401 response with the structured body `{ error: 'step_up_required' }`
 * so the client can open the StepUp dialog and retry.
 *
 * The caller passes the `AuthUser` it already resolved (via
 * `requireAuthenticatedUser` / `requireCapability`). This guard does NOT
 * re-authenticate — that is the whole point: capability-gated sensitive
 * handlers resolve the session exactly once and hand the user here, instead of
 * paying a second full session lookup (+ `last_seen_at` write) per request.
 *
 * Handler pattern:
 *   const user = await requireCapability(req, db, 'users.manage')
 *   if (user instanceof Response) return user
 *   const stepUp = await requireStepUp(req, db, user)
 *   if (stepUp) return stepUp
 *   // …proceed, knowing the action has been re-authenticated.
 *
 * Exposed in addition to `requireCapability` (rather than baked in) because
 * not every capability-gated action is sensitive — listing users is gated
 * by `users.manage` but doesn't need step-up; deleting one does.
 */
export async function requireStepUp(
  req: Request,
  db: DbClient,
  user: AuthUser,
  options: RequireStepUpOptions = {},
): Promise<Response | null> {
  if ((options.policy ?? 'user') === 'user' && user.stepUpAuthMode === 'disabled') {
    return null
  }
  const idHash = await getSessionHash(req)
  if (!idHash) {
    return jsonResponse({ error: 'step_up_required' }, { status: 401 })
  }
  const expiresAt = await getSessionStepUpExpiresAt(db, idHash)
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return jsonResponse({ error: 'step_up_required' }, { status: 401 })
  }
  return null
}
