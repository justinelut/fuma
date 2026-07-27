import { TENANT_RESOURCE_INVENTORY } from './inventory'

export type FumaRepositoryScopeCoverage = Readonly<{
  classId: string
  family: 'site' | 'content' | 'media' | 'publish' | 'plugins' | 'ai-mcp' | 'objects'
}>

/**
 * Exhaustive scoping-obligation and coverage-policy registry for persisted
 * site-owned resources. A registry entry does not claim that a legacy
 * repository is converted: each later domain implementation must consume an
 * exact FumaRepositoryScope before hosted use. Runtime wiring remains FUMA-026.
 */
export const FUMA_REPOSITORY_SCOPE_COVERAGE = Object.freeze([
  { classId: 'ai-mcp.connector', family: 'ai-mcp' },
  { classId: 'ai-mcp.conversation', family: 'ai-mcp' },
  { classId: 'ai-mcp.default', family: 'ai-mcp' },
  { classId: 'ai-mcp.message', family: 'ai-mcp' },
  { classId: 'content.data-row', family: 'content' },
  { classId: 'content.data-row-redirect', family: 'content' },
  { classId: 'content.data-row-version', family: 'content' },
  { classId: 'content.data-table', family: 'content' },
  { classId: 'media.asset', family: 'media' },
  { classId: 'media.asset-folder', family: 'media' },
  { classId: 'media.folder', family: 'media' },
  { classId: 'media.smart-folder', family: 'media' },
  { classId: 'media.storage-adapter-election', family: 'media' },
  { classId: 'media.usage-ref', family: 'media' },
  { classId: 'media.variant-delegate-election', family: 'media' },
  { classId: 'objects.ai-artifact', family: 'objects' },
  { classId: 'objects.content-revision', family: 'objects' },
  { classId: 'objects.export-artifact', family: 'objects' },
  { classId: 'objects.form-attachment', family: 'objects' },
  { classId: 'objects.import-artifact', family: 'objects' },
  { classId: 'objects.mcp-artifact', family: 'objects' },
  { classId: 'objects.media', family: 'objects' },
  { classId: 'objects.plugin-artifact', family: 'objects' },
  { classId: 'objects.plugin-installation-artifact', family: 'objects' },
  { classId: 'objects.publish-release', family: 'objects' },
  { classId: 'plugins.crash-event', family: 'plugins' },
  { classId: 'plugins.installation', family: 'plugins' },
  { classId: 'plugins.record', family: 'plugins' },
  { classId: 'plugins.schedule', family: 'plugins' },
  { classId: 'plugins.schedule-run', family: 'plugins' },
  { classId: 'plugins.secret', family: 'plugins' },
  { classId: 'publish.runtime-asset', family: 'publish' },
  { classId: 'publish.site-snapshot', family: 'publish' },
  { classId: 'site.audit-event', family: 'site' },
  { classId: 'site.shell', family: 'site' },
  { classId: 'site.sync-state', family: 'site' },
] satisfies readonly FumaRepositoryScopeCoverage[])

const requiredClassIds = TENANT_RESOURCE_INVENTORY
  .filter((entry) => entry.ownerLevel === 'site'
    && (entry.storageKind === 'table-row' || entry.storageKind === 'object'))
  .map(({ id }) => id)
  .toSorted()
const coveredClassIds = FUMA_REPOSITORY_SCOPE_COVERAGE.map(({ classId }) => classId).toSorted()

if (JSON.stringify(coveredClassIds) !== JSON.stringify(requiredClassIds)) {
  throw new Error('FUMA repository-scope coverage must exactly match the site-owned tenant inventory.')
}
