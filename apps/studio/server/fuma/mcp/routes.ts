import type { CoreCapability } from '@core/capabilities'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { createEditorBridgeStream, type EditorBridgeScope } from '../../ai/mcp/editorBridge'
import { generateConnectorToken, hashConnectorToken } from '../../ai/mcp/connectors/token'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  McpConnectorCapabilitySchema,
  McpConnectorViewSchema,
  McpPublishConfirmationSchema,
  McpRatePolicySchema,
  McpScopeSchema,
  McpToolCapabilitySchema,
  parseMcpContract,
  sameMcpScope,
  toMcpConnectorView,
  type McpScope,
} from './contracts'
import {
  McpAuthorityError,
  McpService,
  type McpPublishConfirmationIssuerPort,
} from './service'

const CreateSchema = Type.Object({ label: Type.String({ minLength: 1, maxLength: 120 }), type: Type.Union([Type.Literal('local'), Type.Literal('remote')]), capabilities: Type.Array(McpConnectorCapabilitySchema, { minItems: 1, maxItems: 9, uniqueItems: true }), toolCapabilities: Type.Array(McpToolCapabilitySchema, { minItems: 1, maxItems: 256, uniqueItems: true }), rates: McpRatePolicySchema, expiresAt: Type.String({ format: 'date-time' }) }, { additionalProperties: false })
const CreateResponseSchema = Type.Object({ connector: McpConnectorViewSchema, token: Type.String({ pattern: '^imcp_[A-Za-z0-9_-]{43}$' }) }, { additionalProperties: false })
const ListResponseSchema = Type.Object({ connectors: Type.Array(McpConnectorViewSchema, { maxItems: 1000 }) }, { additionalProperties: false })
const RevokeResponseSchema = Type.Object({ revoked: Type.Literal(true) }, { additionalProperties: false })
const PublishConfirmationRequestSchema = Type.Object({ idempotencyKey: Type.String({ minLength: 1, maxLength: 201, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' }) }, { additionalProperties: false })
const PublishConfirmationResponseSchema = Type.Object({ confirmation: McpPublishConfirmationSchema }, { additionalProperties: false })
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })

function scope(input: FumaScopedRouteHandlerInput): McpScope {
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null || input.repositoryScope.state !== 'active' || input.context.profile.id !== input.context.scope.site.profileId) throw new McpAuthorityError('denied', 'Direct active staff site authority is required.')
  return parseMcpContract(McpScopeSchema, { platformId: input.repositoryScope.platformId, organizationId: input.repositoryScope.organizationId, workspaceId: input.repositoryScope.workspaceId, siteId: input.repositoryScope.siteId, ownerKey: input.repositoryScope.ownerKey, ownerGeneration: input.repositoryScope.generation, profileId: input.context.profile.id }, 'mcp.route.scope') as McpScope
}
function response(schema: Parameters<typeof safeParseValue>[0], value: unknown, status = 200): Response { const parsed = safeParseValue(schema, value); if (!parsed.ok) throw new Error('MCP route response failed strict validation.'); return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } }) }
function failure(error: unknown): Response { const status = error instanceof McpAuthorityError ? error.code === 'not-found' ? 404 : error.code === 'denied' || error.code === 'confirmation' ? 403 : error.code === 'rate' ? 429 : 409 : 400; return response(ErrorSchema, { error: error instanceof Error ? error.message : 'MCP request failed.' }, status) }
async function createBody(input: FumaScopedRouteHandlerInput) { const raw = await input.request.json().catch(() => null); const parsed = safeParseValue(CreateSchema, raw); if (!parsed.ok) throw new TypeError('MCP connector request is invalid.'); return parsed.value }
async function confirmationBody(input: FumaScopedRouteHandlerInput) { const raw = await input.request.json().catch(() => null); const parsed = safeParseValue(PublishConfirmationRequestSchema, raw); if (!parsed.ok) throw new TypeError('MCP publish confirmation request is invalid.'); return parsed.value }
function assertGrant(input: FumaScopedRouteHandlerInput, connectorCapabilities: readonly string[], toolCapabilities: readonly CoreCapability[]): void { const held = new Set(input.context.capabilities); if (toolCapabilities.some((capability) => !held.has(capability))) throw new McpAuthorityError('denied', 'Connector cannot exceed the current actor tool capabilities.'); if ((connectorCapabilities.includes('site.publish') || connectorCapabilities.includes('component.publish')) && (!held.has('ai.tools.write') || !held.has('pages.publish'))) throw new McpAuthorityError('denied', 'Publish connectors require current write and publish authority.'); if ((connectorCapabilities.includes('site.mutate') || connectorCapabilities.includes('component.mutate') || connectorCapabilities.includes('component.create-source')) && !held.has('ai.tools.write')) throw new McpAuthorityError('denied', 'Mutation connectors require current write authority.'); if ((connectorCapabilities.includes('component.install') || connectorCapabilities.includes('component.confirm')) && !held.has('plugins.install')) throw new McpAuthorityError('denied', 'Component install and confirmation connectors require current plugin installation authority.'); if (connectorCapabilities.includes('component.read') && !held.has('site.read')) throw new McpAuthorityError('denied', 'Component read connectors require current site read authority.') }

export function createMcpScopedRouteDeclarations(service: McpService, confirmations?: McpPublishConfirmationIssuerPort): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => { try { return await handler(input) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/ai/mcp/connectors', 'ai.providers.manage', async (input) => response(ListResponseSchema, { connectors: (await service.repository().listConnectors(scope(input))).map(toMcpConnectorView) })),
    route('POST', '/ai/mcp/connectors', 'ai.providers.manage', async (input) => { const command = await createBody(input); assertGrant(input, command.capabilities, command.toolCapabilities); const token = generateConnectorToken(); const at = service.instant(); const connector = await service.createConnector({ connectorId: crypto.randomUUID(), actorId: input.context.actor.kind === 'staff' ? input.context.actor.userId : '', label: command.label, type: command.type, scope: scope(input), tokenHash: await hashConnectorToken(token), capabilities: command.capabilities, toolCapabilities: command.toolCapabilities, rates: command.rates, state: 'active', version: 1, createdAt: at, expiresAt: command.expiresAt, revokedAt: null, lastUsedAt: null }); return response(CreateResponseSchema, { connector: toMcpConnectorView(connector), token }, 201) }),
    route('DELETE', '/ai/mcp/connectors/:connectorId', 'ai.providers.manage', async (input) => { const activeScope = scope(input); const actorId = input.context.actor.kind === 'staff' ? input.context.actor.userId : ''; await service.revoke(input.params.connectorId, activeScope, actorId); return response(RevokeResponseSchema, { revoked: true }) }),
    ...(confirmations ? [route('POST', '/ai/mcp/connectors/:connectorId/publish-confirmations', 'pages.publish', async (input) => {
      const activeScope = scope(input)
      const actorId = input.context.actor.kind === 'staff' ? input.context.actor.userId : ''
      const connector = await service.repository().connector(input.params.connectorId)
      if (!connector || connector.actorId !== actorId || !sameMcpScope(connector.scope, activeScope)) throw new McpAuthorityError('not-found', 'Connector is unavailable.')
      if (connector.state !== 'active' || (!connector.capabilities.includes('site.publish') && !connector.capabilities.includes('component.publish')) || Date.parse(connector.expiresAt) <= Date.now()) throw new McpAuthorityError('denied', 'An active publish connector is required.')
      const command = await confirmationBody(input)
      const confirmation = await confirmations.issue({ connector, operationId: `${connector.connectorId}:${command.idempotencyKey}`, request: input.request })
      return response(PublishConfirmationResponseSchema, { confirmation }, 201)
    })] : []),
    route('GET', '/ai/mcp/editor-bridge/:scope', 'ai.chat', async (input) => { const activeScope = scope(input); const bridgeScope = input.params.scope; if (bridgeScope !== 'site' && bridgeScope !== 'content') return response(ErrorSchema, { error: 'Unknown MCP bridge scope.' }, 404); const actorId = input.context.actor.kind === 'staff' ? input.context.actor.userId : ''; return new Response(createEditorBridgeStream(actorId, bridgeScope as EditorBridgeScope, input.request.signal, activeScope.siteId), { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } }) }),
  ])
}
