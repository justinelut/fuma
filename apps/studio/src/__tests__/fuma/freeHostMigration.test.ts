import { describe, expect, it } from 'bun:test'
import { freeHostAuthorityMigration } from '../../../server/fuma/db/migrations/000043_free_host_authority'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'

export const FREE_HOST_AUTHORITY_CHECKSUM = 'd41fda99a82a0e260d386c3feababfda65cb67b4972f88a24c33f3e555bb375b'

describe('FUMA-050 hosted migration 000043', () => {
  it('is additive, checksum-pinned, ordered, and finalized after live PostgreSQL acceptance', () => {
    expect(hostedMigrations).toContain(freeHostAuthorityMigration)
    expect(HOSTED_MIGRATION_CHECKSUMS[freeHostAuthorityMigration.id]).toBe(FREE_HOST_AUTHORITY_CHECKSUM)
    expect(hostedMigrationChecksum(freeHostAuthorityMigration.sql)).toBe(FREE_HOST_AUTHORITY_CHECKSUM)
    expect(() => assertHostedMigrationIsAdditive(freeHostAuthorityMigration)).not.toThrow()
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
  })

  it('adds current-generation, monotonic state authority and permanent operational reservations', () => {
    const sql = freeHostAuthorityMigration.sql.replaceAll(/\s+/g, ' ').toLowerCase()
    expect(sql).toContain('add column owner_generation bigint')
    expect(sql).toContain('add column allocation_version bigint not null default 1')
    expect(sql).toContain("where state = 'active' and owner_generation is not null")
    for (const label of ['auth', 'app', 'admin', 'www', 'api', 'status', 'support', 'mail', 'objects', 'webhooks']) {
      expect(sql).toContain(`'${label}'`)
    }
  })
})
