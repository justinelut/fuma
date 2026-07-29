import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { domainScopeFromRepository, type DomainRecord, type DomainScope } from '../domains/contracts'
import { CloudflareTransportError } from './adapter'
import {
  ApexCapabilitySchema, CloudflareBindingSchema, CloudflareObservedDnsSchema, CloudflarePrevalidationSchema,
  type ApexCapability,
} from './contracts'
import { CloudflareReconcileError, type CloudflareSaasReconciler } from './reconciler'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }), alternatives: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }) }, { additionalProperties: false })
const EmptySchema = Type.Object({}, { additionalProperties: false })
export interface CloudflareDomainAuthority { exact(scope: DomainScope, domainId: string): Promise<DomainRecord | null> }

function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Cloudflare route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  if (error instanceof CloudflareTransportError && error.code === 'provider') return json(ErrorSchema, { error: 'Cloudflare is temporarily unavailable.', alternatives: [] }, 502)
  if (!(error instanceof CloudflareReconcileError)) return json(ErrorSchema, { error: 'Internal server error.', alternatives: [] }, 500)
  if (error.code === 'unsupported-apex') return json(ErrorSchema, { error: error.message, alternatives: [...error.alternatives] }, 422)
  if (error.code === 'tls-pending' || error.code === 'state' || error.code === 'stale') return json(ErrorSchema, { error: error.message, alternatives: [] }, 409)
  if (error.code === 'provider') return json(ErrorSchema, { error: 'Cloudflare is temporarily unavailable.', alternatives: [] }, 502)
  return json(ErrorSchema, { error: 'Resource not found.', alternatives: [] }, 404)
}
function scope(input: FumaScopedRouteHandlerInput): DomainScope {
  return domainScopeFromRepository(input.repositoryScope, input.context.profile.id)
}
async function domain(input: FumaScopedRouteHandlerInput, authority: CloudflareDomainAuthority): Promise<Readonly<{ scope: DomainScope; domain: DomainRecord }>> {
  const exactScope = scope(input)
  const value = await authority.exact(exactScope, input.params.domainId ?? '')
  if (!value) throw new CloudflareReconcileError('scope', 'Domain is unavailable.')
  return Object.freeze({ scope: exactScope, domain: value })
}
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T) {
  const value = await readValidatedBody(input.request, schema)
  if (value === null) throw new CloudflareReconcileError('state', 'Request contract is invalid.')
  return value
}

/** Ticket-local declarations. The conductor decides whether and where to mount them. */
export function createCloudflareRouteDeclarations(input: Readonly<{ reconciler: CloudflareSaasReconciler; domains: CloudflareDomainAuthority }>): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    Object.freeze({ method: 'GET' as const, path: '/settings/domains/:domainId/cloudflare' as const, permission: 'site.settings.read' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        const exactScope = scope(request)
        const value = await input.reconciler.exact(exactScope, request.params.domainId ?? '')
        if (!value) throw new CloudflareReconcileError('scope', 'Domain is unavailable.')
        return json(CloudflareBindingSchema, value)
      } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/prevalidate' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        const authority = await domain(request, input.domains)
        const capability = await body(request, ApexCapabilitySchema) as ApexCapability
        return json(CloudflarePrevalidationSchema, await input.reconciler.prevalidate(authority.scope, authority.domain, capability), 201)
      } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/reconcile' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.reconcile(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/cutover' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.cutover(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/rollback' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.rollback(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/diagnose' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { const observed = await body(request, CloudflareObservedDnsSchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.diagnose(authority.scope, authority.domain, observed)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'DELETE' as const, path: '/settings/domains/:domainId/cloudflare' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.remove(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
  ])
}
