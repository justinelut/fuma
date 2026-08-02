import {
  PermissionIdSchema,
  type FumaRegistry,
  type PermissionId,
} from '@core/fuma'
import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import {
  FumaRepositoryScopeResolutionError,
  deriveFumaRepositoryScope,
  type FumaRepositoryScope,
  type FumaRepositoryScopeOwnerKeyAuthority,
} from '../tenancy/repositoryScope'
import {
  FumaContextIdSchema,
  UntrustedFumaRouteScopeSchema,
  type FumaRequestContext,
  type UntrustedFumaRouteScope,
} from './contracts'
import {
  FumaRequestContextResolutionError,
  deriveFumaRequestContext,
  type FumaRequestContextAuthorityPorts,
  type FumaSiteAuthorizationAuthority,
} from './requestContext'

const SCOPED_PATH_PATTERN = /^\/api\/fuma\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)(\/.*)?$/
const ROUTE_PATH_PATTERN = '^/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9]*)(?:/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9]*))*$|^/$'
const ROUTE_PARAM_PATTERN = '^[^/\\u0000-\\u001F\\u007F]+$'
const REQUEST_ID_HEADER = 'x-request-id'
const RESOURCE_NOT_FOUND = 'Resource not found.'

export const FumaScopedHttpMethodSchema = Type.Union([
  Type.Literal('DELETE'),
  Type.Literal('GET'),
  Type.Literal('PATCH'),
  Type.Literal('POST'),
  Type.Literal('PUT'),
])
export type FumaScopedHttpMethod = Static<typeof FumaScopedHttpMethodSchema>

export const FumaScopedRoutePathSchema = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: ROUTE_PATH_PATTERN,
})
export type FumaScopedRoutePath = Static<typeof FumaScopedRoutePathSchema>

export const FumaScopedRouteDeclarationSchema = Type.Object({
  method: FumaScopedHttpMethodSchema,
  path: FumaScopedRoutePathSchema,
  permission: PermissionIdSchema,
}, { additionalProperties: false })

const FumaScopedRouteParamValueSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: ROUTE_PARAM_PATTERN,
})
const FumaScopedErrorEnvelopeSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

type FumaScopedRouteMetadata = Static<typeof FumaScopedRouteDeclarationSchema>

export type FumaScopedRouteHandlerInput = Readonly<{
  request: Request
  context: FumaRequestContext
  repositoryScope: FumaRepositoryScope
  params: Readonly<Record<string, string>>
}>

export type FumaScopedRouteHandler = (
  input: FumaScopedRouteHandlerInput,
) => Response | Promise<Response>

export type FumaScopedRouteDeclaration = Readonly<
  FumaScopedRouteMetadata & {
    handler: FumaScopedRouteHandler
    authorization?: FumaSiteAuthorizationAuthority
  }
>

export type FumaScopedRouteBoundaryDependencies = Readonly<{
  ports: FumaRequestContextAuthorityPorts
  ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
  allowsMutationOrigin(request: Request): boolean | Promise<boolean>
  registry?: FumaRegistry
  generateRequestId?: () => string
}>

export type FumaScopedRouteBoundaryInput = Readonly<
  FumaScopedRouteBoundaryDependencies & {
    routes: readonly FumaScopedRouteDeclaration[]
  }
>

export type FumaScopedRequestAuthority = Readonly<{
  context: FumaRequestContext
  repositoryScope: FumaRepositoryScope
}>

export interface FumaScopedRouteBoundary {
  handles(request: Request): boolean
  authorize(request: Request, permission: PermissionId, options?: Readonly<{ requireOrigin?: boolean }>): Promise<FumaScopedRequestAuthority | null>
  handle(request: Request): Promise<Response | null>
}

export type FumaScopedRouteDeclarationErrorCode =
  | 'invalid-declaration'
  | 'route-collision'

export class FumaScopedRouteDeclarationError extends Error {
  override readonly name = 'FumaScopedRouteDeclarationError'
  readonly code: FumaScopedRouteDeclarationErrorCode

  constructor(code: FumaScopedRouteDeclarationErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

type CompiledSegment = Readonly<
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
>

type CompiledRoute = Readonly<{
  method: FumaScopedHttpMethod
  path: FumaScopedRoutePath
  permission: PermissionId
  handler: FumaScopedRouteHandler
  authorization?: FumaSiteAuthorizationAuthority
  segments: readonly CompiledSegment[]
}>

type ParsedScopedPath = Readonly<{
  scope: UntrustedFumaRouteScope
  suffixSegments: readonly string[]
}>

const CALLER_AUTHORITY_HEADERS = Object.freeze(new Set([
  'owner-key',
  'tenant-id',
  'x-actor',
  'x-actor-id',
  'x-actor-user-id',
  'x-capabilities',
  'x-capability-id',
  'x-organization-id',
  'x-owner-key',
  'x-permission-id',
  'x-permissions',
  'x-platform-id',
  'x-profile-id',
  'x-site-id',
  'x-tenant-id',
  'x-tenant-owner-key',
  'x-user-id',
  'x-workspace-id',
]))

const AUTHORITY_HEADER_MARKERS = Object.freeze([
  'actor',
  'capabilit',
  'correlation',
  'impersonat',
  'invariant',
  'job',
  'organization',
  'owner',
  'permission',
  'platform',
  'profile',
  'request',
  'role',
  'run',
  'scope',
  'session',
  'site',
  'source',
  'tenant',
  'user',
  'workspace',
])

const AUTHORITY_BODY_KEYS = Object.freeze(new Set([
  'actor',
  'actorid',
  'actoruserid',
  'capabilities',
  'capabilityid',
  'capabilityids',
  'capabilityoverrides',
  'correlationid',
  'impersonatedby',
  'impersonator',
  'jobid',
  'organizationid',
  'ownerkey',
  'ownerkeys',
  'permissionoverrides',
  'permissions',
  'permissionid',
  'permissionids',
  'platformid',
  'platformorganizationid',
  'profileid',
  'protectedownerinvariant',
  'requestid',
  'requiredpermission',
  'role',
  'roleassignments',
  'roleid',
  'roles',
  'runid',
  'scope',
  'sessionid',
  'siteid',
  'source',
  'tenantid',
  'tenantids',
  'tenantownerkey',
  'userid',
  'workspaceid',
]))

function declarationError(message: string): never {
  throw new FumaScopedRouteDeclarationError('invalid-declaration', message)
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function parseScopedPath(pathname: string): ParsedScopedPath | null {
  const match = SCOPED_PATH_PATTERN.exec(pathname)
  if (!match) return null

  const organizationId = decodeSegment(match[1]!)
  const workspaceId = decodeSegment(match[2]!)
  const siteId = decodeSegment(match[3]!)
  if (organizationId === null || workspaceId === null || siteId === null) return null

  const parsedScope = safeParseValue(UntrustedFumaRouteScopeSchema, {
    organizationId,
    workspaceId,
    siteId,
  })
  if (!parsedScope.ok) return null

  const rawSuffix = match[4] ?? ''
  const rawSegments = rawSuffix === '' || rawSuffix === '/'
    ? []
    : rawSuffix.slice(1).split('/')
  const suffixSegments: string[] = []
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw)
    if (
      decoded === null
      || !Value.Check(FumaScopedRouteParamValueSchema, decoded)
    ) {
      return null
    }
    suffixSegments.push(decoded)
  }

  return Object.freeze({
    scope: Object.freeze(parsedScope.value),
    suffixSegments: Object.freeze(suffixSegments),
  })
}

function compileRoute(declaration: FumaScopedRouteDeclaration): CompiledRoute {
  if (typeof declaration !== 'object' || declaration === null) {
    declarationError('A scoped route declaration must be an object.')
  }
  const candidate = {
    method: declaration.method,
    path: declaration.path,
    permission: declaration.permission,
  }
  const parsed = safeParseValue(FumaScopedRouteDeclarationSchema, candidate)
  if (
    !parsed.ok
    || typeof declaration.handler !== 'function'
    || (declaration.authorization !== undefined
      && (typeof declaration.authorization !== 'object'
        || declaration.authorization === null
        || typeof declaration.authorization.loadExactSiteAuthorization !== 'function'))
  ) {
    declarationError('A scoped route declaration has invalid method, path, permission, handler, or authorization fields.')
  }

  const names = new Set<string>()
  const segments: CompiledSegment[] = parsed.value.path === '/'
    ? []
    : parsed.value.path.slice(1).split('/').map((segment) => {
      if (!segment.startsWith(':')) {
        return Object.freeze({ kind: 'literal' as const, value: segment })
      }
      const name = segment.slice(1)
      if (names.has(name)) {
        declarationError(`Scoped route "${parsed.value.path}" repeats parameter ":${name}".`)
      }
      names.add(name)
      return Object.freeze({ kind: 'param' as const, name })
    })

  return Object.freeze({
    ...parsed.value,
    handler: declaration.handler,
    ...(declaration.authorization ? { authorization: declaration.authorization } : {}),
    segments: Object.freeze(segments),
  })
}

function routesOverlap(left: CompiledRoute, right: CompiledRoute): boolean {
  if (left.method !== right.method || left.segments.length !== right.segments.length) {
    return false
  }
  return left.segments.every((segment, index) => {
    const other = right.segments[index]!
    return segment.kind === 'param'
      || other.kind === 'param'
      || segment.value === other.value
  })
}

function compileRoutes(
  declarations: readonly FumaScopedRouteDeclaration[],
): readonly CompiledRoute[] {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    declarationError('A scoped route boundary requires at least one route declaration.')
  }
  const routes = declarations.map(compileRoute)
  for (let index = 0; index < routes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < routes.length; otherIndex += 1) {
      const route = routes[index]!
      const other = routes[otherIndex]!
      if (routesOverlap(route, other)) {
        throw new FumaScopedRouteDeclarationError(
          'route-collision',
          `Scoped ${route.method} routes "${route.path}" and "${other.path}" can match the same request.`,
        )
      }
    }
  }
  return Object.freeze(routes)
}

function matchRoute(
  route: CompiledRoute,
  suffixSegments: readonly string[],
): Readonly<Record<string, string>> | null {
  if (route.segments.length !== suffixSegments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < route.segments.length; index += 1) {
    const declaration = route.segments[index]!
    const actual = suffixSegments[index]!
    if (declaration.kind === 'literal') {
      if (declaration.value !== actual) return null
    } else {
      params[declaration.name] = actual
    }
  }
  return Object.freeze(params)
}

function jsonError(error: string, status: number): Response {
  const parsed = safeParseValue(FumaScopedErrorEnvelopeSchema, { error })
  if (!parsed.ok) throw new Error('Fuma scope middleware produced an invalid error envelope.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function denialResponse(): Response {
  return jsonError(RESOURCE_NOT_FOUND, 404)
}

function responseWithRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers)
  headers.set(REQUEST_ID_HEADER, requestId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function callerClaimsHeaderAuthority(request: Request): boolean {
  for (const name of request.headers.keys()) {
    const normalized = name.toLowerCase()
    if (CALLER_AUTHORITY_HEADERS.has(normalized)) return true
    if (
      normalized.startsWith('x-fuma-')
      && AUTHORITY_HEADER_MARKERS.some((marker) => normalized.includes(marker))
    ) {
      return true
    }
  }
  return false
}

function normalizedAuthorityKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function containsCallerBodyAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCallerBodyAuthority)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, nested]) => (
    AUTHORITY_BODY_KEYS.has(normalizedAuthorityKey(key))
    || containsCallerBodyAuthority(nested)
  ))
}

async function callerClaimsBodyAuthority(request: Request): Promise<boolean> {
  if (request.body === null) return false
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    return false
  }
  const candidate = await readValidatedBody(request.clone(), Type.Unknown())
  return candidate !== null && containsCallerBodyAuthority(candidate)
}

function requestId(generate: (() => string) | undefined): string {
  const value = (generate ?? (() => crypto.randomUUID()))()
  if (!Value.Check(FumaContextIdSchema, value)) {
    throw new Error('Fuma scope middleware request ID generator returned an invalid identifier.')
  }
  return value
}

function resolutionFailure(error: FumaRequestContextResolutionError): Response {
  if (error.code === 'unauthenticated') {
    return jsonError('Authentication required.', 401)
  }
  if (error.code === 'denied') return denialResponse()
  return jsonError('Internal server error.', 500)
}

/**
 * Owns the complete hosted site-scope prefix and dispatches only declared
 * descendants. Tenant authority is derived exclusively by requestContext.ts;
 * route handlers receive its deeply frozen snapshot and frozen descendant
 * params, never caller-provided actor/profile/capability/permission claims.
 */
export function createFumaScopedRouteBoundary(
  input: FumaScopedRouteBoundaryInput,
): FumaScopedRouteBoundary {
  const routes = compileRoutes(input.routes)

  function handles(request: Request): boolean {
    return SCOPED_PATH_PATTERN.test(new URL(request.url).pathname)
  }

  async function authorize(
    request: Request,
    permission: PermissionId,
    options: Readonly<{ requireOrigin?: boolean }> = {},
  ): Promise<FumaScopedRequestAuthority | null> {
    const parsedPath = parseScopedPath(new URL(request.url).pathname)
    if (!parsedPath) return null
    if (options.requireOrigin && !await input.allowsMutationOrigin(request)) return null
    if (callerClaimsHeaderAuthority(request)) return null
    try {
      const context = await deriveFumaRequestContext({
        request,
        routeScope: parsedPath.scope,
        requiredPermission: permission,
        ports: input.ports,
        ...(input.registry ? { registry: input.registry } : {}),
        generateRequestId: input.generateRequestId ?? crypto.randomUUID,
      })
      const repositoryScope = await deriveFumaRepositoryScope({
        trustedContext: Object.freeze({ kind: 'request', context }),
        ownerKeys: input.ownerKeys,
      })
      if (repositoryScope.state !== 'active' || repositoryScope.transferFence !== null) return null
      return Object.freeze({ context, repositoryScope })
    } catch (error) {
      if (
        error instanceof FumaRequestContextResolutionError
        || error instanceof FumaRepositoryScopeResolutionError
      ) return null
      throw error
    }
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null

    let serverRequestId: string
    try {
      serverRequestId = requestId(input.generateRequestId)
    } catch (error) {
      console.error('[fuma-context] request ID generation failed:', error)
      return responseWithRequestId(
        jsonError('Internal server error.', 500),
        crypto.randomUUID(),
      )
    }

    const respond = (response: Response) => responseWithRequestId(response, serverRequestId)
    const parsedPath = parseScopedPath(new URL(request.url).pathname)
    if (!parsedPath) return respond(denialResponse())

    const pathMatches = routes
      .map((route) => ({ route, params: matchRoute(route, parsedPath.suffixSegments) }))
      .filter((match): match is { route: CompiledRoute; params: Readonly<Record<string, string>> } => (
        match.params !== null
      ))
    if (pathMatches.length === 0) return respond(denialResponse())

    const method = request.method.toUpperCase()
    const selected = pathMatches.find(({ route }) => route.method === method)
    if (!selected) {
      const response = jsonError('Method not allowed.', 405)
      response.headers.set(
        'allow',
        [...new Set(pathMatches.map(({ route }) => route.method))].sort().join(', '),
      )
      return respond(response)
    }

    try {
      if (
        selected.route.method !== 'GET'
        && !await input.allowsMutationOrigin(request)
      ) {
        return respond(jsonError('Origin not allowed.', 403))
      }
      if (
        callerClaimsHeaderAuthority(request)
        || await callerClaimsBodyAuthority(request)
      ) {
        return respond(denialResponse())
      }

      const context = await deriveFumaRequestContext({
        request,
        routeScope: parsedPath.scope,
        requiredPermission: selected.route.permission,
        ports: selected.route.authorization
          ? { ...input.ports, authorization: selected.route.authorization }
          : input.ports,
        ...(input.registry ? { registry: input.registry } : {}),
        generateRequestId: () => serverRequestId,
      })
      const repositoryScope = await deriveFumaRepositoryScope({
        trustedContext: Object.freeze({ kind: 'request', context }),
        ownerKeys: input.ownerKeys,
      })
      if (
        repositoryScope.state !== 'active'
        || repositoryScope.transferFence !== null
      ) {
        return respond(denialResponse())
      }
      const handlerInput = Object.freeze({
        request,
        context,
        repositoryScope,
        params: selected.params,
      })
      return respond(await selected.route.handler(handlerInput))
    } catch (error) {
      if (
        error instanceof FumaRequestContextResolutionError
        || error instanceof FumaRepositoryScopeResolutionError
      ) {
        return respond(
          error instanceof FumaRequestContextResolutionError
            ? resolutionFailure(error)
            : denialResponse(),
        )
      }
      console.error('[fuma-context] scoped route failed:', error)
      return respond(jsonError('Internal server error.', 500))
    }
  }

  return Object.freeze({ handles, authorize, handle })
}


export type FumaScopedRouteBoundaryFactory = (
  routes: readonly FumaScopedRouteDeclaration[],
) => FumaScopedRouteBoundary

/**
 * Captures trusted HTTP and owner-key authorities without registering routes.
 * Each product surface supplies only the descendants it owns.
 */
export function createFumaScopedRouteBoundaryFactory(
  dependencies: FumaScopedRouteBoundaryDependencies,
): FumaScopedRouteBoundaryFactory {
  return (routes) => createFumaScopedRouteBoundary({
    ...dependencies,
    routes,
  })
}
