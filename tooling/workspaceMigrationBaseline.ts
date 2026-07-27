import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
} from '../apps/studio/server/fuma/db/migrations'

export const STUDIO_ROOT = 'apps/studio' as const

export const HISTORICAL_MIGRATION_SOURCE_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'apps/studio/server/db/migrations-pg.ts': '428010a428294c6b434956eb5e00aba682b7359107eb4fbf1732d8dac774cf34',
  'apps/studio/server/db/migrations-sqlite.ts': 'e5ae1d091f5b385ef55e4a8928e5f60e223a6a5094df3132f69f8aa7404ad150',
})

export type WorkspaceMigrationPathEvidence = Readonly<{
  preRelocationPath: string
  currentPath: string
}>

export type HistoricalMigrationBaseline = WorkspaceMigrationPathEvidence & Readonly<{
  sha256: string
}>

export type HostedMigrationBaseline = WorkspaceMigrationPathEvidence & Readonly<{
  id: string
  checksum: string
}>

const moved = (preRelocationPath: string): string => `${STUDIO_ROOT}/${preRelocationPath}`

/**
 * FUMA-WEB-001 evidence after the FUMA-WEB-002 mechanical move. Historical
 * hashes remain one shared authority. Hosted IDs/checksums project directly
 * from the canonical Studio migration manifest rather than being copied.
 */
export const WORKSPACE_MIGRATION_BASELINE = Object.freeze({
  capturedAtStage: 'FUMA-WEB-001-pre-relocation' as const,
  relocationTask: 'FUMA-WEB-002' as const,
  studioRoot: STUDIO_ROOT,
  hostedHighWaterMark: '000009_tenant_keys' as const,
  canonicalHostedApi: Object.freeze([
    {
      preRelocationPath: 'server/fuma/db/migrationPolicy.ts',
      currentPath: moved('server/fuma/db/migrationPolicy.ts'),
    },
    {
      preRelocationPath: 'server/fuma/db/migrations/index.ts',
      currentPath: moved('server/fuma/db/migrations/index.ts'),
    },
  ]),
  historicalMigrations: Object.freeze(Object.entries(HISTORICAL_MIGRATION_SOURCE_HASHES).map(([currentPath, sha256]) => Object.freeze({
    preRelocationPath: currentPath.slice(`${STUDIO_ROOT}/`.length),
    currentPath,
    sha256,
  } satisfies HistoricalMigrationBaseline))),
  hostedMigrations: Object.freeze(hostedMigrations.map(({ id }) => {
    const preRelocationPath = `server/fuma/db/migrations/${id}.ts`
    return Object.freeze({
      id,
      checksum: HOSTED_MIGRATION_CHECKSUMS[id] ?? '',
      preRelocationPath,
      currentPath: moved(preRelocationPath),
    } satisfies HostedMigrationBaseline)
  })),
})
