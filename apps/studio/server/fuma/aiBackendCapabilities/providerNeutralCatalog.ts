import type { TSchema } from '@core/utils/typeboxHelpers'
import type { BackendCapabilityMetadata } from './contracts'
import { ReviewedBackendCapabilityRegistry, type ReviewedBackendCapability } from './registry'
import type { ProviderNeutralPublicationAuthority } from './providerNeutralAdapters'
import {
  EvaluatePublicationAccessInputSchema,
  EvaluatePublicationAccessOutputSchema,
  GetPublicationContentInputSchema,
  GetPublicationContentOutputSchema,
  GetPublicationSettingsInputSchema,
  GetPublicationSettingsOutputSchema,
  ListNewslettersInputSchema,
  ListNewslettersOutputSchema,
  ListPublicationContentInputSchema,
  ListPublicationContentOutputSchema,
  ListPublicationTaxonomyInputSchema,
  ListPublicationTaxonomyOutputSchema,
  PROVIDER_NEUTRAL_CAPABILITY_IDS,
  PROVIDER_NEUTRAL_COVERAGE_MATRIX,
  PublicationAnalyticsReportInputSchema,
  PublicationAnalyticsReportOutputSchema,
  RequestPublicationInputSchema,
  RequestPublicationOutputSchema,
  SavePublicationDraftInputSchema,
  SavePublicationDraftOutputSchema,
  type EvaluatePublicationAccessInput,
  type ListPublicationContentInput,
  type PublicationAnalyticsReportInput,
  type RequestPublicationInput,
  type SavePublicationDraftInput,
} from './providerNeutralContracts'

const VERSION = '1.0.0'
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
    profiles: [...(input.profiles ?? ['publication'])],
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
      inputBytes: write ? 524_288 : 16_384,
      outputBytes: 524_288,
      resultItems: 500,
      requestsPerMinute: write ? 30 : 120,
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

/** Reviewed provider-neutral definitions. Every implementation delegates to the injected canonical graph. */
export function createProviderNeutralPublicationCapabilities(
  authority: ProviderNeutralPublicationAuthority,
): readonly ReviewedBackendCapability[] {
  return Object.freeze([
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent,
      title: 'List publication content',
      description: 'Lists a bounded page of posts/pages with safe SEO metadata.',
      class: 'read',
      permission: 'publication.posts.read',
      inputSchema: ListPublicationContentInputSchema,
      outputSchema: ListPublicationContentOutputSchema,
      execute: (raw, context) => authority.listContent(raw as ListPublicationContentInput, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.getContent,
      title: 'Get publication content',
      description: 'Reads one post/page without exposing repository or tenant authority.',
      class: 'read',
      permission: 'publication.posts.read',
      inputSchema: GetPublicationContentInputSchema,
      outputSchema: GetPublicationContentOutputSchema,
      execute: (raw, context) => authority.getContent((raw as { contentId: string }).contentId, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.saveDraft,
      title: 'Save publication draft',
      description: 'Saves bounded text content and reviewed SEO metadata through Publication editorial authority.',
      class: 'mutate',
      permission: 'publication.posts.write',
      inputSchema: SavePublicationDraftInputSchema,
      outputSchema: SavePublicationDraftOutputSchema,
      execute: (raw, context) => authority.saveDraft(raw as SavePublicationDraftInput, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.requestPublication,
      title: 'Request publication or schedule',
      description: 'Owner-confirmed immutable publication workflow transition.',
      class: 'confirm',
      permission: 'publication.posts.schedule',
      confirmation: 'owner',
      inputSchema: RequestPublicationInputSchema,
      outputSchema: RequestPublicationOutputSchema,
      execute: (raw, context) => authority.requestPublication(raw as RequestPublicationInput, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.listTaxonomy,
      title: 'List authors and tags',
      description: 'Lists bounded public author projections and tags; author email is omitted.',
      class: 'read',
      permission: 'publication.tags.read',
      inputSchema: ListPublicationTaxonomyInputSchema,
      outputSchema: ListPublicationTaxonomyOutputSchema,
      execute: (_raw, context) => authority.listTaxonomy(context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.getSettings,
      title: 'Get publication settings',
      description: 'Reads publication identity, language and timezone.',
      class: 'read',
      permission: 'publication.posts.read',
      inputSchema: GetPublicationSettingsInputSchema,
      outputSchema: GetPublicationSettingsOutputSchema,
      execute: (_raw, context) => authority.getSettings(context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.listNewsletters,
      title: 'List newsletters',
      description: 'Lists bounded newsletter metadata without recipients or provider data.',
      class: 'read',
      permission: 'publication.newsletters.read',
      inputSchema: ListNewslettersInputSchema,
      outputSchema: ListNewslettersOutputSchema,
      execute: (raw, context) => authority.listNewsletters((raw as { limit: number }).limit, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.evaluateAccess,
      title: 'Evaluate publication access',
      description: 'Evaluates current server-derived member authority for one content item.',
      class: 'read',
      permission: 'publication.members.read',
      classification: 'sensitive',
      inputSchema: EvaluatePublicationAccessInputSchema,
      outputSchema: EvaluatePublicationAccessOutputSchema,
      execute: (raw, context) => authority.evaluateAccess(raw as EvaluatePublicationAccessInput, context),
    }),
    definition({
      id: PROVIDER_NEUTRAL_CAPABILITY_IDS.analyticsReport,
      title: 'Read privacy analytics totals',
      description: 'Reads bounded aggregate conversion totals with no visitor identity.',
      class: 'read',
      profiles: ['website', 'publication'],
      permission: 'publication.analytics.read',
      inputSchema: PublicationAnalyticsReportInputSchema,
      outputSchema: PublicationAnalyticsReportOutputSchema,
      execute: (raw, context) => authority.analyticsReport(raw as PublicationAnalyticsReportInput, context),
    }),
  ])
}

export function registerProviderNeutralPublicationCapabilities(
  registry: ReviewedBackendCapabilityRegistry,
  authority: ProviderNeutralPublicationAuthority,
): ReviewedBackendCapabilityRegistry {
  for (const capability of createProviderNeutralPublicationCapabilities(authority)) registry.register(capability)
  return registry
}

export function providerNeutralBlockingDiagnostic(functionName: string): string | null {
  const row = PROVIDER_NEUTRAL_COVERAGE_MATRIX.find((candidate) => candidate.function === functionName)
  return row?.state === 'active' ? null : row?.diagnostic ?? 'CAPABILITY_FUNCTION_UNKNOWN'
}
