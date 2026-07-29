import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import type { AiCreditService } from './service'

async function body(request: Request): Promise<unknown> { try { return await request.json() } catch { throw new TypeError('Invalid JSON body.') } }
const response = (value: unknown, status = 200): Response => Response.json(value, { status })
const failure = (error: unknown): Response => response({ error: error instanceof Error ? error.message : 'AI credit request failed.' }, 400)
const accountId = (input: FumaScopedRouteHandlerInput): string => input.params.accountId
export function createAiCreditScopedRouteDeclarations(service: AiCreditService): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => { try { return await handler(input) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/ai/credits/:accountId', 'ai.chat', async (input) => response(await service.view(accountId(input)))),
    route('POST', '/ai/credits/:accountId/reservations', 'ai.chat', async (input) => response(await service.reserve(await body(input.request)), 201)),
    route('POST', '/ai/credits/:accountId/settlements', 'ai.chat', async (input) => response(await service.settle(await body(input.request)))),
    route('POST', '/ai/credits/:accountId/releases', 'ai.chat', async (input) => response(await service.release(await body(input.request)))),
    route('POST', '/ai/credits/:accountId/refunds', 'platform.settings.write', async (input) => response(await service.refund(await body(input.request)))),
    route('POST', '/ai/credits/:accountId/byok', 'ai.chat', async (input) => response(await service.attachByok(await body(input.request)), 201)),
  ])
}
