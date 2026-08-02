import { describe, expect, it } from 'bun:test'
import { Type } from '@core/utils/typeboxHelpers'
import {
  INSERT_DATA_BACKED_SECTION_CAPABILITY,
  InsertDataBackedSectionInputSchema,
  PostgresAiBackendCapabilityRuntime,
  ReviewedBackendCapabilityRegistry,
  assertFrontendCapabilitySource,
  assertStrictCapabilitySchema,
  createInsertDataBackedSectionCapability,
  type BackendCapabilityEvidencePort,
  type TrustedBackendCapabilityAuthority,
} from '../../../server/fuma/aiBackendCapabilities'

const NOW = '2026-07-31T08:59:42.000Z'
const COMMAND = Object.freeze({
  coordinate: 'test.owner/hero@1.0.0',
  componentId: 'hero',
  usageId: 'usage-086',
  kind: 'page-node' as const,
  resourceId: 'home',
  parentNodeId: 'home-root',
  variantId: null,
  props: { heading: 'Reviewed section' },
})

function authority(channel: 'site-ai' | 'mcp' = 'site-ai'): TrustedBackendCapabilityAuthority {
  return {
    channel,
    operationId: `operation-${channel}`,
    outerReceiptId: `outer-${channel}`,
    reservationId: `reservation-${channel}`,
    scope: {
      platformId: 'fuma',
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      ownerKey: 'owner-a',
      ownerGeneration: 3,
      profileId: 'website',
    },
    actor: {
      kind: 'staff',
      actorId: 'actor-a',
      sessionId: `session-${channel}`,
      impersonatorId: null,
    },
    permissions: ['site.structure.edit'],
    grants: [channel === 'site-ai' ? 'ai.tools.write' : 'component.mutate'],
    authorityRevision: 3,
    state: 'active',
    resolvedAt: NOW,
    confirmation: null,
  }
}

function fixture() {
  const calls: unknown[] = []
  const evidenceEvents: unknown[] = []
  const service = {
    async execute(context: unknown, action: unknown, raw: unknown) {
      calls.push({ context, action, raw })
      const input = raw as typeof COMMAND
      return {
        usage: {
          scope: authority().scope,
          usageId: input.usageId,
          coordinate: input.coordinate,
          kind: input.kind,
          resourceId: input.resourceId,
          nodeId: input.parentNodeId,
          variantId: input.variantId,
          props: input.props,
          createdAt: NOW,
        },
        insertion: {
          moduleId: 'fuma.component',
          component: {
            coordinate: input.coordinate,
            componentId: input.componentId,
            variantId: input.variantId,
          },
          props: input.props,
          parentNodeId: input.parentNodeId,
        },
      }
    },
  }
  const evidence: BackendCapabilityEvidencePort = {
    async admit(input) { evidenceEvents.push({ kind: 'admit', input }) },
    async record(input) {
      evidenceEvents.push({ kind: 'record', input })
      return { metered: true, audited: true }
    },
  }
  const registry = new ReviewedBackendCapabilityRegistry(() => new Date(NOW))
    .register(createInsertDataBackedSectionCapability(service as never))
  return { calls, evidenceEvents, evidence, registry }
}

describe('FUMA-086 reviewed AI backend capability boundary', () => {
  it('routes Site AI and MCP through one reviewed implementation with minimized scoped receipts', async () => {
    const h = fixture()
    const siteAi = await h.registry.invoke({
      ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
      rawInput: COMMAND,
      resolveAuthority: async () => authority('site-ai'),
      evidence: h.evidence,
    })
    const mcp = await h.registry.invoke({
      ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
      rawInput: { ...COMMAND, usageId: 'usage-086-mcp' },
      resolveAuthority: async () => authority('mcp'),
      evidence: h.evidence,
    })

    expect(h.calls).toHaveLength(2)
    expect((h.calls[0] as { action: string }).action).toBe('insert')
    expect((h.calls[1] as { action: string }).action).toBe('insert')
    expect(siteAi.receipt).toMatchObject({
      capabilityId: 'site.component-usage.insert',
      capabilityVersion: '1.0.0',
      channel: 'site-ai',
      metered: true,
      audited: true,
    })
    expect(mcp.receipt.channel).toBe('mcp')
    expect(siteAi.receipt.receiptId).not.toBe(mcp.receipt.receiptId)
    expect(JSON.stringify(siteAi)).not.toContain('organization-a')
    expect(JSON.stringify(siteAi)).not.toContain('owner-a')
    expect(JSON.stringify(siteAi)).not.toContain('session-site-ai')
    expect(h.evidenceEvents).toHaveLength(4)
  })

  it('rejects caller scope, SQL, credentials, and arbitrary filters before authority or repository contact', async () => {
    const h = fixture()
    let resolverCalls = 0
    for (const hostile of [
      { ...COMMAND, organizationId: 'organization-b' },
      { ...COMMAND, sql: 'select * from users' },
      { ...COMMAND, databaseUrl: 'postgres://attacker' },
      { ...COMMAND, filter: { tableName: 'users' } },
      { ...COMMAND, props: { secret: process.env.DATABASE_URL ?? 'credential' }, tenantId: 'site-b' },
    ]) {
      await expect(h.registry.invoke({
        ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
        rawInput: hostile,
        resolveAuthority: async () => { resolverCalls += 1; return authority() },
        evidence: h.evidence,
      })).rejects.toMatchObject({ code: 'invalid-contract' })
    }
    expect(resolverCalls).toBe(0)
    expect(h.calls).toHaveLength(0)
    expect(h.evidenceEvents).toHaveLength(0)
  })

  it('opens no PostgreSQL transaction for hostile direct-authority input', async () => {
    let databaseContacts = 0
    const db = {
      dialect: 'postgres',
      async transaction() { databaseContacts += 1; throw new Error('database must not be reached') },
      async unsafe() { databaseContacts += 1; throw new Error('database must not be reached') },
    }
    const runtime = new PostgresAiBackendCapabilityRuntime({
      db: db as never,
      components: { async execute() { throw new Error('domain must not be reached') } } as never,
      metering: { async record() { throw new Error('metering must not be reached') } },
      now: () => new Date(NOW),
    })
    await expect(runtime.insertDataBackedSection({
      conversationId: 'conversation-a',
      actorId: 'actor-a',
      operationId: 'operation-a',
      permissions: ['site.structure.edit'],
    }, { ...COMMAND, sql: 'delete from users' })).rejects.toThrow('input is invalid')
    expect(databaseContacts).toBe(0)
  })

  it('denies wrong profile, stale/revoked generation, missing grants, permissions, and impersonation before domain execution', async () => {
    const changes: Array<(value: TrustedBackendCapabilityAuthority) => TrustedBackendCapabilityAuthority> = [
      (value) => ({ ...value, scope: { ...value.scope, profileId: 'publication' }, state: 'revoked' }),
      (value) => ({ ...value, authorityRevision: 2 }),
      (value) => ({ ...value, grants: [] }),
      (value) => ({ ...value, permissions: [] }),
      (value) => ({ ...value, actor: { ...value.actor, impersonatorId: 'support-actor' } }),
    ]
    for (const change of changes) {
      const h = fixture()
      await expect(h.registry.invoke({
        ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
        rawInput: COMMAND,
        resolveAuthority: async () => change(authority()),
        evidence: h.evidence,
      })).rejects.toMatchObject({ code: expect.stringMatching(/denied|revoked/) })
      expect(h.calls).toHaveLength(0)
    }
  })

  it('requires strict TypeBox schemas and rejects permissive generic query contracts', () => {
    expect(() => assertStrictCapabilitySchema(InsertDataBackedSectionInputSchema, 'insert')).not.toThrow()
    expect(() => assertStrictCapabilitySchema(Type.Object({ query: Type.Unknown() }, {
      additionalProperties: false,
    }), 'generic-query')).toThrow('cannot use Unknown')
    expect(() => assertStrictCapabilitySchema(Type.Object({ table: Type.String() }), 'table-proxy'))
      .toThrow('additionalProperties: false')
  })

  it('rejects direct authority source patterns across every generated/imported frontend class', () => {
    const hostile: ReadonlyArray<readonly [string, string]> = [
      ['database-import', `import postgres from 'postgres'`],
      ['sql-surface', `const rows = db.unsafe('select * from users')`],
      ['connection-string', `const url = 'postgres://user:pass@db/site'`],
      ['environment-secret', `const key = process.env.PAYSTACK_SECRET_KEY`],
      ['filesystem-process', `import { execFile } from 'node:child_process'`],
      ['provider-sdk', `import Stripe from 'stripe'`],
      ['generated-server-code', `'use server'; export async function save() {}`],
      ['unrestricted-network', `await fetch('http://10.0.0.8/private')`],
    ]
    for (const kind of ['ai-generated', 'imported', 'tenant-authored', 'plugin-ui', 'exported'] as const) {
      for (const [code, source] of hostile) {
        expect(() => assertFrontendCapabilitySource({ kind, path: 'app/page.tsx', source }))
          .toThrow(expect.objectContaining({ code }))
      }
      expect(assertFrontendCapabilitySource({
        kind,
        path: 'components/team.tsx',
        source: `export function Team({ items }) { return <section>{items.map((item) => <p key={item.id}>{item.name}</p>)}</section> }`,
      })).toMatchObject({ kind, path: 'components/team.tsx' })
    }
  })
})
