import { Buffer } from 'node:buffer'
import type { FumaScopedRouteHandlerInput } from '../context'
import type { BackendCapabilityMetadata, BackendCapabilityScope } from '../aiBackendCapabilities'
import type { McpScope } from '../mcp/contracts'
import type { McpService } from '../mcp/service'
import {
  CapabilityDashboardQuerySchema,
  PlatformCapabilityDashboardSchema,
  RevokeCapabilityGrantCommandSchema,
  RevokeCapabilityGrantResultSchema,
  SiteCapabilityDashboardSchema,
  CapabilityDashboardError,
  parseCapabilityDashboard,
  type CapabilityDashboardQuery,
  type PlatformCapabilityDashboard,
  type RevokeCapabilityGrantCommand,
  type SiteCapabilityDashboard,
} from './contracts'
import type { PlatformDashboardEvidence, PostgresCapabilityDashboardReadModel, SiteDashboardEvidence } from './postgresReadModel'

const CHANNELS = ['site-ai', 'mcp', 'imported-runtime', 'export-adapter'] as const
const MAX_OFFSET = 10_000
const CAPABILITY = 'site.component-usage.insert'
const VERSION = '1.0.0'

export interface CapabilityDashboardReadModel {
  site(scope: BackendCapabilityScope, limit: number, offset: number): Promise<SiteDashboardEvidence>
  platform(version: string, limit: number, offset: number): Promise<PlatformDashboardEvidence>
}

function denied(message = 'Direct protected capability dashboard authority is required.'): never {
  throw new CapabilityDashboardError('authority-denied', message)
}
function scope(input: FumaScopedRouteHandlerInput): BackendCapabilityScope {
  const route = input.context.scope
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null
    || input.context.source.kind !== 'staff-session'
    || input.context.source.userId !== input.context.actor.userId
    || input.context.source.sessionId !== input.context.actor.sessionId
    || input.repositoryScope.state !== 'active'
    || input.context.profile.id !== route.site.profileId
    || input.repositoryScope.platformId !== route.platform.id
    || input.repositoryScope.organizationId !== route.organization.id
    || input.repositoryScope.workspaceId !== route.workspace.id
    || input.repositoryScope.siteId !== route.site.id) denied()
  return Object.freeze({
    platformId: input.repositoryScope.platformId,
    organizationId: input.repositoryScope.organizationId,
    workspaceId: input.repositoryScope.workspaceId,
    siteId: input.repositoryScope.siteId,
    ownerKey: input.repositoryScope.ownerKey,
    ownerGeneration: input.repositoryScope.generation,
    profileId: input.context.profile.id as 'website'|'publication',
  })
}
function directActorId(input: FumaScopedRouteHandlerInput): string {
  if (input.context.actor.kind !== 'staff') denied()
  return input.context.actor.userId
}
function offset(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const candidate = value as Record<string, unknown>
    if (Object.keys(candidate).length !== 1 || !Number.isSafeInteger(candidate.offset)
      || Number(candidate.offset) < 1 || Number(candidate.offset) > MAX_OFFSET) throw new Error('invalid')
    return Number(candidate.offset)
  } catch { throw new CapabilityDashboardError('invalid-contract', 'Capability dashboard cursor is invalid.') }
}
function cursor(current: number, count: number, hasMore: boolean): string | null {
  if (!hasMore) return null
  const next = current + count
  if (next > MAX_OFFSET) return null
  return Buffer.from(JSON.stringify({ offset: next }), 'utf8').toString('base64url')
}
function query(raw: unknown): Readonly<{ value: CapabilityDashboardQuery; offset: number }> {
  const value = parseCapabilityDashboard(CapabilityDashboardQuerySchema, raw, 'capabilityDashboard.query') as CapabilityDashboardQuery
  return Object.freeze({ value, offset: offset(value.cursor) })
}
function receiptOutcome(item: SiteDashboardEvidence['receipts'][number]) {
  if (item.state === 'started') return 'started' as const
  if (item.state === 'denied') return 'denied' as const
  if (item.state === 'failed' || !item.receipt || !item.metered || !item.auditId) return 'failed' as const
  return 'succeeded' as const
}
function gaps(metadata: BackendCapabilityMetadata) {
  return Object.freeze(CHANNELS.flatMap((channel) => metadata.channels.includes(channel) ? [] : [{
    gapId: `${metadata.id}:${channel}`,
    channel,
    title: channel === 'imported-runtime' ? 'Imported runtime adapter unavailable' : channel === 'export-adapter' ? 'Standalone export adapter unavailable' : `${channel} unavailable`,
    reason: channel === 'export-adapter'
      ? `The replaceable ${metadata.exportAdapter.id}@${metadata.exportAdapter.version} contract is declared, but no hosted/export channel is reviewed yet.`
      : 'No reviewed authority mapping exists for this channel; direct database or generated-server fallback remains blocked.',
    state: 'blocked' as const,
  }]))
}
function health(metadata: BackendCapabilityMetadata, failed: number, missingEvidence: number, at: string) {
  if (metadata.state === 'unavailable') return Object.freeze({ state: 'unavailable' as const, checkedAt: at, detail: 'The registry marks this exact version unavailable.' })
  if (failed > 0 || missingEvidence > 0) return Object.freeze({ state: 'degraded' as const, checkedAt: at, detail: `${failed} failed or denied attempt(s); ${missingEvidence} successful operation(s) lack matching audit or metering evidence.` })
  return Object.freeze({ state: 'healthy' as const, checkedAt: at, detail: 'Registry metadata and canonical audit/metering evidence are consistent.' })
}

export class CapabilityDashboardService {
  readonly #read: CapabilityDashboardReadModel
  readonly #metadata: BackendCapabilityMetadata
  readonly #mcp: Pick<McpService, 'revoke'> | null
  readonly #now: () => Date
  constructor(input: Readonly<{ readModel: CapabilityDashboardReadModel|PostgresCapabilityDashboardReadModel; metadata: BackendCapabilityMetadata; mcp?: Pick<McpService, 'revoke'>; now?: () => Date }>) {
    if (input.metadata.id !== CAPABILITY || input.metadata.version !== VERSION) throw new TypeError('FUMA-087 requires the exact reviewed FUMA-086 capability definition.')
    this.#read = input.readModel
    this.#metadata = structuredClone(input.metadata)
    this.#mcp = input.mcp ?? null
    this.#now = input.now ?? (() => new Date())
  }

  async site(input: FumaScopedRouteHandlerInput, rawQuery: unknown): Promise<SiteCapabilityDashboard> {
    const exact = scope(input)
    const actorId = directActorId(input)
    const page = query(rawQuery)
    const evidence = await this.#read.site(exact, page.value.limit, page.offset)
    const now = this.#now().toISOString()
    const permissionGranted = input.context.permissions.allow.includes(this.#metadata.requiredPermission as never)
    const profileAvailable = this.#metadata.profiles.includes(exact.profileId)
    const canManage = input.context.permissions.allow.includes('ai.providers.manage' as never)
    const channels = CHANNELS.map((channel) => {
      const supported = this.#metadata.channels.includes(channel)
      const requiredGrant = channel === 'site-ai' ? this.#metadata.grants.siteAi : channel === 'mcp' ? this.#metadata.grants.mcp : channel === 'imported-runtime' ? this.#metadata.grants.importedRuntime : this.#metadata.grants.exportAdapter
      if (channel === 'site-ai') return Object.freeze({ channel, availability: supported && profileAvailable && permissionGranted ? 'enabled' as const : 'unavailable' as const, requiredGrant, grants: supported && permissionGranted ? [Object.freeze({ grantId: 'site-ai-permission', label: this.#metadata.requiredPermission, channel, state: 'active' as const, canRevoke: false })] : [], reason: supported ? permissionGranted ? 'Derived from the current direct staff permission and active owner generation.' : `Missing ${this.#metadata.requiredPermission}.` : 'No reviewed Site AI mapping exists.', canGrant: false as const })
      if (channel === 'mcp') {
        const grants = evidence.connectors.map((grant) => Object.freeze({ grantId: grant.connectorId, label: grant.label, channel, state: grant.state, canRevoke: canManage && grant.actorId === actorId && grant.state === 'active' }))
        const active = grants.filter((grant) => grant.state === 'active').length
        return Object.freeze({ channel, availability: !supported ? 'unavailable' as const : active > 0 ? 'enabled' as const : grants.length > 0 ? 'revoked' as const : 'unavailable' as const, requiredGrant, grants, reason: active > 0 ? `${active} active exact-scope connector grant(s).` : grants.length > 0 ? 'All matching connector grants are revoked.' : 'No matching component.mutate connector exists; create credentials only in MCP settings.', canGrant: false as const })
      }
      return Object.freeze({ channel, availability: 'unavailable' as const, requiredGrant, grants: [], reason: channel === 'export-adapter' ? 'A replaceable adapter contract exists, but no reviewed endpoint mapping is mounted.' : 'No reviewed imported-runtime authority mapping exists.', canGrant: false as const })
    })
    const missingEvidence = Math.max(0, evidence.totalSuccessful - Math.min(evidence.totalMetered, evidence.totalAudited)) + evidence.driftedReceipts
    const capabilityHealth = health(this.#metadata, evidence.totalFailed, missingEvidence, now)
    const state = this.#metadata.state === 'deprecated' ? 'deprecated' as const : this.#metadata.state === 'unavailable' || !profileAvailable || !permissionGranted ? 'unavailable' as const : capabilityHealth.state === 'degraded' ? 'degraded' as const : channels.some((item) => item.availability === 'enabled') ? 'enabled' as const : channels.some((item) => item.availability === 'revoked') ? 'revoked' as const : 'unavailable' as const
    const result = {
      kind: 'site' as const,
      capabilities: [{
        id: this.#metadata.id, version: this.#metadata.version, title: this.#metadata.title, description: this.#metadata.description,
        class: this.#metadata.class, profileAvailable, state, requiredPermission: this.#metadata.requiredPermission, permissionGranted,
        confirmation: this.#metadata.confirmation, dataClassification: this.#metadata.dataClassification,
        exportAdapter: { ...this.#metadata.exportAdapter, available: this.#metadata.channels.includes('export-adapter') },
        channels, limits: this.#metadata.limits,
        usage: { successfulOperations: evidence.totalSuccessful, failedOperations: evidence.totalFailed, ...evidence.usage },
        health: capabilityHealth,
        deprecation: { state: this.#metadata.state === 'active' ? 'current' as const : this.#metadata.state, replacement: null, detail: this.#metadata.state === 'active' ? 'This exact version is current.' : `Registry state is ${this.#metadata.state}; no replacement is advertised.` },
      }],
      recentReceipts: evidence.receipts.map((item) => ({ receiptId: item.receipt?.receiptId ?? null, capabilityId: this.#metadata.id, capabilityVersion: item.receipt?.capabilityVersion ?? this.#metadata.version, channel: item.channel, operationId: item.operationId, outcome: receiptOutcome(item), metered: item.metered, audited: item.auditId !== null, auditId: item.auditId, occurredAt: item.occurredAt })),
      nextCursor: cursor(page.offset, evidence.receipts.length, evidence.hasMore), unsupportedGaps: gaps(this.#metadata), generatedAt: now,
    }
    return parseCapabilityDashboard(SiteCapabilityDashboardSchema, result, 'capabilityDashboard.site') as SiteCapabilityDashboard
  }

  async platform(input: FumaScopedRouteHandlerInput, rawQuery: unknown): Promise<PlatformCapabilityDashboard> {
    scope(input)
    const page = query(rawQuery)
    const evidence = await this.#read.platform(this.#metadata.version, page.value.limit, page.offset)
    const now = this.#now().toISOString()
    const missingEvidence = Math.max(0, evidence.successful - Math.min(evidence.metered, evidence.audited))
    const result = {
      kind: 'platform' as const,
      inventory: [{
        id: this.#metadata.id, version: this.#metadata.version, title: this.#metadata.title, registryState: this.#metadata.state,
        health: health(this.#metadata, evidence.failed, missingEvidence + evidence.driftedReceipts, now),
        adoption: { currentVersionOperations: evidence.currentVersionOperations, driftedReceipts: evidence.driftedReceipts },
        aggregate: { tenantCount: evidence.tenantCount, successfulOperations: evidence.successful, failedOperations: evidence.failed, meteredOperations: evidence.metered, auditedOperations: evidence.audited, logicalCredits: evidence.logicalCredits, providerCredits: evidence.providerCredits, spendUsdMicros: evidence.spendUsdMicros, activeMcpGrants: evidence.activeMcpGrants, revokedMcpGrants: evidence.revokedMcpGrants },
        controls: [
          { kind: 'deprecate' as const, state: 'blocked' as const, reason: 'Deprecation requires a reviewed registry release; the dashboard cannot mutate executable registry state.' },
          { kind: 'revoke' as const, state: 'blocked' as const, reason: 'Bulk cross-tenant revocation is denied; exact-owner MCP revocation remains available in the customer workflow.' },
          { kind: 'incident' as const, state: 'blocked' as const, reason: 'Incidents and break-glass actions remain in FUMA-072 with separate approval, reason, expiry, and audit.' },
        ],
      }],
      recentEvidence: evidence.receipts.map((item) => ({ capabilityVersion: item.receipt?.capabilityVersion ?? this.#metadata.version, channel: item.channel, outcome: receiptOutcome(item), metered: item.metered, audited: item.auditId !== null, occurredAt: item.occurredAt })),
      nextCursor: cursor(page.offset, evidence.receipts.length, evidence.hasMore), unsupportedGaps: gaps(this.#metadata), generatedAt: now,
    }
    return parseCapabilityDashboard(PlatformCapabilityDashboardSchema, result, 'capabilityDashboard.platform') as PlatformCapabilityDashboard
  }

  async revoke(input: FumaScopedRouteHandlerInput, raw: unknown) {
    const exact = scope(input)
    const actorId = directActorId(input)
    if (!input.context.permissions.allow.includes('ai.providers.manage' as never)) denied('AI provider management permission is required.')
    const command = parseCapabilityDashboard(RevokeCapabilityGrantCommandSchema, raw, 'capabilityDashboard.revoke') as RevokeCapabilityGrantCommand
    if (command.capabilityId !== this.#metadata.id || command.capabilityVersion !== this.#metadata.version || !this.#mcp) throw new CapabilityDashboardError('unavailable', 'Exact capability revocation authority is unavailable.')
    const mcpScope: McpScope = Object.freeze({ ...exact })
    try { await this.#mcp.revoke(command.grantId, mcpScope, actorId) }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      throw new CapabilityDashboardError(code === 'not-found' ? 'not-found' : code === 'conflict' ? 'conflict' : 'authority-denied', 'Capability grant revocation was denied.')
    }
    return parseCapabilityDashboard(RevokeCapabilityGrantResultSchema, { ...command, state: 'revoked' }, 'capabilityDashboard.revocationResult')
  }
}
