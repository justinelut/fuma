import type { AiCreditService } from '../aiCredits'
import type { DbClient } from '../../db/client'
import { hashConnectorToken } from '../../ai/mcp/connectors/token'
import { createMcpCreditAuthority, type McpCreditAccountLocator } from './creditAdapter'
import { createMcpNativeHttpAuthority, type McpHostedPublishPort } from './nativeAdapter'
import { PostgresMcpRepository } from './postgres'
import { PostgresMcpCreditAccountLocator, PostgresMcpLiveAuthority } from './productionAdapters'
import { createMcpScopedRouteDeclarations } from './routes'
import {
  McpService,
  type McpLiveAuthorityPort,
  type McpPublishConfirmationIssuerPort,
  type McpPublishConfirmationPort,
} from './service'
import { createMcpTransferStep } from './transferStep'

const bearer = /^Bearer\s+(.+)$/i

export type HostedMcpRuntimeInput = Readonly<{
  db: DbClient
  productHost: string
  credits: Pick<AiCreditService, 'view' | 'reserve' | 'settle' | 'release'>
  confirmations: McpPublishConfirmationPort & McpPublishConfirmationIssuerPort
  publisher: McpHostedPublishPort
  accounts?: McpCreditAccountLocator
  liveAuthority?: McpLiveAuthorityPort
  now?: () => Date
  generateId?: () => string
}>

/**
 * Production FUMA-066 composition. This extends the one native MCP endpoint;
 * it does not create another MCP server, registry, dispatcher, or publisher.
 */
export function createHostedMcpRuntime(input: HostedMcpRuntimeInput) {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted MCP runtime requires PostgreSQL.')
  const productHost = input.productHost.trim().toLowerCase()
  if (!productHost || productHost.includes('/') || productHost.includes(':')) {
    throw new TypeError('Hosted MCP runtime requires one exact product hostname.')
  }

  const repository = new PostgresMcpRepository(input.db)
  const accounts = input.accounts ?? new PostgresMcpCreditAccountLocator(input.db)
  const liveAuthority = input.liveAuthority ?? new PostgresMcpLiveAuthority(input.db)
  const credits = createMcpCreditAuthority({
    credits: input.credits,
    accounts,
    ...(input.now ? { now: input.now } : {}),
  })
  const service = new McpService({
    repository,
    liveAuthority,
    credits,
    confirmations: input.confirmations,
    ...(input.now ? { now: input.now } : {}),
    ...(input.generateId ? { generateId: input.generateId } : {}),
  })
  const nativeHttpAuthority = createMcpNativeHttpAuthority({
    service,
    publisher: input.publisher,
    expectedScope: async (request) => {
      const url = new URL(request.url)
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== productHost || url.port !== '') {
        throw new Error('MCP request did not use the exact HTTPS product host.')
      }
      const match = bearer.exec((request.headers.get('authorization') ?? '').trim())
      if (!match?.[1]) throw new Error('MCP bearer authority is required.')
      const connector = await repository.connectorByTokenHash(
        await hashConnectorToken(match[1].trim()),
      )
      if (!connector) throw new Error('MCP connector authority is unavailable.')
      return connector.scope
    },
  })

  return Object.freeze({
    repository,
    accounts,
    liveAuthority,
    credits,
    service,
    scopedRoutes: createMcpScopedRouteDeclarations(service, input.confirmations),
    nativeHttpAuthority,
    transferStep: createMcpTransferStep(repository),
  })
}
