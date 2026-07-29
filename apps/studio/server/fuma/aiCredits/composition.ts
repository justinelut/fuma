import { AI_BYOK_TRANSFER_STEP_ID, AI_BYOK_TRANSFER_STEP_ORDER } from './transferStep'
import { AI_CREDIT_EXPIRY_JOB_KIND } from './jobs'
import { aiCatalogAuthorityMigration } from '../db/migrations/000063_ai_catalog_authority'
import { aiCreditsAuthorityMigration } from '../db/migrations/000066_ai_credits_authority'
import { siteAiScopeAuthorityMigration } from '../db/migrations/000068_site_ai_scope_authority'
import { mcpConnectorAuthorityMigration } from '../db/migrations/000069_mcp_connector_authority'
import { MCP_TRANSFER_STEP_ID, MCP_TRANSFER_STEP_ORDER } from '../mcp/transferStep'

export const NATIVE_AI_AUTHORITY_MIGRATIONS = Object.freeze([
  aiCatalogAuthorityMigration,
  aiCreditsAuthorityMigration,
  siteAiScopeAuthorityMigration,
  mcpConnectorAuthorityMigration,
])

export const NATIVE_AI_SCOPED_ROUTE_GROUPS = Object.freeze([
  'ai-credits',
  'mcp-connectors',
] as const)

export const NATIVE_AI_RUNTIME_SCOPES = Object.freeze([
  'site-ai',
  'site-mcp',
] as const)

export const NATIVE_AI_JOB_KINDS = Object.freeze([
  AI_CREDIT_EXPIRY_JOB_KIND,
] as const)

export const NATIVE_AI_TRANSFER_STEPS = Object.freeze([
  Object.freeze({
    stepId: AI_BYOK_TRANSFER_STEP_ID,
    order: AI_BYOK_TRANSFER_STEP_ORDER,
    choices: Object.freeze(['rekey', 'detach'] as const),
  }),
  Object.freeze({
    stepId: MCP_TRANSFER_STEP_ID,
    order: MCP_TRANSFER_STEP_ORDER,
    choices: Object.freeze(['rescope', 'revoke'] as const),
  }),
])

/** Conductor-owned inventory for the one native AI runtime. */
export function describeNativeAiPhase() {
  return Object.freeze({
    tickets: Object.freeze(['FUMA-063', 'FUMA-064', 'FUMA-065', 'FUMA-066'] as const),
    migrationIds: Object.freeze(NATIVE_AI_AUTHORITY_MIGRATIONS.map(({ id }) => id)),
    routeGroups: NATIVE_AI_SCOPED_ROUTE_GROUPS,
    runtimeScopes: NATIVE_AI_RUNTIME_SCOPES,
    jobs: NATIVE_AI_JOB_KINDS,
    transferSteps: NATIVE_AI_TRANSFER_STEPS,
    reusesNativeAiRuntime: true as const,
    reusesNativeMcpRuntime: true as const,
    providerCallsDuringComposition: false as const,
  })
}
