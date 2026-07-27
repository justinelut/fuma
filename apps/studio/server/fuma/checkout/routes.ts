import {
  Type,
  safeParseValue,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type {
  FumaRequestContext,
  FumaScopedRouteDeclaration,
  FumaScopedRouteHandlerInput,
} from '../context'
import type { FumaRepositoryScope } from '../tenancy'
import {
  PlatformCheckoutCallbackSchema,
  PlatformCheckoutInitializeSchema,
  PlatformCheckoutViewSchema,
  PlatformCheckoutError,
  type PlatformCheckoutDestination,
  type PlatformCheckoutView,
} from './contracts'
import type { PlatformCheckoutCustomerAuthority, PlatformCheckoutService } from './service'

const ErrorEnvelopeSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

export type PlatformCheckoutPayerSession = Readonly<{
  userId: string
  sessionId: string
  email: string
  impersonatedBy: string | null
}>

export type PlatformCheckoutRoutePorts = Readonly<{
  service: PlatformCheckoutService
  resolvePayer(request: Request): Promise<PlatformCheckoutPayerSession | null>
}>

function jsonResponse<T extends TSchema>(schema: T, candidate: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) throw new Error('Checkout route produced an invalid response envelope.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}
function errorResponse(error: string, status: number): Response {
  return jsonResponse(ErrorEnvelopeSchema, { error }, status)
}
function destination(
  context: FumaRequestContext,
  repositoryScope: FumaRepositoryScope,
): PlatformCheckoutDestination {
  if (
    context.scope.platform.id !== repositoryScope.platformId
    || context.scope.organization.id !== repositoryScope.organizationId
    || context.scope.workspace.id !== repositoryScope.workspaceId
    || context.scope.site.id !== repositoryScope.siteId
    || context.scope.site.profileId !== context.profile.id
  ) {
    throw new PlatformCheckoutError('scope', 'Checkout repository scope authority denied.')
  }
  return Object.freeze({
    organizationId: context.scope.organization.id,
    workspaceId: context.scope.workspace.id,
    siteId: context.scope.site.id,
    profileId: context.profile.id,
  })
}
async function customer(
  ports: PlatformCheckoutRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<PlatformCheckoutCustomerAuthority> {
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null) {
    throw new PlatformCheckoutError('scope', 'Checkout requires a direct staff session.')
  }
  const payer = await ports.resolvePayer(input.request)
  if (
    !payer
    || payer.impersonatedBy !== null
    || payer.userId !== input.context.actor.userId
    || payer.sessionId !== input.context.actor.sessionId
  ) {
    throw new PlatformCheckoutError('scope', 'Checkout payer session authority denied.')
  }
  return Object.freeze({
    destination: destination(input.context, input.repositoryScope),
    customerActorId: payer.userId,
    payerEmail: payer.email,
  })
}
function routeFailure(error: unknown): Response {
  if (error instanceof PlatformCheckoutError) {
    if (error.code === 'invalid') return errorResponse(error.message, 400)
    if (error.code === 'not-found' || error.code === 'scope' || error.code === 'internal') {
      return errorResponse('Resource not found.', 404)
    }
    if (error.code === 'provider') return errorResponse('Payment provider is temporarily unavailable.', 502)
    if (error.code === 'verification') return errorResponse('Checkout verification failed.', 422)
    return errorResponse(error.message, 409)
  }
  console.error('[fuma-checkout] scoped route failed without customer data')
  return errorResponse('Internal server error.', 500)
}
async function initialize(
  ports: PlatformCheckoutRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const body = await readValidatedBody(input.request, PlatformCheckoutInitializeSchema)
    if (body === null) return errorResponse('Checkout intent is invalid.', 400)
    const result = await ports.service.initialize(body, await customer(ports, input))
    return jsonResponse(PlatformCheckoutViewSchema, result, 201)
  } catch (error) {
    return routeFailure(error)
  }
}
async function find(
  ports: PlatformCheckoutRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const result = await ports.service.find(
      destination(input.context, input.repositoryScope),
      input.params.checkoutId ?? '',
    )
    return jsonResponse(PlatformCheckoutViewSchema, result)
  } catch (error) {
    return routeFailure(error)
  }
}
async function cancel(
  ports: PlatformCheckoutRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    await customer(ports, input)
    const result = await ports.service.cancel(
      destination(input.context, input.repositoryScope),
      input.params.checkoutId ?? '',
    )
    return jsonResponse(PlatformCheckoutViewSchema, result)
  } catch (error) {
    return routeFailure(error)
  }
}
async function verifyCallback(
  ports: PlatformCheckoutRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    await customer(ports, input)
    const body = await readValidatedBody(input.request, PlatformCheckoutCallbackSchema)
    if (body === null) return errorResponse('Callback reference is invalid.', 400)
    const result: PlatformCheckoutView = await ports.service.verifyCallback(
      destination(input.context, input.repositoryScope),
      input.params.checkoutId ?? '',
      body.reference,
    )
    return jsonResponse(PlatformCheckoutViewSchema, result)
  } catch (error) {
    return routeFailure(error)
  }
}

export function createPlatformCheckoutScopedRouteDeclarations(
  ports: PlatformCheckoutRoutePorts,
): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    Object.freeze({
      method: 'POST' as const,
      path: '/billing/checkouts' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => initialize(ports, input),
    }),
    Object.freeze({
      method: 'GET' as const,
      path: '/billing/checkouts/:checkoutId' as const,
      permission: 'site.settings.read' as const,
      handler: (input: FumaScopedRouteHandlerInput) => find(ports, input),
    }),
    Object.freeze({
      method: 'POST' as const,
      path: '/billing/checkouts/:checkoutId/cancel' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => cancel(ports, input),
    }),
    Object.freeze({
      method: 'POST' as const,
      path: '/billing/checkouts/:checkoutId/callback' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => verifyCallback(ports, input),
    }),
  ])
}
