import { describe, expect, it } from 'bun:test'
import { HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import { hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { COMMERCIAL_EDGE_TRANSFER_STEPS } from '../../../server/fuma/commercialEdgePhase/composition'
import {
  NATIVE_AI_AUTHORITY_MIGRATIONS,
  NATIVE_AI_JOB_KINDS,
  NATIVE_AI_RUNTIME_SCOPES,
  NATIVE_AI_TRANSFER_STEPS,
  describeNativeAiPhase,
} from '../../../server/fuma/aiCredits/composition'

describe('FUMA-063/FUMA-064/FUMA-065/FUMA-066 native AI phase composition', () => {
  it('registers the finalized catalog, credit, site-scope, and MCP authorities with exact checksums', () => {
    expect(NATIVE_AI_AUTHORITY_MIGRATIONS.map(({ id }) => id)).toEqual([
      '000063_ai_catalog_authority',
      '000066_ai_credits_authority',
      '000068_site_ai_scope_authority',
      '000069_mcp_connector_authority',
    ])
    for (const migration of NATIVE_AI_AUTHORITY_MIGRATIONS) {
      expect(hostedMigrationChecksum(migration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[migration.id])
    }
  })

  it('declares both native site scopes, one protected expiry job, and collision-free transfer steps', () => {
    expect(NATIVE_AI_RUNTIME_SCOPES).toEqual(['site-ai', 'site-mcp'])
    expect(NATIVE_AI_JOB_KINDS).toEqual(['fuma.ai-credit-expiry'])
    expect(NATIVE_AI_TRANSFER_STEPS).toEqual([{
      stepId: 'ai-credit-byok-rekey-detach',
      order: 615,
      choices: ['rekey', 'detach'],
    }, {
      stepId: 'mcp-connector-rescope-revoke',
      order: 617,
      choices: ['rescope', 'revoke'],
    }])
    const commercialOrders = new Set(COMMERCIAL_EDGE_TRANSFER_STEPS.map(({ order }) => order))
    for (const step of NATIVE_AI_TRANSFER_STEPS) expect(commercialOrders.has(step.order)).toBe(false)
  })

  it('preserves the existing native runtime and performs no provider call during composition', () => {
    expect(describeNativeAiPhase()).toMatchObject({
      tickets: ['FUMA-063', 'FUMA-064', 'FUMA-065', 'FUMA-066'],
      routeGroups: ['ai-credits', 'mcp-connectors'],
      runtimeScopes: ['site-ai', 'site-mcp'],
      reusesNativeAiRuntime: true,
      reusesNativeMcpRuntime: true,
      providerCallsDuringComposition: false,
    })
  })
})
