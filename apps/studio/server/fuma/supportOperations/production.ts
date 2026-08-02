import { FUMA_BASE_PERMISSION_CATALOG, type PermissionId } from '@core/fuma'
import { createHash } from 'node:crypto'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type { HostedStaffAuthRuntime } from '../../auth/hosted/runtime'
import type { DbClient } from '../../db/client'
import {
  deriveFumaRequestContext,
  PostgresFumaSiteAuthorizationAuthority,
  FumaSiteAuthorizationInputSchema,
  type FumaSiteAuthorizationAuthority,
  type FumaSiteAuthorizationInput,
} from '../context'
import { ObjectStorageError, type TenantObjectStorage } from '../objectStorage'
import {
  SupportOperationsError,
  type CurrentStaffAuthority,
  type ImmutableEvidenceReference,
  type ModerationEvidenceRecord,
  type ModerationSubject,
  type SupportTargetAuthority,
  type SupportTenantScope,
} from './contracts'
import type {
  ImmutableSupportEvidenceAuthority,
  ModerationMutationAuthority,
  OwnerRecoveryAuthority,
  SupportAuthorityResolver,
  SupportImpersonationAuthority,
} from './service'

const INTERNAL_CAPABILITIES = Object.freeze([
  'internal.support.impersonate',
  'internal.moderation.read',
  'internal.moderation.write',
  'internal.break-glass.request',
  'internal.break-glass.approve',
  'internal.break-glass.execute',
])
const AuthorityRowSchema = Type.Object({
  user_id: Type.String({ minLength: 1, maxLength: 255 }),
  session_id: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  impersonated_by: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  session_created_at: Type.Union([Type.String(), Type.Null()]),
  session_expires_at: Type.Union([Type.String(), Type.Null()]),
  email: Type.String({ minLength: 3, maxLength: 320 }),
  role: Type.Union([Type.String(), Type.Null()]),
  banned: Type.Union([Type.Boolean(), Type.Null()]),
  ban_expires: Type.Union([Type.String(), Type.Null()]),
  staff_profile: Type.Boolean(),
}, { additionalProperties: false })
type AuthorityRow = Static<typeof AuthorityRowSchema>

function denied(message: string): never { throw new SupportOperationsError('authority-denied', message) }
function normalizedEmail(value: string): string { return value.trim().toLocaleLowerCase('en-US') }
function active(row: AuthorityRow, now: Date): boolean {
  if (!row.banned) return true
  const expiry = row.ban_expires === null ? Number.POSITIVE_INFINITY : Date.parse(row.ban_expires)
  return Number.isFinite(expiry) && expiry <= now.getTime()
}
function parseRow(value: unknown): AuthorityRow {
  const parsed = safeParseValue(AuthorityRowSchema, value)
  if (!parsed.ok) denied('Stored support authority is malformed.')
  return parsed.value
}
function internal(row: AuthorityRow): boolean {
  return row.staff_profile && row.role?.split(',').map((part) => part.trim()).includes('admin') === true
}
async function authorityRow(db: DbClient, userId: string, sessionId: string | null): Promise<AuthorityRow | null> {
  const result = sessionId === null
    ? await db<AuthorityRow>`select user_account.id user_id,null::text session_id,null::text impersonated_by,null::text session_created_at,null::text session_expires_at,user_account.email,user_account.role,user_account.banned,user_account.ban_expires::text,exists(select 1 from auth_staff_profiles staff where staff.user_id=user_account.id) staff_profile from auth_users user_account where user_account.id=${userId}`
    : await db<AuthorityRow>`select user_account.id user_id,session.id session_id,session.impersonated_by,session.created_at::text session_created_at,session.expires_at::text session_expires_at,user_account.email,user_account.role,user_account.banned,user_account.ban_expires::text,exists(select 1 from auth_staff_profiles staff where staff.user_id=user_account.id) staff_profile from auth_users user_account join auth_sessions session on session.user_id=user_account.id where user_account.id=${userId} and session.id=${sessionId}`
  if (result.rows.length === 0) return null
  if (result.rows.length !== 1) denied('Stored support authority is ambiguous.')
  return parseRow(result.rows[0])
}

export class PostgresSupportAuthorityResolver implements SupportAuthorityResolver {
  readonly #db: DbClient
  readonly #protectedOwnerEmail: string
  readonly #sites: PostgresFumaSiteAuthorizationAuthority
  readonly #now: () => Date
  readonly #consoleHost: string

  constructor(input: Readonly<{ db: DbClient; protectedOwnerEmail: string; consoleHost: string; now?: () => Date }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted support authority requires PostgreSQL.')
    this.#db = input.db
    this.#protectedOwnerEmail = normalizedEmail(input.protectedOwnerEmail)
    if (!this.#protectedOwnerEmail) throw new TypeError('Hosted support authority requires the protected owner email.')
    this.#sites = new PostgresFumaSiteAuthorizationAuthority(input.db)
    this.#now = input.now ?? (() => new Date())
    this.#consoleHost = input.consoleHost
  }

  async #row(userId: string, sessionId: string | null): Promise<AuthorityRow | null> {
    return await authorityRow(this.#db, userId, sessionId)
  }

  #staff(row: AuthorityRow): CurrentStaffAuthority {
    const now = this.#now()
    const sessionActive = row.session_id !== null && row.session_expires_at !== null && Date.parse(row.session_expires_at) > now.getTime()
    const internalStaff = internal(row)
    return Object.freeze({
      userId: row.user_id,
      sessionId: row.session_id ?? 'unavailable-session',
      impersonatedBy: row.impersonated_by,
      stepUpAt: row.session_created_at === null ? null : new Date(row.session_created_at).toISOString(),
      active: active(row, now) && sessionActive && internalStaff,
      protectedOwner: normalizedEmail(row.email) === this.#protectedOwnerEmail,
      capabilities: internalStaff ? [...INTERNAL_CAPABILITIES] : [],
    })
  }

  async #target(userId: string, scope: SupportTenantScope, capability?: string): Promise<SupportTargetAuthority | null> {
    const row = await this.#row(userId, null)
    if (!row) return null
    const protectedTarget = normalizedEmail(row.email) === this.#protectedOwnerEmail || row.staff_profile
    const requested = capability ?? 'site.read'
    const known = FUMA_BASE_PERMISSION_CATALOG.permissions.some(({ id }) => id === requested)
      || /^[a-z][a-z0-9.:-]+$/.test(requested)
    let allowed = false
    if (known && active(row, this.#now())) {
      try {
        await deriveFumaRequestContext({
          request: new Request(`https://${this.#consoleHost}/internal-support-authority`),
          routeScope: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId },
          requiredPermission: requested as PermissionId,
          ports: {
            sessions: { async authenticateSameOriginHostedSession() { return { kind: 'staff', userId, sessionId: 'support-authority-check', impersonator: null } } },
            authorization: this.#sites,
          },
        })
        allowed = true
      } catch { allowed = false }
    }
    return Object.freeze({
      userId,
      active: active(row, this.#now()) && allowed,
      protectedOwner: protectedTarget,
      capabilities: capability && allowed ? [capability] : [],
    })
  }

  async resolveDirect(input: Parameters<SupportAuthorityResolver['resolveDirect']>[0]) {
    if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null
      || input.context.source.kind !== 'staff-session') denied('Direct staff authority is required.')
    const row = await this.#row(input.context.actor.userId, input.context.actor.sessionId)
    if (!row) denied('Current staff session is unavailable.')
    const target = input.targetUserId === null ? null : await this.#target(input.targetUserId, {
      platformId: input.scope.platformId, organizationId: input.scope.organizationId,
      workspaceId: input.scope.workspaceId, siteId: input.scope.siteId,
      ownerKey: input.scope.ownerKey, ownerGeneration: input.scope.generation,
    })
    return Object.freeze({ staff: this.#staff(row), target })
  }

  async resolveCurrentStaff(userId: string, _scope: SupportTenantScope, sessionId?: string): Promise<CurrentStaffAuthority | null> {
    const row = await this.#row(userId, sessionId ?? null)
    return row && sessionId ? this.#staff(row) : null
  }

  async resolveCurrentTarget(userId: string, scope: SupportTenantScope, capability?: string): Promise<SupportTargetAuthority | null> {
    return await this.#target(userId, scope, capability)
  }
}

/**
 * Grants only the route-local `site.read` used to enter FUMA-072 handlers.
 * Service-level policy still revalidates every internal capability and target
 * permission. Ordinary scoped routes retain the canonical customer authority.
 */
export class PostgresSupportRouteAuthorizationAuthority implements FumaSiteAuthorizationAuthority {
  readonly #db: DbClient
  readonly #protectedOwnerEmail: string
  readonly #sites: FumaSiteAuthorizationAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{ db: DbClient; protectedOwnerEmail: string; sites?: FumaSiteAuthorizationAuthority; now?: () => Date }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted support route authority requires PostgreSQL.')
    this.#db = input.db
    this.#protectedOwnerEmail = normalizedEmail(input.protectedOwnerEmail)
    if (!this.#protectedOwnerEmail) throw new TypeError('Hosted support route authority requires the protected owner email.')
    this.#sites = input.sites ?? new PostgresFumaSiteAuthorizationAuthority(input.db)
    this.#now = input.now ?? (() => new Date())
  }

  async loadExactSiteAuthorization(input: Parameters<FumaSiteAuthorizationAuthority['loadExactSiteAuthorization']>[0]): Promise<FumaSiteAuthorizationInput | null> {
    const row = await authorityRow(this.#db, input.actor.userId, input.actor.sessionId)
    if (!row || normalizedEmail(row.email) === this.#protectedOwnerEmail) return null
    const sessionActive = row.session_id === input.actor.sessionId
      && row.session_expires_at !== null
      && Date.parse(row.session_expires_at) > this.#now().getTime()
    if (!sessionActive || row.impersonated_by !== (input.actor.impersonator?.userId ?? null)) return null
    const directInternal = input.actor.impersonator === null && internal(row) && active(row, this.#now())
    const boundedImpersonation = input.actor.impersonator !== null && !row.staff_profile
    if (!directInternal && !boundedImpersonation) return null

    const rawAuthorization = await this.#sites.loadExactSiteAuthorization(input)
    if (!rawAuthorization) return null
    const parsedAuthorization = safeParseValue(FumaSiteAuthorizationInputSchema, rawAuthorization)
    if (!parsedAuthorization.ok) denied('Stored support route authority is malformed.')
    const authorization = parsedAuthorization.value
    const assignmentId = `support-route-${createHash('sha256').update(JSON.stringify([input.actor.userId, input.routeScope])).digest('hex')}`
    const candidate = {
      ...authorization,
      permissions: {
        ...authorization.permissions,
        roleAssignments: [
          ...authorization.permissions.roleAssignments,
          {
            id: assignmentId,
            subjectId: input.actor.userId,
            scope: {
              kind: 'site' as const,
              platformId: authorization.platform.id,
              organizationId: authorization.organization.id,
              workspaceId: authorization.workspace.id,
              siteId: authorization.site.id,
            },
            role: { kind: 'launch-persona' as const, persona: 'viewer' as const },
          },
        ],
      },
    }
    const parsedCandidate = safeParseValue(FumaSiteAuthorizationInputSchema, candidate)
    if (!parsedCandidate.ok) denied('Support route authority overlay is malformed.')
    return parsedCandidate.value
  }
}

export class ObjectStorageSupportEvidenceAuthority implements ImmutableSupportEvidenceAuthority {
  readonly #storage: TenantObjectStorage
  constructor(storage: TenantObjectStorage) { this.#storage = storage }
  async assertImmutable(scope: SupportTenantScope, reference: ImmutableEvidenceReference): Promise<void> {
    try {
      const metadata = await this.#storage.head({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId }, reference.objectKey)
      if (metadata.key !== reference.objectKey || metadata.checksumSha256 !== reference.hashSha256 || metadata.mimeType !== 'application/json') {
        throw new SupportOperationsError('evidence-denied', 'Immutable support evidence metadata does not match its exact tenant-bound reference.')
      }
    } catch (error) {
      if (error instanceof SupportOperationsError) throw error
      if (error instanceof ObjectStorageError) throw new SupportOperationsError('evidence-denied', 'Immutable support evidence is unavailable or corrupt.')
      throw error
    }
  }
}

export class BetterAuthSupportImpersonationAuthority implements SupportImpersonationAuthority {
  readonly #auth: Pick<HostedStaffAuthRuntime, 'startSupportImpersonation' | 'stopSupportImpersonation'>
  constructor(auth: Pick<HostedStaffAuthRuntime, 'startSupportImpersonation' | 'stopSupportImpersonation'>) { this.#auth = auth }
  async start(input: Parameters<SupportImpersonationAuthority['start']>[0]) {
    const result = await this.#auth.startSupportImpersonation(input.requestHeaders, input.targetUserId, input.expiresAt)
    if (result.userId !== input.targetUserId || result.impersonatedBy !== input.staffActorId || result.setCookies.length === 0) {
      throw new SupportOperationsError('authority-denied', 'Better Auth did not bind the exact support impersonation identity and cookies.')
    }
    return Object.freeze({ setCookies: [...result.setCookies] })
  }
  async end(input: Parameters<SupportImpersonationAuthority['end']>[0]) {
    const result = await this.#auth.stopSupportImpersonation(input.requestHeaders)
    if (result.userId !== input.staffActorId || result.impersonatedBy !== null || result.setCookies.length === 0) {
      throw new SupportOperationsError('authority-denied', 'Better Auth did not restore the exact originating staff identity and cookies.')
    }
    return Object.freeze({ setCookies: [...result.setCookies] })
  }
}

export class PostgresModerationMutationAuthority implements ModerationMutationAuthority {
  readonly #db: DbClient
  readonly #auth: Pick<HostedStaffAuthRuntime, 'setSupportModerationBan'>
  constructor(input: Readonly<{ db: DbClient; auth: Pick<HostedStaffAuthRuntime, 'setSupportModerationBan'> }>) { this.#db = input.db; this.#auth = input.auth }
  async assertSubject(scope: SupportTenantScope, subject: ModerationSubject): Promise<void> {
    const result = subject.kind === 'user'
      ? await this.#db`select 1 from auth_users user_account join auth_members member on member.user_id=user_account.id where user_account.id=${subject.id} and member.organization_id=${scope.organizationId} limit 1`
      : subject.kind === 'organization'
        ? await this.#db`select 1 from fuma_organization_profiles where organization_id=${subject.id} and organization_id=${scope.organizationId} limit 1`
        : subject.kind === 'site'
          ? await this.#db`select 1 from fuma_sites where id=${subject.id} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and id=${scope.siteId} limit 1`
          : subject.kind === 'expert'
            ? await this.#db`select 1 from fuma_expert_profiles where expert_id=${subject.id} and organization_id=${scope.organizationId} limit 1`
            : await this.#db`select 1 from fuma_artifact_installations_v2 where package_id=${subject.id} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.ownerGeneration} limit 1`
    if (result.rowCount !== 1) throw new SupportOperationsError('scope-denied', 'Moderation subject is unavailable in this exact tenant scope.')
  }
  async apply(record: ModerationEvidenceRecord, requestHeaders: Headers): Promise<void> {
    if (record.subject.kind !== 'user') return
    if (record.event === 'suspended') await this.#auth.setSupportModerationBan(requestHeaders, record.subject.id, true, record.reason)
    if (record.event === 'resolved') await this.#auth.setSupportModerationBan(requestHeaders, record.subject.id, false, record.reason)
  }
}

export class BetterAuthOwnerRecoveryAuthority implements OwnerRecoveryAuthority {
  readonly #auth: Pick<HostedStaffAuthRuntime, 'recoverProtectedOwner'>
  constructor(auth: Pick<HostedStaffAuthRuntime, 'recoverProtectedOwner'>) { this.#auth = auth }
  async recover(input: Parameters<OwnerRecoveryAuthority['recover']>[0]): Promise<void> {
    await this.#auth.recoverProtectedOwner(input.requestHeaders, input.targetOwnerId)
  }
}
