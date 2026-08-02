import { describe, expect, test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient, DbResult } from '../../../server/db/client'
import { nextSourceAdaptationTool } from '../../../server/ai/tools/site/nextSourceAdaptationTool'
import { NextSourceAdaptationCommandSchema } from '../../../server/ai/tools/site/nextSourceAdaptationPort'
import { PostgresNextSourceAdaptationAuthority, type NextSourceScope } from '../../../server/fuma/nextSource'

function result<Row>(rows: Row[]): DbResult<Row> {
  return { rows, rowCount: rows.length }
}

function fakeDb(unsafe: DbClient['unsafe']): DbClient {
  const db = (async () => result([])) as DbClient
  db.unsafe = unsafe
  db.transaction = async <T>(work: (tx: DbClient) => Promise<T>) => work(db)
  Object.defineProperty(db, 'dialect', { value: 'postgres' })
  return db
}

const scope: NextSourceScope = Object.freeze({
  platformId: 'platform-main',
  organizationId: 'organization-main',
  workspaceId: 'workspace-main',
  siteId: 'site-main',
  ownerKey: 'owner-key-main',
  ownerGeneration: 7,
  profileId: 'website',
})

const destination = Object.freeze({
  organizationId: scope.organizationId,
  workspaceId: scope.workspaceId,
  siteId: scope.siteId,
})

describe('FUMA-077 native AI/MCP source adaptation authority', () => {
  test('registers one strict server-side mutating tool without caller authority flags', () => {
    expect(nextSourceAdaptationTool.name).toBe('site_propose_source_fix')
    expect(nextSourceAdaptationTool.execution).toBe('server')
    expect(nextSourceAdaptationTool.mutates).toBe(true)
    expect(nextSourceAdaptationTool.requiredCapabilities).toEqual(['site.structure.edit'])
    const command = {
      revisionId: 'next-draft:revision',
      diagnosticIds: ['unsupported-client-library'],
      patches: [{
        path: 'app/page.tsx',
        expectedSha256: 'a'.repeat(64),
        replacement: 'export default function Page() { return null }',
      }],
    }
    expect(safeParseValue(NextSourceAdaptationCommandSchema, command).ok).toBe(true)
    expect(safeParseValue(NextSourceAdaptationCommandSchema, { ...command, ownerGeneration: 7 }).ok).toBe(false)
    expect(safeParseValue(NextSourceAdaptationCommandSchema, { ...command, authority: true }).ok).toBe(false)
  })

  test('binds AI authority to the exact started mutating tool receipt and running metered job', async () => {
    const queries: string[] = []
    const parameters: readonly unknown[][] = []
    const db = fakeDb(async <Row>(query: string, values?: readonly unknown[]) => {
      queries.push(query)
      parameters.push(values ?? [])
      if (query.includes('fuma_next_source_fixes_v1')) return result<Row>([])
      return result([{ accepted: true } as Row])
    })
    const authority = new PostgresNextSourceAdaptationAuthority({ db, scope })
    const decision = await authority.authorize({
      kind: 'ai',
      actorId: 'ai-actor',
      operationId: 'provider-tool-call-1',
      sourceRevisionId: 'next-draft:revision',
      destination,
      ownerGeneration: scope.ownerGeneration,
      capability: 'source.mutate',
      meteringReservationId: 'reservation-ai-1',
    })
    expect(decision).toEqual({ replayReceiptId: null, active: true, meteringAccepted: true })
    expect(queries[1]).toContain('tool.tool_call_id=$1')
    expect(queries[1]).toContain("tool.tool_name='site_propose_source_fix'")
    expect(queries[1]).toContain("tool.state='started'")
    expect(queries[1]).toContain('tool.mutates=true')
    expect(queries[1]).toContain("job.state='running'")
    expect(queries[1]).toContain("job.required_capability='ai.tools.write'")
    expect(queries[1]).toContain('job.reservation_id=$10')
    expect(parameters[1]?.[0]).toBe('provider-tool-call-1')
    expect(parameters[1]?.[9]).toBe('reservation-ai-1')
  })

  test('binds MCP authority to the exact started named operation receipt and active connector session', async () => {
    const queries: string[] = []
    const db = fakeDb(async <Row>(query: string) => {
      queries.push(query)
      if (query.includes('fuma_next_source_fixes_v1')) return result<Row>([])
      return result([{ accepted: true } as Row])
    })
    const authority = new PostgresNextSourceAdaptationAuthority({ db, scope })
    const decision = await authority.authorize({
      kind: 'mcp',
      actorId: 'mcp-actor',
      operationId: 'mcp-operation-1',
      sourceRevisionId: 'next-draft:revision',
      destination,
      ownerGeneration: scope.ownerGeneration,
      capability: 'source.mutate',
      meteringReservationId: 'reservation-mcp-1',
    })
    expect(decision).toEqual({ replayReceiptId: null, active: true, meteringAccepted: true })
    expect(queries[1]).toContain('receipt.operation_id=$1')
    expect(queries[1]).toContain("receipt.tool_name='site_propose_source_fix'")
    expect(queries[1]).toContain("receipt.capability='mutate'")
    expect(queries[1]).toContain("receipt.state='started'")
    expect(queries[1]).toContain("session.state='active'")
    expect(queries[1]).toContain("binding.state='active'")
  })

  test('fails closed without metering and requires one unambiguous receipt row', async () => {
    let authorityRows = 0
    const db = fakeDb(async <Row>(query: string) => {
      if (query.includes('fuma_next_source_fixes_v1')) return result<Row>([])
      return result(Array.from({ length: authorityRows }, () => ({ accepted: true } as Row)))
    })
    const authority = new PostgresNextSourceAdaptationAuthority({ db, scope })
    const base = {
      kind: 'ai' as const,
      actorId: 'ai-actor',
      operationId: 'provider-tool-call-1',
      sourceRevisionId: 'next-draft:revision',
      destination,
      ownerGeneration: scope.ownerGeneration,
      capability: 'source.mutate' as const,
    }
    expect((await authority.authorize({ ...base, meteringReservationId: null })).active).toBe(false)
    authorityRows = 2
    expect((await authority.authorize({ ...base, meteringReservationId: 'reservation-ai-1' })).active).toBe(false)
  })
})
