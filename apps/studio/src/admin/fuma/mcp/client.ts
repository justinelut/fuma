import { apiRequest, type FetchLike } from '@core/http'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import type {
  ScopedMcpCapability,
  ScopedMcpConnectorView,
  ScopedMcpCreateIntent,
} from './McpScopedConnectorPanel'

const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ format: 'date-time' })
const CapabilitySchema = Type.Union([
  Type.Literal('site.read'),
  Type.Literal('site.mutate'),
  Type.Literal('site.publish'),
  Type.Literal('component.read'),
  Type.Literal('component.create-source'),
  Type.Literal('component.install'),
  Type.Literal('component.mutate'),
  Type.Literal('component.confirm'),
  Type.Literal('component.publish'),
])
const RateSchema = Type.Object({
  requestsPerMinute: Type.Integer({ minimum: 1, maximum: 10_000 }),
  reserveInputTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  reserveOutputTokens: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
const RatesSchema = Type.Object({
  read: RateSchema,
  mutate: RateSchema,
  publish: RateSchema,
}, { additionalProperties: false })
const ConnectorSchema = Type.Object({
  connectorId: Id,
  label: Type.String({ minLength: 1, maxLength: 120 }),
  type: Type.Union([Type.Literal('local'), Type.Literal('remote')]),
  siteId: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  capabilities: Type.Array(CapabilitySchema, { minItems: 1, maxItems: 9 }),
  rates: RatesSchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('revoked'), Type.Literal('transferring')]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  revokedAt: Type.Union([Timestamp, Type.Null()]),
  lastUsedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
const ListSchema = Type.Object({ connectors: Type.Array(ConnectorSchema) }, { additionalProperties: false })
const CreateSchema = Type.Object({
  connector: ConnectorSchema,
  token: Type.String({ pattern: '^imcp_[A-Za-z0-9_-]{43}$' }),
}, { additionalProperties: false })
const RevokeSchema = Type.Object({ revoked: Type.Literal(true) }, { additionalProperties: false })

type ConnectorWire = Static<typeof ConnectorSchema>

const RATES = Object.freeze({
  read: Object.freeze({ requestsPerMinute: 60, reserveInputTokens: 8_000, reserveOutputTokens: 8_000 }),
  mutate: Object.freeze({ requestsPerMinute: 20, reserveInputTokens: 16_000, reserveOutputTokens: 16_000 }),
  publish: Object.freeze({ requestsPerMinute: 5, reserveInputTokens: 4_000, reserveOutputTokens: 4_000 }),
})

function toolCapabilities(capabilities: readonly ScopedMcpCapability[]): string[] {
  const output = new Set<string>(['ai.chat', 'site.read'])
  if (capabilities.includes('site.mutate')) {
    output.add('ai.tools.write')
    output.add('site.structure.edit')
    output.add('site.content.edit')
    output.add('site.style.edit')
  }
  if (capabilities.includes('site.publish')) {
    output.add('ai.tools.write')
    output.add('pages.publish')
  }
  return [...output]
}

function view(value: ConnectorWire): ScopedMcpConnectorView {
  const capabilities = value.capabilities.filter((candidate): candidate is ScopedMcpCapability => (
    candidate === 'site.read' || candidate === 'site.mutate' || candidate === 'site.publish'
  ))
  return Object.freeze({
    connectorId: value.connectorId,
    label: value.label,
    siteId: value.siteId,
    ownerGeneration: value.ownerGeneration,
    capabilities,
    state: value.state,
    expiresAt: value.expiresAt,
    requestsPerMinute: Object.freeze({
      read: value.rates.read.requestsPerMinute,
      mutate: value.rates.mutate.requestsPerMinute,
      publish: value.rates.publish.requestsPerMinute,
    }),
  })
}

export class McpScopedHttpClient {
  readonly #base: string
  readonly #fetch: FetchLike

  constructor(input: Readonly<{
    organizationId: string
    workspaceId: string
    siteId: string
    fetch?: FetchLike
  }>) {
    this.#base = [
      '/api/fuma/organizations', encodeURIComponent(input.organizationId),
      'workspaces', encodeURIComponent(input.workspaceId),
      'sites', encodeURIComponent(input.siteId), 'ai/mcp/connectors',
    ].join('/')
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async list(): Promise<readonly ScopedMcpConnectorView[]> {
    const value = await apiRequest(this.#base, {
      schema: ListSchema,
      credentials: 'same-origin',
      fetchImpl: this.#fetch,
      fallbackMessage: 'Site MCP connectors could not be loaded.',
    })
    return Object.freeze(value.connectors.map(view))
  }

  async create(intent: ScopedMcpCreateIntent): Promise<Readonly<{ token: string }>> {
    const value = await apiRequest(this.#base, {
      method: 'POST',
      body: {
        label: intent.label,
        type: 'remote',
        capabilities: intent.capabilities,
        toolCapabilities: toolCapabilities(intent.capabilities),
        rates: RATES,
        expiresAt: intent.expiresAt,
      },
      schema: CreateSchema,
      credentials: 'same-origin',
      fetchImpl: this.#fetch,
      fallbackMessage: 'Site MCP connector could not be created.',
    })
    return Object.freeze({ token: value.token })
  }

  async revoke(connectorId: string): Promise<void> {
    await apiRequest(`${this.#base}/${encodeURIComponent(connectorId)}`, {
      method: 'DELETE',
      schema: RevokeSchema,
      credentials: 'same-origin',
      fetchImpl: this.#fetch,
      fallbackMessage: 'Site MCP connector could not be revoked.',
    })
  }
}
