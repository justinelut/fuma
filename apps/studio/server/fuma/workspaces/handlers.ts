import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import {
  WorkspaceIdSchema,
  WorkspaceOrganizationIdSchema,
  WorkspaceRecordSchema,
  WorkspaceSlugSchema,
  WorkspaceUserIdSchema,
  type WorkspaceArchiveInput,
  type WorkspaceCreateInput,
  type WorkspaceId,
  type WorkspaceOrganizationId,
  type WorkspaceRecord,
  type WorkspaceRestoreInput,
  type WorkspaceUpdateInput,
} from './contracts'
import { WorkspaceDomainError } from './service'

const WORKSPACE_ROUTE_PREFIX = '/api/fuma/organizations/'
const MUTATING_METHODS = new Set(['POST', 'PATCH'])
const JsonErrorSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

export const WorkspaceHandlerActorSchema = Type.Object({
  userId: WorkspaceUserIdSchema,
}, { additionalProperties: false })
export type WorkspaceHandlerActor = Readonly<Static<typeof WorkspaceHandlerActorSchema>>

export const WorkspaceCreateRequestBodySchema = Type.Object({
  id: WorkspaceIdSchema,
  slug: WorkspaceSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  isDefault: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })
export type WorkspaceCreateRequestBody = Static<typeof WorkspaceCreateRequestBodySchema>

export const WorkspaceUpdateRequestBodySchema = Type.Union([
  Type.Object({
    slug: WorkspaceSlugSchema,
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    isDefault: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    slug: Type.Optional(WorkspaceSlugSchema),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    isDefault: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    slug: Type.Optional(WorkspaceSlugSchema),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    isDefault: Type.Boolean(),
  }, { additionalProperties: false }),
])
export type WorkspaceUpdateRequestBody = Static<typeof WorkspaceUpdateRequestBodySchema>

export const WorkspaceActionRequestBodySchema = Type.Object({}, { additionalProperties: false })

const WorkspaceRouteParamsSchema = Type.Object({
  organizationId: WorkspaceOrganizationIdSchema,
  workspaceId: Type.Optional(WorkspaceIdSchema),
  action: Type.Optional(Type.Union([
    Type.Literal('set-default'),
    Type.Literal('archive'),
    Type.Literal('restore'),
  ])),
}, { additionalProperties: false })

type WorkspaceAction = 'set-default' | 'archive' | 'restore'
type WorkspaceRouteParams = Static<typeof WorkspaceRouteParamsSchema>

const WorkspaceResponseSchema = Type.Object({
  workspace: WorkspaceRecordSchema,
}, { additionalProperties: false })
const WorkspaceListResponseSchema = Type.Object({
  workspaces: Type.Array(WorkspaceRecordSchema),
}, { additionalProperties: false })

export interface AuthorizedWorkspaceServicePort {
  create(
    actor: WorkspaceHandlerActor,
    input: WorkspaceCreateInput,
  ): Promise<WorkspaceRecord>
  list(
    actor: WorkspaceHandlerActor,
    organizationId: WorkspaceOrganizationId,
  ): Promise<readonly WorkspaceRecord[]>
  get(
    actor: WorkspaceHandlerActor,
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceRecord>
  update(
    actor: WorkspaceHandlerActor,
    input: WorkspaceUpdateInput,
  ): Promise<WorkspaceRecord>
  setDefault(
    actor: WorkspaceHandlerActor,
    input: WorkspaceArchiveInput,
  ): Promise<WorkspaceRecord>
  archive(
    actor: WorkspaceHandlerActor,
    input: WorkspaceArchiveInput,
  ): Promise<WorkspaceRecord>
  restore(
    actor: WorkspaceHandlerActor,
    input: WorkspaceRestoreInput,
  ): Promise<WorkspaceRecord>
}

export interface WorkspaceHandlerBoundaryInput {
  service: AuthorizedWorkspaceServicePort
  resolveActor(request: Request): unknown | Promise<unknown>
  allowsMutationOrigin(request: Request): boolean | Promise<boolean>
}

export interface WorkspaceHandlerBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

export class WorkspaceHandlerError extends Error {
  override readonly name = 'WorkspaceHandlerError'
  readonly status: 400 | 401 | 403 | 404 | 409

  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function jsonResponse<T extends TSchema>(
  schema: T,
  candidate: unknown,
  status = 200,
): Response {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) {
    throw new Error('Workspace handler produced an invalid response envelope.')
  }
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function jsonError(message: string, status: number): Response {
  return jsonResponse(JsonErrorSchema, { error: message }, status)
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function routeParams(pathname: string): WorkspaceRouteParams | null {
  const match = /^\/api\/fuma\/organizations\/([^/]+)\/workspaces(?:\/([^/]+)(?:\/(set-default|archive|restore))?)?\/?$/.exec(pathname)
  if (!match) return null
  const organizationId = decodeSegment(match[1]!)
  const workspaceId = match[2] ? decodeSegment(match[2]) : undefined
  if (organizationId === null || workspaceId === null) return null
  const parsed = safeParseValue(WorkspaceRouteParamsSchema, {
    organizationId,
    workspaceId,
    action: match[3],
  })
  return parsed.ok ? parsed.value : null
}

function allowedMethods(params: WorkspaceRouteParams): readonly string[] {
  if (!params.workspaceId) return ['GET', 'POST']
  if (!params.action) return ['GET', 'PATCH']
  return ['POST']
}

async function actorFor(
  request: Request,
  resolver: WorkspaceHandlerBoundaryInput['resolveActor'],
): Promise<WorkspaceHandlerActor | Response> {
  const candidate = await resolver(request)
  if (candidate === null || candidate === undefined) {
    return jsonError('Authentication required', 401)
  }
  const parsed = safeParseValue(WorkspaceHandlerActorSchema, candidate)
  if (!parsed.ok) {
    throw new Error('Workspace actor resolver returned an invalid trusted context.')
  }
  return Object.freeze(parsed.value)
}

async function requestBody<T extends TSchema>(
  request: Request,
  schema: T,
  allowAbsent = false,
): Promise<Static<T> | Response> {
  if (allowAbsent && request.body === null) {
    const parsed = safeParseValue(schema, {})
    if (parsed.ok) return parsed.value
  }
  const body = await readValidatedBody(request, schema)
  return body ?? jsonError('Request body is invalid', 400)
}

function assertWorkspaceScope(
  workspace: WorkspaceRecord,
  organizationId: WorkspaceOrganizationId,
  workspaceId?: WorkspaceId,
): void {
  if (
    workspace.organizationId !== organizationId
    || (workspaceId !== undefined && workspace.id !== workspaceId)
  ) {
    throw new Error('Workspace service returned data outside the exact requested scope.')
  }
}

function workspaceResponse(
  workspace: WorkspaceRecord,
  organizationId: WorkspaceOrganizationId,
  workspaceId?: WorkspaceId,
  status = 200,
): Response {
  assertWorkspaceScope(workspace, organizationId, workspaceId)
  return jsonResponse(WorkspaceResponseSchema, { workspace }, status)
}

function workspaceListResponse(
  workspaces: readonly WorkspaceRecord[],
  organizationId: WorkspaceOrganizationId,
): Response {
  for (const workspace of workspaces) assertWorkspaceScope(workspace, organizationId)
  return jsonResponse(WorkspaceListResponseSchema, { workspaces: [...workspaces] })
}

function domainErrorResponse(error: WorkspaceDomainError): Response {
  const status = error.code === 'invalid-input'
    ? 400
    : error.code === 'not-found' || error.code === 'organization-mismatch'
      ? 404
      : 409
  return jsonError(error.message, status)
}

function routeFailure(error: unknown): Response {
  if (error instanceof WorkspaceHandlerError) return jsonError(error.message, error.status)
  if (error instanceof WorkspaceDomainError) return domainErrorResponse(error)
  console.error('[fuma-workspaces] handler failed:', error)
  return jsonError('Internal server error', 500)
}

function actionInput(
  organizationId: WorkspaceOrganizationId,
  workspaceId: WorkspaceId,
): WorkspaceArchiveInput {
  return { organizationId, workspaceId }
}

async function dispatchAction(
  service: AuthorizedWorkspaceServicePort,
  actor: WorkspaceHandlerActor,
  organizationId: WorkspaceOrganizationId,
  workspaceId: WorkspaceId,
  action: WorkspaceAction,
): Promise<WorkspaceRecord> {
  const input = actionInput(organizationId, workspaceId)
  if (action === 'set-default') return await service.setDefault(actor, input)
  if (action === 'archive') return await service.archive(actor, input)
  return await service.restore(actor, input)
}

export function createWorkspaceHandlerBoundary(
  input: WorkspaceHandlerBoundaryInput,
): WorkspaceHandlerBoundary {
  function handles(request: Request): boolean {
    const pathname = new URL(request.url).pathname
    return pathname.startsWith(WORKSPACE_ROUTE_PREFIX) && pathname.includes('/workspaces')
  }

  async function handle(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname
    if (!handles(request)) return null
    const params = routeParams(pathname)
    if (!params) return jsonError('Not found', 404)

    const method = request.method.toUpperCase()
    const methods = allowedMethods(params)
    if (!methods.includes(method)) {
      const response = jsonError('Method not allowed', 405)
      response.headers.set('allow', methods.join(', '))
      return response
    }

    try {
      if (MUTATING_METHODS.has(method) && !await input.allowsMutationOrigin(request)) {
        return jsonError('Origin not allowed', 403)
      }

      const actor = await actorFor(request, input.resolveActor)
      if (actor instanceof Response) return actor

      const { organizationId, workspaceId, action } = params
      if (!workspaceId && method === 'GET') {
        return workspaceListResponse(
          await input.service.list(actor, organizationId),
          organizationId,
        )
      }
      if (!workspaceId) {
        const body = await requestBody(request, WorkspaceCreateRequestBodySchema)
        if (body instanceof Response) return body
        const serviceInput: WorkspaceCreateInput = { ...body, organizationId }
        return workspaceResponse(
          await input.service.create(actor, serviceInput),
          organizationId,
          body.id,
          201,
        )
      }
      if (!action && method === 'GET') {
        return workspaceResponse(
          await input.service.get(actor, organizationId, workspaceId),
          organizationId,
          workspaceId,
        )
      }
      if (!action) {
        const body = await requestBody(request, WorkspaceUpdateRequestBodySchema)
        if (body instanceof Response) return body
        const serviceInput: WorkspaceUpdateInput = { ...body, organizationId, workspaceId }
        return workspaceResponse(
          await input.service.update(actor, serviceInput),
          organizationId,
          workspaceId,
        )
      }

      const body = await requestBody(request, WorkspaceActionRequestBodySchema, true)
      if (body instanceof Response) return body
      return workspaceResponse(
        await dispatchAction(input.service, actor, organizationId, workspaceId, action),
        organizationId,
        workspaceId,
      )
    } catch (error) {
      return routeFailure(error)
    }
  }

  return Object.freeze({ handles, handle })
}
