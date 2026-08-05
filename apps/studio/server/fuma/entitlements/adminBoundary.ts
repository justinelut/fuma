import { timingSafeEqual } from 'node:crypto'
import { safeParseValue, Type, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { readValidatedBody, RequestBodyTooLargeError } from '../../http'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  EntitlementAdminAuthorityEnvelopeSchema,
  EntitlementAdminCommandSchema,
  EntitlementAdminMutationReceiptSchema,
  EntitlementAdminWorkspaceSchema,
  type EntitlementAdminAuthority,
  type EntitlementAdminCommand,
} from './adminContracts'
import { EntitlementError } from './errors'
import type { EntitlementAdminService } from './adminService'

const PATH = '/api/fuma/internal/entitlements'
const AUTHORITY_PATH = `${PATH}/authority`
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
const AuthorityRowSchema = Type.Object({
  role: Type.Union([Type.String(), Type.Null()]),
  banned: Type.Union([Type.Boolean(), Type.Null()]),
  ban_expires: Type.Union([Type.String(), Type.Null()]),
  staff_profile: Type.Boolean(),
  platform_owner: Type.Boolean(),
}, { additionalProperties: false })
type AuthorityRow = Static<typeof AuthorityRowSchema>

function sameSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && left.length >= 32 && timingSafeEqual(left, right)
}
function response(schema: TSchema, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Entitlement admin response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  const status = error instanceof EntitlementError
    ? error.code === 'not-found' ? 404
      : error.code === 'internal-only' || error.code === 'destination' ? 403
        : error.code === 'immutable' || error.code === 'expired' ? 409
          : error.code === 'incomplete-cost' ? 503 : 400
    : 500
  const message = error instanceof EntitlementError ? error.message : 'Entitlement administration failed safely.'
  return response(ErrorSchema, { error: message }, status)
}
function active(row: AuthorityRow, now: Date): boolean {
  if (!row.banned) return true
  const expires = row.ban_expires === null ? Number.POSITIVE_INFINITY : Date.parse(row.ban_expires)
  return Number.isFinite(expires) && expires <= now.getTime()
}

export type EntitlementAdminBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

export function readEntitlementControlRuntimeSecret(env: Readonly<Record<string, unknown>> = process.env): string {
  const value = env.FUMA_CONTROL_RUNTIME_SECRET
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new TypeError('FUMA_CONTROL_RUNTIME_SECRET must contain at least 32 bytes.')
  }
  return value
}

export function createEntitlementAdminBoundary(input: Readonly<{
  db: DbClient
  service: EntitlementAdminService
  resolveSession(headers: Headers): Promise<HostedResolvedSession | null>
  protectedOwnerEmail: string
  consoleHost: string
  productHost?: string
  runtimeSecret: string
  now?: () => Date
}>): EntitlementAdminBoundary {
  if (input.db.dialect !== 'postgres') throw new TypeError('Entitlement admin boundary requires PostgreSQL authority.')
  const now = input.now ?? (() => new Date())
  const protectedEmail = input.protectedOwnerEmail.trim().toLocaleLowerCase('en-US')
  if (!protectedEmail || !/^[a-z0-9.-]+(?:\.[a-z0-9.-]+)+$/.test(input.consoleHost) || Buffer.byteLength(input.runtimeSecret, 'utf8') < 32) {
    throw new TypeError('Entitlement admin boundary configuration is invalid.')
  }

  async function authority(request: Request): Promise<EntitlementAdminAuthority | null> {
    const url = new URL(request.url)
    const host = (request.headers.get('host') ?? url.hostname).toLowerCase().replace(/:[0-9]+$/, '')
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase()
    const direct = Boolean(input.productHost) && host === input.productHost && (forwarded ?? url.protocol.replace(':', '')) === 'https'
      && (request.method === 'GET' || request.headers.get('origin') === `https://${input.productHost}`)
    if (!direct && !sameSecret(input.runtimeSecret, request.headers.get('x-fuma-control-runtime-secret') ?? '')) return null
    const session = await input.resolveSession(request.headers)
    if (!session || session.impersonatedBy !== null || session.email.trim().toLocaleLowerCase('en-US') !== protectedEmail) return null
    const result = await input.db<AuthorityRow>`
      select user_account.role,user_account.banned,user_account.ban_expires::text,
        exists(select 1 from auth_staff_profiles staff where staff.user_id=user_account.id) staff_profile,
        exists(select 1 from auth_members membership where membership.user_id=user_account.id and membership.organization_id=${PLATFORM_ORGANIZATION_ID} and membership.role='owner') platform_owner
      from auth_users user_account where user_account.id=${session.userId}
    `
    const parsed = safeParseValue(AuthorityRowSchema, result.rows[0])
    if (!parsed.ok || !parsed.value.staff_profile || !parsed.value.platform_owner
      || !parsed.value.role?.split(',').map((part) => part.trim()).includes('admin') || !active(parsed.value, now())) return null
    const age = now().getTime() - session.createdAt.getTime()
    return Object.freeze({
      actorId: session.userId,
      sessionId: session.sessionId,
      protectedOwner: true,
      fresh: age >= 0 && age <= 5 * 60_000,
    })
  }

  return Object.freeze({
    handles(request: Request): boolean {
      const pathname = new URL(request.url).pathname
      return pathname === PATH || pathname === AUTHORITY_PATH
    },
    async handle(request: Request): Promise<Response | null> {
      const pathname = new URL(request.url).pathname
      if (pathname !== PATH && pathname !== AUTHORITY_PATH) return null
      if (request.method !== 'GET' && (pathname === AUTHORITY_PATH || request.method !== 'POST')) return response(ErrorSchema, { error: 'Method not allowed.' }, 405)
      const resolved = await authority(request)
      if (!resolved) return response(ErrorSchema, { error: 'Platform entitlement authority denied.' }, 403)
      if (pathname === AUTHORITY_PATH) return response(EntitlementAdminAuthorityEnvelopeSchema, { result: resolved })
      if (request.method === 'GET') {
        try { return response(Type.Object({ result: EntitlementAdminWorkspaceSchema }, { additionalProperties: false }), { result: await input.service.workspace() }) }
        catch (error) { return failure(error) }
      }
      if (!resolved.fresh) return response(ErrorSchema, { error: 'A fresh protected-owner session is required.' }, 403)
      let command: EntitlementAdminCommand | null
      try {
        command = await readValidatedBody(request, EntitlementAdminCommandSchema, { maxBytes: 524_288 })
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return response(ErrorSchema, { error: 'Entitlement command is too large.' }, 413)
        throw error
      }
      if (!command) return response(ErrorSchema, { error: 'Entitlement command failed strict validation.' }, 400)
      try {
        const receipt = await input.service.execute(command, resolved)
        return response(Type.Object({ result: EntitlementAdminMutationReceiptSchema }, { additionalProperties: false }), { result: receipt })
      } catch (error) { return failure(error) }
    },
  })
}
