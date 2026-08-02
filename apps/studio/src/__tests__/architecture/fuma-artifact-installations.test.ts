import { describe, expect, it } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  ArtifactInstallationSchema,
  ArtifactReleaseSchema,
} from '../../../server/fuma/artifacts'
import { artifactInstallationAuthorityMigration } from '../../../server/fuma/db/migrations/000070_artifact_installation_authority'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'

const root = resolve(import.meta.dir, '../../../../..')
const text = (path: string) => readFile(resolve(root, path), 'utf8')

const baseArtifact = {
  schemaVersion: 1,
  artifactId: 'artifact-a',
  packageId: 'package-a',
  exactVersion: '1.0.0',
  objectKey: 'artifacts/plugin/package-a/1.0.0.zip',
  mimeType: 'application/zip',
  contentHashSha256: 'a'.repeat(64),
  sizeBytes: 10,
  permissions: [],
  provenance: { sourceHashSha256: 'b'.repeat(64), lockHashSha256: 'c'.repeat(64), builderId: 'builder-a' },
  createdAt: '2026-07-29T12:00:00.000Z',
} as const

const baseInstallation = {
  platformId: 'fuma', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 1,
  installationId: 'installation-a', artifactId: 'artifact-a', packageId: 'package-a', exactVersion: '1.0.0', contentHashSha256: 'a'.repeat(64),
  settingsObjectKey: 'artifact-installations/a/settings.json', state: 'active', quota: { storageBytes: 100, scheduledJobs: 1, callsPerMinute: 1 },
  previousArtifactId: null, version: 1, installedAt: '2026-07-29T12:00:00.000Z', updatedAt: '2026-07-29T12:00:00.000Z',
} as const

describe('FUMA-067 artifact installation architecture', () => {
  it('supports plugin and component-pack artifacts through one strict TypeBox authority', async () => {
    const plugin = { ...baseArtifact, kind: 'plugin', executionPolicy: 'plugin-sandbox-worker' }
    const pack = { ...baseArtifact, artifactId: 'artifact-pack', kind: 'component-pack', executionPolicy: 'component-declarative', objectKey: 'artifacts/component-pack/package-a/1.0.0.json', mimeType: 'application/json' }
    expect(safeParseValue(ArtifactReleaseSchema, plugin).ok).toBe(true)
    expect(safeParseValue(ArtifactReleaseSchema, pack).ok).toBe(true)
    expect(safeParseValue(ArtifactInstallationSchema, { ...baseInstallation, artifactKind: 'plugin', executionPolicy: 'plugin-sandbox-worker', secret: null, workerGeneration: 1 }).ok).toBe(true)
    expect(safeParseValue(ArtifactInstallationSchema, { ...baseInstallation, artifactId: 'artifact-pack', artifactKind: 'component-pack', executionPolicy: 'component-declarative', secret: null, workerGeneration: null }).ok).toBe(true)

    const files = await readdir(resolve(root, 'apps/studio/server/fuma/artifacts'))
    expect(files.filter((file) => file.endsWith('.ts')).sort()).toEqual(['contracts.ts', 'index.ts', 'objectStore.ts', 'postgres.ts', 'runtime.ts', 'service.ts'])
    const sources = await Promise.all(files.filter((file) => file.endsWith('.ts')).map((file) => text(`apps/studio/server/fuma/artifacts/${file}`)))
    expect(sources.join('\n')).not.toMatch(/\bzod\b|from ['"]zod['"]/i)
  })

  it('never promotes declarative component packs into workers, schedules, secrets, or crash state', async () => {
    const contracts = await text('apps/studio/server/fuma/artifacts/contracts.ts')
    const service = await text('apps/studio/server/fuma/artifacts/service.ts')
    const runtime = await text('apps/studio/server/fuma/artifacts/runtime.ts')
    expect(contracts).toContain("Type.Literal('component-pack')")
    expect(contracts).toContain("artifact.executionPolicy !== 'plugin-sandbox-worker'")
    expect(contracts).toContain('Component packs cannot own workers, secrets, or crash state.')
    expect(service).toContain("installation.artifactKind !== 'plugin'")
    expect(service).toContain('Only active sandboxed plugins may own schedules.')
    expect(runtime).toContain("input.installation.artifactKind !== 'plugin'")
    expect(runtime).not.toMatch(/new\s+(?:Worker|QuickJS)|create.*(?:Worker|QuickJS)/)
  })

  it('reuses the existing native plugin worker and activates one production authority at central startup', async () => {
    const runtime = await text('apps/studio/server/fuma/artifacts/runtime.ts')
    const startup = await text('apps/studio/server/index.ts')
    const nativeRpc = await text('apps/studio/server/plugins/host/rpc.ts')
    expect(runtime).toContain("from '../../plugins/host/rpc'")
    expect(runtime).toContain('runScheduleInWorker({')
    expect(runtime).toContain('new PostgresArtifactAuthorityRepository(input.db)')
    expect(runtime).toContain('new TenantSharedArtifactObjectStore(storage')
    expect(nativeRpc).toContain('export async function runScheduleInWorker')
    expect(startup.match(/createHostedArtifactRuntime\(\{/g)).toHaveLength(1)
    expect(startup).toContain('artifacts: hostedArtifactRuntime.authority')
  })

  it('keeps immutable shared package bytes separate from generation-qualified installation state', async () => {
    const service = await text('apps/studio/server/fuma/artifacts/service.ts')
    const repository = await text('apps/studio/server/fuma/artifacts/postgres.ts')
    const objects = await text('apps/studio/server/fuma/artifacts/objectStore.ts')
    expect(service).toContain('Stored artifact bytes failed integrity verification.')
    expect(service).toContain('Plugin secret must be re-encrypted for the destination owner.')
    expect(repository).toContain('owner_generation=${next.ownerGeneration}')
    expect(repository).toContain('Artifact transfer receipt fence changed.')
    expect(repository).toContain('Plugin schedule quota is exhausted.')
    expect(objects).toContain('putIfAbsent')
    expect(objects).toContain('Immutable shared artifact failed integrity verification.')
  })

  it('registers additive 000070 after 000069 with immutable tables and plugin-only child constraints', () => {
    expect(artifactInstallationAuthorityMigration.id).toBe('000070_artifact_installation_authority')
    const migrationIndex = hostedMigrations.indexOf(artifactInstallationAuthorityMigration)
    expect(hostedMigrations[migrationIndex - 1]?.id).toBe('000069_mcp_connector_authority')
    expect(hostedMigrations[migrationIndex + 1]?.id).toBe('000071_artifact_review_marketplace')
    expect(() => assertHostedMigrationIsAdditive(artifactInstallationAuthorityMigration)).not.toThrow()
    expect(hostedMigrationChecksum(artifactInstallationAuthorityMigration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[artifactInstallationAuthorityMigration.id])
    for (const table of ['fuma_artifact_releases_v2', 'fuma_artifact_installations_v2', 'fuma_artifact_schedules_v2', 'fuma_artifact_crashes_v2', 'fuma_artifact_storage_usage_v2', 'fuma_artifact_call_windows_v2', 'fuma_artifact_transfer_receipts_v2']) {
      expect(artifactInstallationAuthorityMigration.sql).toContain(`create table ${table}`)
    }
    expect(artifactInstallationAuthorityMigration.sql).toContain("artifact_kind text not null default 'plugin' check (artifact_kind='plugin')")
    expect(artifactInstallationAuthorityMigration.sql).toContain('owner_generation,installation_id,artifact_kind')
    expect(artifactInstallationAuthorityMigration.sql).toContain('fuma_artifact_release_immutable_v2')
    expect(artifactInstallationAuthorityMigration.sql).toContain('fuma_artifact_installation_guard_v2')
  })

  it('extends the existing marketplace seams instead of creating a second component authority', async () => {
    const sdk = await text('docs/reference/fuma-component-pack-sdk.md')
    const umbrella = await text('docs/reference/fuma-tenant-react-runtime-component-marketplace.md')
    const artifacts = await text('apps/studio/server/fuma/artifacts/index.ts')
    expect(sdk).toContain('FUMA-067')
    expect(sdk).toContain('FUMA-068')
    expect(umbrella).toContain('no second signing or marketplace authority is created')
    expect(artifacts).toContain("export * from './runtime'")
    expect(artifacts).not.toMatch(/ComponentMarketplace|ComponentSigning|componentPackAuthority/)
  })
})
