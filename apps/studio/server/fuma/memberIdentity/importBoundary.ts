import { createHash } from 'node:crypto'
import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteBoundary } from '../context'
import { bindPublicationScope, samePublicationScope } from '../publication/scope'
import {
  MemberImportCommandSchema,
  MemberImportReceiptSchema,
  type StaffMemberImportReauthentication,
} from './contracts'
import { MemberImportError, MemberImportService } from './importService'
import type { MemberIdentityRepository } from './repository'

const MEMBER_IMPORT_SUFFIX = '/publication/member-imports'
const MAX_IMPORT_BODY_BYTES = 8 * 1024 * 1024
const MemberImportErrorEnvelopeSchema = Type.Object({
  error: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

export type ResolvedMemberImportStaffSession = Readonly<{
  userId: string
  sessionId: string
  impersonatedBy: string | null
  createdAt: Date
}>

export type MemberImportBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

export type MemberImportBoundaryInput = Readonly<{
  repository: MemberIdentityRepository
  scopedAuthority: FumaScopedRouteBoundary
  resolveStaffSession(headers: Headers): Promise<ResolvedMemberImportStaffSession | null>
  freshSessionMs: number
  now?: () => Date
}>

function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Member import response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function error(message: string, status: number): Response {
  return json(MemberImportErrorEnvelopeSchema, { error: message }, status)
}

async function strictBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BODY_BYTES) {
    throw new TypeError('Member import request is too large.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BODY_BYTES) {
    throw new TypeError('Member import request is too large.')
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch {
    throw new TypeError('Member import request is invalid.')
  }
  const parsed = safeParseValue(MemberImportCommandSchema, candidate)
  if (!parsed.ok) throw new TypeError('Member import request is invalid.')
  return parsed.value
}

function proofId(session: ResolvedMemberImportStaffSession, now: Date): string {
  const digest = createHash('sha256')
    .update(`member-import\u0000${session.userId}\u0000${session.sessionId}\u0000${session.createdAt.toISOString()}\u0000${now.toISOString()}`)
    .digest('hex')
  return `member-import-${digest}`
}

export function createMemberImportBoundary(input: MemberImportBoundaryInput): MemberImportBoundary {
  if (!Number.isSafeInteger(input.freshSessionMs) || input.freshSessionMs <= 0) {
    throw new TypeError('Member imports require a positive fresh-session window.')
  }
  const now = input.now ?? (() => new Date())

  function handles(request: Request): boolean {
    const pathname = new URL(request.url).pathname
    return pathname.startsWith('/api/fuma/organizations/') && pathname.endsWith(MEMBER_IMPORT_SUFFIX)
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    if (request.method !== 'POST') return error('Resource not found.', 404)

    const authority = await input.scopedAuthority.authorize(
      request,
      'publication.members.write',
      { requireOrigin: true },
    )
    if (!authority) return error('Resource not found.', 404)
    if (authority.context.actor.kind !== 'staff' || authority.context.actor.impersonator !== null) {
      return error('Fresh staff reauthentication required.', 401)
    }

    const staff = await input.resolveStaffSession(request.headers)
    if (
      !staff
      || staff.impersonatedBy !== null
      || staff.userId !== authority.context.actor.userId
      || staff.sessionId !== authority.context.actor.sessionId
    ) {
      return error('Fresh staff reauthentication required.', 401)
    }

    const observedAt = now()
    const sessionAgeMs = observedAt.getTime() - staff.createdAt.getTime()
    if (!Number.isFinite(sessionAgeMs) || sessionAgeMs < 0 || sessionAgeMs >= input.freshSessionMs) {
      return error('Fresh staff reauthentication required.', 401)
    }

    try {
      const scope = bindPublicationScope(authority.repositoryScope, authority.context.profile.id)
      const expiresAt = new Date(staff.createdAt.getTime() + input.freshSessionMs).toISOString()
      const proof: StaffMemberImportReauthentication = Object.freeze({
        realm: 'staff',
        purpose: 'member-import',
        staffUserId: staff.userId,
        staffSessionId: staff.sessionId,
        scope,
        authenticatedAt: staff.createdAt.toISOString(),
        expiresAt,
        proofId: proofId(staff, observedAt),
      })
      const service = new MemberImportService(input.repository, {
        verify: async (candidate) => candidate.realm === proof.realm
          && candidate.purpose === proof.purpose
          && candidate.staffUserId === proof.staffUserId
          && candidate.staffSessionId === proof.staffSessionId
          && candidate.authenticatedAt === proof.authenticatedAt
          && candidate.expiresAt === proof.expiresAt
          && candidate.proofId === proof.proofId
          && samePublicationScope(candidate.scope, proof.scope),
      }, () => observedAt)
      const receipt = await service.import(scope, await strictBody(request), proof)
      return json(MemberImportReceiptSchema, receipt, 201)
    } catch (caught) {
      if (caught instanceof MemberImportError) {
        if (caught.code === 'reauthentication-required') return error('Fresh staff reauthentication required.', 401)
        if (caught.code === 'scope-denied') return error('Resource not found.', 404)
        return error('Member import conflicts with an existing receipt or identity.', 409)
      }
      if (caught instanceof TypeError) return error('Member import request is invalid.', 400)
      throw caught
    }
  }

  return Object.freeze({ handles, handle })
}
