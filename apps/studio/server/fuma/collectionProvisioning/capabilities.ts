/**
 * Reviewed collection provisioning capabilities.
 *
 * Exposes describe/provision/extend through the existing FUMA-086 registry so
 * Site AI, MCP, imported runtimes and export adapters share one implementation.
 * Schema mutation is owner-confirmed: creating or extending a collection changes
 * how stored rows are interpreted, so it is never silent.
 */
import type { TSchema } from '@core/utils/typeboxHelpers'
import type { BackendCapabilityMetadata } from '../aiBackendCapabilities/contracts'
import {
  ReviewedBackendCapabilityRegistry,
  type ReviewedBackendCapability,
} from '../aiBackendCapabilities/registry'
import {
  DescribeCollectionsInputSchema,
  DescribeCollectionsOutputSchema,
  ExtendCollectionInputSchema,
  ExtendCollectionOutputSchema,
  ProvisionCollectionInputSchema,
  ProvisionCollectionOutputSchema,
} from './contracts'
import type { CollectionProvisioningService } from './service'

const VERSION = '1.0.0'

export const COLLECTION_CAPABILITY_IDS = Object.freeze({
  describe: 'fuma.collections.describe',
  provision: 'fuma.collections.provision',
  extend: 'fuma.collections.extend',
} as const)

type CapabilityClass = BackendCapabilityMetadata['class']
type Profile = BackendCapabilityMetadata['profiles'][number]

type DefinitionInput = Readonly<{
  id: string
  title: string
  description: string
  class: CapabilityClass
  profiles?: readonly Profile[]
  permission: string
  classification?: BackendCapabilityMetadata['dataClassification']
  confirmation?: BackendCapabilityMetadata['confirmation']
  inputSchema: TSchema
  outputSchema: TSchema
  execute: ReviewedBackendCapability['execute']
}>

function metadata(input: DefinitionInput): BackendCapabilityMetadata {
  const write = input.class !== 'read'
  return {
    id: input.id,
    version: VERSION,
    title: input.title,
    description: input.description,
    class: input.class,
    // Modelling applies to both product profiles.
    profiles: [...(input.profiles ?? ['website', 'publication'])],
    channels: ['site-ai', 'mcp', 'imported-runtime', 'export-adapter'],
    requiredPermission: input.permission,
    grants: {
      siteAi: write ? 'ai.tools.write' : 'ai.chat',
      mcp: write ? 'site.mutate' : 'site.read',
      importedRuntime: write ? 'runtime.backend.write' : 'runtime.backend.read',
      exportAdapter: write ? 'export.backend.write' : 'export.backend.read',
    },
    dataClassification: input.classification ?? 'customer',
    confirmation: input.confirmation ?? 'none',
    limits: {
      inputBytes: write ? 131_072 : 8_192,
      outputBytes: 262_144,
      resultItems: 200,
      requestsPerMinute: write ? 20 : 120,
      timeoutMs: 10_000,
    },
    metering: { kind: 'ai', logicalCredits: 1, providerCredits: 1 },
    exportAdapter: { id: `${input.id}.adapter`, version: VERSION },
    state: 'active',
  }
}

function definition(input: DefinitionInput): ReviewedBackendCapability {
  return Object.freeze({
    metadata: metadata(input),
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    execute: input.execute,
  })
}

export function createCollectionCapabilities(
  service: CollectionProvisioningService,
): readonly ReviewedBackendCapability[] {
  return Object.freeze([
    definition({
      id: COLLECTION_CAPABILITY_IDS.describe,
      title: 'Describe collections',
      description: 'Lists editable collections and their presentation-safe fields so AI can bind real data.',
      class: 'read',
      permission: 'data.tables.read',
      inputSchema: DescribeCollectionsInputSchema,
      outputSchema: DescribeCollectionsOutputSchema,
      execute: (raw) => service.describe(raw),
    }),
    definition({
      id: COLLECTION_CAPABILITY_IDS.provision,
      title: 'Provision a collection',
      description: 'Creates a bounded content or record collection in the universal data model.',
      class: 'confirm',
      permission: 'data.tables.write',
      confirmation: 'owner',
      inputSchema: ProvisionCollectionInputSchema,
      outputSchema: ProvisionCollectionOutputSchema,
      execute: (raw) => service.provision(raw),
    }),
    definition({
      id: COLLECTION_CAPABILITY_IDS.extend,
      title: 'Extend a collection',
      description: 'Adds new fields to an existing collection. Additive only; never removes or retypes a field.',
      class: 'confirm',
      permission: 'data.tables.write',
      confirmation: 'owner',
      inputSchema: ExtendCollectionInputSchema,
      outputSchema: ExtendCollectionOutputSchema,
      execute: (raw) => service.extend(raw),
    }),
  ])
}

export function registerCollectionCapabilities(
  registry: ReviewedBackendCapabilityRegistry,
  service: CollectionProvisioningService,
): ReviewedBackendCapabilityRegistry {
  for (const capability of createCollectionCapabilities(service)) registry.register(capability)
  return registry
}

/** Schema powers deliberately withheld from AI, each with an explicit reason. */
export function collectionBlockingDiagnostic(functionName: string): string | null {
  const denied: Readonly<Record<string, string>> = Object.freeze({
    'collections.drop': 'Dropping a collection would destroy stored rows; use the admin Data workspace.',
    'collections.remove-field': 'Removing a field orphans stored cells; extension is additive only.',
    'collections.retype-field': 'Retyping a live field reinterprets stored cells and is refused.',
    'collections.sql': 'Direct SQL is never exposed; use reviewed collection capabilities.',
    'collections.rename-slug': 'Renaming a slug breaks published routes and relation targets.',
  })
  return denied[functionName] ?? null
}
