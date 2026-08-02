import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  AiPaymentSetupError,
  AiPaymentSetupProposalViewSchema,
  ConfirmAiPaymentSetupCommandSchema,
  RegisterAiPaymentChallengeCommandSchema,
  StoreAiPaymentCredentialCommandSchema,
  parseAiPaymentSetupContract,
} from './contracts'
import { SiteAiScopeSchema } from '../siteAi/contracts'
import type {
  AiPaymentSetupActorAuthority,
  AiPaymentSetupConfirmationAuthority,
  AiPaymentSetupService,
} from './service'

export const AI_PAYMENT_SETUP_HANDOFF_COOKIE = '__Host-fuma_ai_payment_setup'
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })

function response<T extends TSchema>(schema: T, raw: unknown, status = 200, headers?: HeadersInit): Response {
  const parsed = safeParseValue(schema, raw)
  if (!parsed.ok) throw new AiPaymentSetupError('unavailable', 'AI payment setup response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}
function failure(error: unknown): Response {
  if (!(error instanceof AiPaymentSetupError)) return response(ErrorSchema, { error: 'AI payment setup is temporarily unavailable.' }, 503)
  const status = error.code === 'invalid-contract' ? 400
    : error.code === 'not-found' ? 404
      : error.code === 'denied' ? 403
        : error.code === 'expired' ? 410
          : error.code === 'conflict' ? 409
            : 503
  return response(ErrorSchema, { error: error.message }, status)
}
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T, label: string) {
  const parsed = safeParseValue(schema, await input.request.json().catch(() => null))
  if (!parsed.ok) throw new AiPaymentSetupError('invalid-contract', `${label} is invalid.`)
  return parsed.value
}
function authority(input: FumaScopedRouteHandlerInput): AiPaymentSetupActorAuthority {
  const actor = input.context.actor
  const profileId = input.context.profile.id
  if (input.repositoryScope.state !== 'active' || actor.kind !== 'staff' || actor.impersonator !== null
    || profileId !== input.context.scope.site.profileId) {
    throw new AiPaymentSetupError('denied', 'Direct active staff site authority is required.')
  }
  const scope = parseAiPaymentSetupContract(SiteAiScopeSchema, {
    platformId: input.repositoryScope.platformId,
    organizationId: input.repositoryScope.organizationId,
    workspaceId: input.repositoryScope.workspaceId,
    siteId: input.repositoryScope.siteId,
    ownerKey: input.repositoryScope.ownerKey,
    ownerGeneration: input.repositoryScope.generation,
    profileId,
  }, 'AI payment setup route scope')
  return Object.freeze({
    actorId: actor.userId,
    scope,
  })
}
function cookie(request: Request): string | null {
  for (const item of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== AI_PAYMENT_SETUP_HANDOFF_COOKIE) continue
    try { return decodeURIComponent(item.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}
function credentialCookiePath(input: FumaScopedRouteHandlerInput): string {
  const scope = input.repositoryScope
  return `/api/fuma/organizations/${encodeURIComponent(scope.organizationId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/sites/${encodeURIComponent(scope.siteId)}/ai/payment-setup/proposals/${encodeURIComponent(input.params.proposalId!)}/credentials`
}
function handoffCookie(input: FumaScopedRouteHandlerInput, token: string): string {
  return `${AI_PAYMENT_SETUP_HANDOFF_COOKIE}=${encodeURIComponent(token)}; Path=${credentialCookiePath(input)}; Max-Age=300; Secure; HttpOnly; SameSite=Strict`
}
function clearHandoffCookie(input: FumaScopedRouteHandlerInput): string {
  return `${AI_PAYMENT_SETUP_HANDOFF_COOKIE}=; Path=${credentialCookiePath(input)}; Max-Age=0; Secure; HttpOnly; SameSite=Strict`
}

export function createAiPaymentSetupScopedRoutes(input: Readonly<{
  service: AiPaymentSetupService
  resolveSession(headers: Headers): Promise<HostedResolvedSession | null>
  freshSessionMs: number
}>): readonly FumaScopedRouteDeclaration[] {
  const route = (
    method: FumaScopedRouteDeclaration['method'],
    path: string,
    permission: string,
    handler: (request: FumaScopedRouteHandlerInput) => Promise<Response>,
  ): FumaScopedRouteDeclaration => Object.freeze({
    method,
    path,
    permission,
    handler: async (request) => { try { return await handler(request) } catch (error) { return failure(error) } },
  }) as FumaScopedRouteDeclaration

  return Object.freeze([
    route('GET', '/ai/payment-setup/proposals/:proposalId', 'plugins.read', async (request) => {
      return response(AiPaymentSetupProposalViewSchema, await input.service.read(authority(request), request.params.proposalId!))
    }),
    route('POST', '/ai/payment-setup/proposals/:proposalId/challenge', 'plugins.install', async (request) => {
      const command = await body(request, RegisterAiPaymentChallengeCommandSchema, 'Payment confirmation challenge')
      return response(AiPaymentSetupProposalViewSchema, await input.service.registerChallenge(authority(request), request.params.proposalId!, command))
    }),
    route('POST', '/ai/payment-setup/proposals/:proposalId/confirm', 'plugins.install', async (request) => {
      const actor = authority(request)
      const session = await input.resolveSession(request.request.headers)
      if (!session) throw new AiPaymentSetupError('denied', 'A fresh direct hosted staff session is required.')
      const confirmationAuthority: AiPaymentSetupConfirmationAuthority = Object.freeze({
        ...actor,
        session,
        freshSessionMs: input.freshSessionMs,
      })
      const command = await body(request, ConfirmAiPaymentSetupCommandSchema, 'Payment setup confirmation')
      const result = await input.service.confirm(confirmationAuthority, request.params.proposalId!, command)
      const headers = result.handoffToken === null ? undefined : { 'set-cookie': handoffCookie(request, result.handoffToken) }
      return response(AiPaymentSetupProposalViewSchema, result.proposal, 200, headers)
    }),
    route('POST', '/ai/payment-setup/proposals/:proposalId/credentials', 'plugins.configure', async (request) => {
      const token = cookie(request.request)
      if (!token) throw new AiPaymentSetupError('not-found', 'Secure payment handoff is unavailable.')
      const command = await body(request, StoreAiPaymentCredentialCommandSchema, 'Secure payment credential')
      const result = await input.service.storeCredential(authority(request), request.params.proposalId!, token, command)
      return response(AiPaymentSetupProposalViewSchema, result, 200, { 'set-cookie': clearHandoffCookie(request) })
    }),
  ])
}
