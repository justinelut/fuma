import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput, FumaSiteAuthorizationAuthority } from '../context'
import {
  PaidHandoffAdminReceiptSchema,
  PaidHandoffDashboardSchema,
  PaidHandoffOperationReceiptSchema,
} from './paidHandoffContracts'
import { PaidHandoffContractError } from './paidHandoffContracts'
import { PaidHandoffFreshSessionError } from './paidHandoffAuthority'
import { PaidHandoffError } from './paidHandoff'
import { TransferServiceError } from './service'

export interface PaidHandoffApplication {
  review(input: FumaScopedRouteHandlerInput, commandId: string): Promise<unknown>
  prepare(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
  confirm(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
  start(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
  recover(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
  reconcile(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
  escalateRefund(input: FumaScopedRouteHandlerInput, commandId: string, body: unknown): Promise<unknown>
}

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 1_000 }) }, { additionalProperties: false })
function response(schema: TSchema, result: unknown, status = 200): Response {
  const envelope = Type.Object({ result: schema }, { additionalProperties: false })
  const parsed = safeParseValue(envelope, { result })
  if (!parsed.ok) throw new Error('Paid handoff response failed strict TypeBox validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })
}
function failure(error: unknown): Response {
  const status = error instanceof PaidHandoffFreshSessionError ? 401
    : error instanceof PaidHandoffContractError ? 400
    : error instanceof PaidHandoffError ? error.code === 'not-ready' || error.code === 'invalid-state' ? 409 : 403
      : error instanceof TransferServiceError ? ['stale-version', 'stale-fence', 'conflict', 'invalid-state', 'lock-contended'].includes(error.code) ? 409 : error.code === 'invalid-input' ? 400 : error.code === 'not-found' ? 404 : 403
      : 500
  const message = error instanceof PaidHandoffFreshSessionError || error instanceof PaidHandoffError || error instanceof PaidHandoffContractError || error instanceof TransferServiceError ? error.message : 'Paid handoff operation failed.'
  const parsed = safeParseValue(ErrorSchema, { error: message })
  return new Response(JSON.stringify(parsed.ok ? parsed.value : { error: 'Paid handoff operation failed.' }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })
}
async function body(input: FumaScopedRouteHandlerInput): Promise<unknown> { return await input.request.json().catch(() => null) }

export function createPaidHandoffScopedRoutes(
  application: PaidHandoffApplication,
  authorization?: FumaSiteAuthorizationAuthority,
): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, schema: TSchema, handler: (input: FumaScopedRouteHandlerInput) => Promise<unknown>, status = 200): FumaScopedRouteDeclaration => Object.freeze({
    method, path, permission: 'site.settings.write', ...(authorization ? { authorization } : {}),
    handler: async (input: FumaScopedRouteHandlerInput) => { try { return response(schema, await handler(input), status) } catch (error) { return failure(error) } },
  }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/transfers/paid-handoffs/:commandId', PaidHandoffDashboardSchema, async (input) => await application.review(input, input.params.commandId)),
    route('POST', '/transfers/paid-handoffs/:commandId/prepare', PaidHandoffOperationReceiptSchema, async (input) => await application.prepare(input, input.params.commandId, await body(input)), 201),
    route('POST', '/transfers/paid-handoffs/:commandId/confirm', PaidHandoffOperationReceiptSchema, async (input) => await application.confirm(input, input.params.commandId, await body(input))),
    route('POST', '/transfers/paid-handoffs/:commandId/start', PaidHandoffOperationReceiptSchema, async (input) => await application.start(input, input.params.commandId, await body(input)), 202),
    route('POST', '/transfers/paid-handoffs/:commandId/recover', PaidHandoffOperationReceiptSchema, async (input) => await application.recover(input, input.params.commandId, await body(input)), 202),
    route('POST', '/transfers/paid-handoffs/:commandId/reconcile', PaidHandoffAdminReceiptSchema, async (input) => await application.reconcile(input, input.params.commandId, await body(input))),
    route('POST', '/transfers/paid-handoffs/:commandId/refund-escalations', PaidHandoffAdminReceiptSchema, async (input) => await application.escalateRefund(input, input.params.commandId, await body(input)), 202),
  ])
}
