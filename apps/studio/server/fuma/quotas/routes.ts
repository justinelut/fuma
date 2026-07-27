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
import { WorkloadAssumptionsSchema } from '../entitlements'
import {
  QuotaForecastResultSchema,
  QuotaSelfServiceSchema,
  TopUpRequestSchema,
} from './contracts'
import type { QuotaUsageCollector } from './collector'
import type { PostgresQuotaAccountRepository } from './account'
import { QuotaError } from './service'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const TopUpResponseSchema = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  state: Type.Literal('requested'),
}, { additionalProperties: false })
const CancellationResponseSchema = Type.Object({ requested: Type.Literal(true) }, { additionalProperties: false })
const ScopedForecastRequestSchema = Type.Object({
  kind: Type.Union([Type.Literal('setup'), Type.Literal('import')]),
  workload: WorkloadAssumptionsSchema,
  collaborators: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

export type QuotaSelfServiceRoutePorts = Readonly<{
  accounts: Pick<
    PostgresQuotaAccountRepository,
    'selfService' | 'requestTopUp' | 'requestCancellation'
  >
  collector: Pick<QuotaUsageCollector, 'forecast'>
}>

function response<T extends TSchema>(
  schema: T,
  value: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Quota self-service route produced an invalid response.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function organization(
  context: FumaRequestContext,
  repositoryScope: FumaRepositoryScope,
): string {
  if (context.scope.platform.id !== repositoryScope.platformId
    || context.scope.organization.id !== repositoryScope.organizationId
    || context.scope.workspace.id !== repositoryScope.workspaceId
    || context.scope.site.id !== repositoryScope.siteId) {
    throw new QuotaError('invalid', 'Quota self-service scope authority denied.')
  }
  return context.scope.organization.id
}

function directActor(input: FumaScopedRouteHandlerInput): string {
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null) {
    throw new QuotaError('invalid', 'Billing changes require a direct staff session.')
  }
  return input.context.actor.userId
}

function failure(error: unknown): Response {
  if (error instanceof QuotaError) {
    if (error.code === 'unverified-contract') return response(ErrorSchema, { error: 'Resource not found.' }, 404)
    if (error.code === 'payment-required') return response(ErrorSchema, { error: error.message }, 402)
    if (error.code === 'invalid') return response(ErrorSchema, { error: error.message }, 400)
    return response(ErrorSchema, { error: error.message }, 409)
  }
  console.error('[fuma-quotas] scoped self-service route failed without customer data')
  return response(ErrorSchema, { error: 'Internal server error.' }, 500)
}

async function view(
  ports: QuotaSelfServiceRoutePorts,
  input: FumaScopedRouteHandlerInput,
  download: boolean,
): Promise<Response> {
  try {
    const model = await ports.accounts.selfService(organization(input.context, input.repositoryScope))
    return response(
      QuotaSelfServiceSchema,
      model,
      200,
      download ? { 'content-disposition': 'attachment; filename="fuma-usage-export.json"' } : {},
    )
  } catch (error) {
    return failure(error)
  }
}

async function forecast(
  ports: QuotaSelfServiceRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const body = await readValidatedBody(input.request, ScopedForecastRequestSchema)
    if (body === null) return response(ErrorSchema, { error: 'Setup/import quota forecast is invalid.' }, 400)
    const result = await ports.collector.forecast(Object.freeze({
      ...body,
      organizationId: organization(input.context, input.repositoryScope),
    }))
    return response(QuotaForecastResultSchema, result)
  } catch (error) {
    return failure(error)
  }
}

async function requestTopUp(
  ports: QuotaSelfServiceRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const body = await readValidatedBody(input.request, TopUpRequestSchema)
    if (body === null) return response(ErrorSchema, { error: 'Top-up request is invalid.' }, 400)
    const result = await ports.accounts.requestTopUp(
      organization(input.context, input.repositoryScope),
      directActor(input),
      body,
    )
    return response(TopUpResponseSchema, result, 201)
  } catch (error) {
    return failure(error)
  }
}

async function requestCancellation(
  ports: QuotaSelfServiceRoutePorts,
  input: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    await ports.accounts.requestCancellation(
      organization(input.context, input.repositoryScope),
      directActor(input),
    )
    return response(CancellationResponseSchema, { requested: true })
  } catch (error) {
    return failure(error)
  }
}

export function createQuotaSelfServiceScopedRouteDeclarations(
  ports: QuotaSelfServiceRoutePorts,
): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    Object.freeze({
      method: 'GET' as const,
      path: '/quotas/self-service' as const,
      permission: 'site.settings.read' as const,
      handler: (input: FumaScopedRouteHandlerInput) => view(ports, input, false),
    }),
    Object.freeze({
      method: 'GET' as const,
      path: '/quotas/self-service/export' as const,
      permission: 'site.settings.read' as const,
      handler: (input: FumaScopedRouteHandlerInput) => view(ports, input, true),
    }),
    Object.freeze({
      method: 'POST' as const,
      path: '/quotas/forecast' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => forecast(ports, input),
    }),
    Object.freeze({
      method: 'POST' as const,
      path: '/quotas/top-up-requests' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => requestTopUp(ports, input),
    }),
    Object.freeze({
      method: 'POST' as const,
      path: '/billing/cancellation' as const,
      permission: 'site.settings.write' as const,
      handler: (input: FumaScopedRouteHandlerInput) => requestCancellation(ports, input),
    }),
  ])
}
