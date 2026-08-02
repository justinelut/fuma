import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  HISTORICAL_MIGRATION_SOURCE_HASHES,
  WORKSPACE_MIGRATION_BASELINE,
} from '../../../../../tooling/workspaceMigrationBaseline'

const WORKSPACE_ROOT = join(import.meta.dir, '../../../../..')

function sha256(source: string): string {
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}

describe('FUMA-WEB-001/002 migration relocation baseline', () => {
  test('moves every canonical migration source only to apps/studio', () => {
    const pathEvidence = [
      ...WORKSPACE_MIGRATION_BASELINE.canonicalHostedApi,
      ...WORKSPACE_MIGRATION_BASELINE.historicalMigrations,
      ...WORKSPACE_MIGRATION_BASELINE.hostedMigrations,
    ]

    expect(WORKSPACE_MIGRATION_BASELINE.capturedAtStage).toBe('FUMA-WEB-001-pre-relocation')
    expect(WORKSPACE_MIGRATION_BASELINE.relocationTask).toBe('FUMA-WEB-002')
    expect(WORKSPACE_MIGRATION_BASELINE.studioRoot).toBe('apps/studio')

    for (const evidence of pathEvidence) {
      expect(evidence.currentPath).toBe(`apps/studio/${evidence.preRelocationPath}`)
      expect(existsSync(join(WORKSPACE_ROOT, evidence.currentPath)), `${evidence.currentPath} must exist after FUMA-WEB-002`).toBe(true)
      expect(existsSync(join(WORKSPACE_ROOT, evidence.preRelocationPath)), `${evidence.preRelocationPath} must not remain as a second source`).toBe(false)
    }
  })

  test('preserves the exact historical PostgreSQL source hash', () => {
    expect(WORKSPACE_MIGRATION_BASELINE.historicalMigrations.map(({ currentPath, sha256: digest }) => [currentPath, digest])).toEqual(
      Object.entries(HISTORICAL_MIGRATION_SOURCE_HASHES),
    )
    for (const migration of WORKSPACE_MIGRATION_BASELINE.historicalMigrations) {
      const source = readFileSync(join(WORKSPACE_ROOT, migration.currentPath), 'utf8')
      expect(sha256(source), `${migration.currentPath} immutable SHA-256`).toBe(migration.sha256)
      expect(sha256(`${source}\n-- hostile rewrite`)).not.toBe(migration.sha256)
    }
  })

  test('preserves canonical hosted history through 000009', () => {
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
    expect(runnableHostedMigrations).toEqual(hostedMigrations.slice(0, 77))
    expect(runnableHostedMigrations).toHaveLength(77)
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000077_public_handoff_authority')
    const relocationBaseline = WORKSPACE_MIGRATION_BASELINE.hostedMigrations.filter(
      ({ id }) => id <= WORKSPACE_MIGRATION_BASELINE.hostedHighWaterMark,
    )
    const hostedBaselinePrefix = hostedMigrations.slice(0, relocationBaseline.length)
    expect(relocationBaseline.map(({ id }) => id)).toEqual(
      hostedBaselinePrefix.map(({ id }) => id),
    )
    expect(relocationBaseline.map(({ checksum }) => checksum)).toEqual(
      hostedBaselinePrefix.map(({ id }) => HOSTED_MIGRATION_CHECKSUMS[id]),
    )
    expect(relocationBaseline.at(-1)?.id).toBe(WORKSPACE_MIGRATION_BASELINE.hostedHighWaterMark)
    for (const migration of hostedBaselinePrefix) {
      const baseline = WORKSPACE_MIGRATION_BASELINE.hostedMigrations.find(({ id }) => id === migration.id)
      expect(hostedMigrationChecksum(migration.sql)).toBe(baseline?.checksum)
      expect(hostedMigrationChecksum(`${migration.sql}\n-- hostile rewrite`)).not.toBe(baseline?.checksum)
    }
  })

  test('rejects hostile hosted ID, order, checksum, and high-water substitutions', () => {
    const expectedIds = WORKSPACE_MIGRATION_BASELINE.hostedMigrations.map(({ id }) => id)
    expect(expectedIds.with(0, '000001_substituted')).not.toEqual(expectedIds)
    expect([...expectedIds].reverse()).not.toEqual(expectedIds)
    expect({ ...HOSTED_MIGRATION_CHECKSUMS, [expectedIds[0]]: '0'.repeat(64) }).not.toEqual(HOSTED_MIGRATION_CHECKSUMS)
    expect('000010_unapproved').not.toBe(WORKSPACE_MIGRATION_BASELINE.hostedHighWaterMark)
  })
})
