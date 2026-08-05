import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { domainScopeFromRepository, type DomainScope } from '../domains/contracts'
import {
  ConfirmedRegistrarPurchaseSchema,
  ConfirmedRegistrarRenewalSchema,
  DomainRegistrationSchema,
  RegistrarPurchaseReceiptSchema,
  RegistrarQuoteSchema,
  RegistrarRenewalReceiptSchema,
  RegistrarSearchRequestSchema,
} from './contracts'
import { RegistrarWorkflow, RegistrarWorkflowError } from './workflow'
import type { RegistrarStepUpIssuer } from './productionStepUp'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
const ReceiptSchema = Type.Union([RegistrarPurchaseReceiptSchema, RegistrarRenewalReceiptSchema])
const RegistrationListSchema = Type.Array(DomainRegistrationSchema, { maxItems: 100 })
function response<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Registrar route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  if (error instanceof TypeError) return response(ErrorSchema, { error: 'Request contract is invalid.' }, 400)
  if (!(error instanceof RegistrarWorkflowError)) return response(ErrorSchema, { error: 'Registrar capability is temporarily unavailable.' }, 500)
  if (error.code === 'invalid') return response(ErrorSchema, { error: error.message }, 400)
  if (error.code === 'unavailable' || error.code === 'not-found') return response(ErrorSchema, { error: error.message }, 404)
  if (error.code === 'entitlement') return response(ErrorSchema, { error: error.message }, 403)
  if (error.code === 'step-up') return response(ErrorSchema, { error: error.message }, 401)
  if (error.code === 'ambiguous') return response(ErrorSchema, { error: error.message }, 503)
  return response(ErrorSchema, { error: error.message }, 409)
}
function scope(input: FumaScopedRouteHandlerInput): DomainScope {
  if (!input.context.capabilities.includes('site.settings') || input.context.profile.id !== input.context.scope.site.profileId) {
    throw new RegistrarWorkflowError('invalid', 'Registrar route authority denied.')
  }
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null) {
    throw new RegistrarWorkflowError('invalid', 'Direct staff authority is required for registrar confirmation.')
  }
  return domainScopeFromRepository(input.repositoryScope, input.context.profile.id)
}

/** Capability-owned declarations only; the global router remains conductor-owned. */
export function createRegistrarScopedRouteDeclarations(
  workflow: RegistrarWorkflow,
  repository: Pick<import('./workflow').RegistrarWorkflowRepository, 'registrations'>,
  stepUpIssuer?: RegistrarStepUpIssuer,
): readonly FumaScopedRouteDeclaration[] {
  const declaration = (
    method: FumaScopedRouteDeclaration['method'], path: string, permission: string,
    handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>,
  ): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => {
    try { return await handler(input) } catch (error) { return failure(error) }
  } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    declaration('POST', '/settings/domains/registrar/search', 'site.settings.read', async (input) => {
      const body = await readValidatedBody(input.request, RegistrarSearchRequestSchema)
      if (!body) return response(ErrorSchema, { error: 'Registrar search request is invalid.' }, 400)
      return response(RegistrarQuoteSchema, await workflow.searchAndQuote(scope(input), body), 201)
    }),
    declaration('POST', '/settings/domains/registrar/purchase', 'site.settings.write', async (input) => {
      const body = await readValidatedBody(input.request, ConfirmedRegistrarPurchaseSchema)
      if (!body) return response(ErrorSchema, { error: 'Registrar purchase confirmation is invalid.' }, 400)
      const stepUpProof = stepUpIssuer
        ? await stepUpIssuer.issue(input, `registrar-purchase:${body.quoteId}:${body.expectedTermsHash}`)
        : body.stepUpProof
      return response(RegistrarPurchaseReceiptSchema, await workflow.purchase(scope(input), { ...body, stepUpProof }), 201)
    }),
    declaration('POST', '/settings/domains/registrar/renew', 'site.settings.write', async (input) => {
      const body = await readValidatedBody(input.request, ConfirmedRegistrarRenewalSchema)
      if (!body) return response(ErrorSchema, { error: 'Registrar renewal confirmation is invalid.' }, 400)
      const stepUpProof = stepUpIssuer
        ? await stepUpIssuer.issue(input, `registrar-renew:${body.registrationId}:${body.expectedPreviousExpiresAt}:${body.expectedTermsHash}`)
        : body.stepUpProof
      return response(RegistrarRenewalReceiptSchema, await workflow.renew(scope(input), { ...body, stepUpProof }), 201)
    }),
    declaration('POST', '/settings/domains/registrar/operations/:operationId/reconcile', 'site.settings.write', async (input) =>
      response(ReceiptSchema, await workflow.reconcile(scope(input), input.params.operationId))),
    declaration('GET', '/settings/domains/registrar/registrations', 'site.settings.read', async (input) =>
      response(RegistrationListSchema, await repository.registrations(scope(input)))),
  ])
}
