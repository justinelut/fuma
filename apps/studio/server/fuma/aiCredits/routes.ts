import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  AiByokAttachCommandSchema,
  AiCreditReserveCommandSchema,
  AiCreditResolutionCommandSchema,
  AiCreditSettlementCommandSchema,
  parseAiCreditContract,
  sameAiCreditScope,
  type AiCreditScope,
} from './contracts'
import type { AiCreditRepository } from './repository'
import type { AiCreditService } from './service'

async function body(request: Request): Promise<unknown> { try { return await request.json() } catch { throw new TypeError('Invalid JSON body.') } }
const response = (value: unknown, status = 200): Response => Response.json(value, { status })
const failure = (_error: unknown): Response => response({ error: 'AI credit scope unavailable.' }, 400)
const accountId = (input: FumaScopedRouteHandlerInput): string => input.params.accountId

function trustedScope(input: FumaScopedRouteHandlerInput): AiCreditScope {
  const scope = input.repositoryScope
  if (scope.state !== 'active' || scope.transferFence !== null) throw new TypeError('AI credit scope unavailable.')
  return Object.freeze({
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    ownerGeneration: scope.generation,
  })
}

async function exactAccount(input: FumaScopedRouteHandlerInput, repository: AiCreditRepository, expectedAccountId?: string) {
  const scope = trustedScope(input)
  const snapshot = await repository.snapshotForScope(scope)
  if (!snapshot || (expectedAccountId !== undefined && snapshot.account.accountId !== expectedAccountId) || !sameAiCreditScope(snapshot.account.scope, scope)) throw new TypeError('AI credit scope unavailable.')
  return Object.freeze({ scope, snapshot })
}

async function exactReservation(input: FumaScopedRouteHandlerInput, repository: AiCreditRepository, reservationId: string) {
  const scope = trustedScope(input)
  const reservation = await repository.reservation(reservationId)
  if (!reservation || !sameAiCreditScope(reservation.scope, scope)) throw new TypeError('AI credit scope unavailable.')
  return reservation
}

export function createAiCreditScopedRouteDeclarations(input: Readonly<{ service: AiCreditService; repository: AiCreditRepository }>): readonly FumaScopedRouteDeclaration[] {
  const { service, repository } = input
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, handler: (request: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (request) => { try { return await handler(request) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/ai/credits', 'ai.chat', async (request) => response(await service.ledger(trustedScope(request)))),
    route('GET', '/ai/credits/:accountId', 'ai.chat', async (request) => {
      await exactAccount(request, repository, accountId(request))
      return response(await service.view(accountId(request)))
    }),
    route('POST', '/ai/credits/:accountId/reservations', 'ai.chat', async (request) => {
      const command = parseAiCreditContract(AiCreditReserveCommandSchema, await body(request.request), 'aiCredits.route.reserve')
      const exact = await exactAccount(request, repository, accountId(request))
      if (command.accountId !== exact.snapshot.account.accountId || !sameAiCreditScope(command.scope, exact.scope)) throw new TypeError('AI credit scope unavailable.')
      return response(await service.reserve(command), 201)
    }),
    route('POST', '/ai/credits/:accountId/settlements', 'ai.chat', async (request) => {
      await exactAccount(request, repository, accountId(request))
      const command = parseAiCreditContract(AiCreditSettlementCommandSchema, await body(request.request), 'aiCredits.route.settle')
      await exactReservation(request, repository, command.reservationId)
      return response(await service.settle(command))
    }),
    route('POST', '/ai/credits/:accountId/releases', 'ai.chat', async (request) => {
      await exactAccount(request, repository, accountId(request))
      const command = parseAiCreditContract(AiCreditResolutionCommandSchema, await body(request.request), 'aiCredits.route.release')
      await exactReservation(request, repository, command.reservationId)
      return response(await service.release(command))
    }),
    route('POST', '/ai/credits/:accountId/refunds', 'platform.settings.write', async (request) => {
      await exactAccount(request, repository, accountId(request))
      const command = parseAiCreditContract(AiCreditResolutionCommandSchema, await body(request.request), 'aiCredits.route.refund')
      await exactReservation(request, repository, command.reservationId)
      return response(await service.refund(command))
    }),
    route('POST', '/ai/credits/:accountId/byok', 'ai.chat', async (request) => {
      const command = parseAiCreditContract(AiByokAttachCommandSchema, await body(request.request), 'aiCredits.route.byok')
      const exact = await exactAccount(request, repository, accountId(request))
      if (!sameAiCreditScope(command.scope, exact.scope)) throw new TypeError('AI credit scope unavailable.')
      return response(await service.attachByok(command), 201)
    }),
  ])
}
