import { describe, expect, it } from 'bun:test'
import { emailDnsInstructionsMigration } from '../../../server/fuma/db/migrations/000085_email_dns_instructions'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  HOSTED_MIGRATION_CHECKSUM_SENTINEL,
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'

const sql = emailDnsInstructionsMigration.sql

describe('migration policy compliance', () => {
  it('is additive and forward-only', () => {
    // The reason a v2 table exists at all: dropping the legacy check constraint or
    // replacing its primary key is not available under this policy.
    expect(() => assertHostedMigrationIsAdditive(emailDnsInstructionsMigration)).not.toThrow()
  })

  it('is registered last in the manifest', () => {
    expect(hostedMigrations[hostedMigrations.length - 1]?.id)
      .toBe('000085_email_dns_instructions')
  })

  it('keeps the manifest valid', () => {
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
  })

  it('records the checksum of its own SQL, so an edit cannot pass unnoticed', () => {
    // FINALISED rather than held behind the sentinel, and the repository's own invariant is what
    // decided that: tenantKeyMigration asserts runnableHostedMigrations EQUALS hostedMigrations, so a
    // registered migration parked behind a sentinel leaves that gate failing and reads as a broken
    // migration index. The sentinel is for the review window, not a resting state.
    //
    // Asserted by DERIVATION rather than against a literal: comparing the recorded checksum to the
    // SQL's own checksum means editing the SQL without re-finalising fails here, which is the property
    // the checksum exists for. A pinned literal would only restate itself.
    expect(HOSTED_MIGRATION_CHECKSUMS['000085_email_dns_instructions'])
      .toBe(hostedMigrationChecksum(emailDnsInstructionsMigration.sql))
    expect(HOSTED_MIGRATION_CHECKSUMS['000085_email_dns_instructions'])
      .not.toBe(HOSTED_MIGRATION_CHECKSUM_SENTINEL)
  })

  it('is the last runnable migration, so nothing was inserted ahead of accepted history', () => {
    // Appending is the only additive position; an insertion would renumber accepted migrations.
    expect(runnableHostedMigrations.length).toBe(hostedMigrations.length)
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000085_email_dns_instructions')
  })

  it('leaves the legacy table untouched', () => {
    // The legacy table stays immutable; authority moves to v2 after the backfill.
    expect(sql).not.toMatch(/alter\s+table\s+fuma_domain_dns_instructions\b/i)
  })
})

describe('what the new table must express', () => {
  it('permits MX, which the legacy table did not', () => {
    expect(sql).toMatch(/record_type\s+in\s*\(\s*'CNAME','TXT','A','MX'\s*\)/)
  })

  it('adds the email purposes', () => {
    for (const purpose of ['mail-routing', 'spf', 'dkim', 'dmarc', 'autodiscover']) {
      expect(sql).toContain(`'${purpose}'`)
    }
  })

  it('keeps the legacy purposes so backfilled rows remain valid', () => {
    for (const purpose of ['routing', 'ownership', 'tls-validation']) {
      expect(sql).toContain(`'${purpose}'`)
    }
  })

  it('includes value in the primary key so a full MX set survives', () => {
    // The defect this migration exists to fix: the legacy key
    // (domain_id, record_type, name, purpose) holds ONE of a provider's MX records
    // and loses the rest, breaking mail failover invisibly.
    expect(sql).toContain('primary key(domain_id,record_type,name,purpose,value)')
  })

  it('excludes priority from the primary key', () => {
    // PostgreSQL forces every primary-key column NOT NULL, which would contradict the
    // rule that non-MX records carry no preference. Verified against a real database.
    expect(sql).not.toMatch(/primary key\([^)]*priority[^)]*\)/)
  })

  it('requires a preference on MX and forbids one elsewhere', () => {
    expect(sql).toContain('fuma_dns_v2_mx_requires_priority')
  })

  it('enforces one SPF record per domain in the database', () => {
    // Two SPF TXT records make the domain's SPF invalid outright, so this cannot be
    // left to application convention.
    expect(sql).toContain('fuma_dns_v2_single_spf_idx')
    expect(sql).toMatch(/unique index[\s\S]*?where purpose='spf'/)
  })

  it('indexes mail routing by preference, matching how it is read', () => {
    expect(sql).toContain('fuma_dns_v2_mail_routing_idx')
    expect(sql).toMatch(/\(domain_id,priority\)/)
  })

  it('backfills every legacy row', () => {
    expect(sql).toMatch(/insert into fuma_domain_dns_instructions_v2[\s\S]*?from fuma_domain_dns_instructions;/)
  })

  it('preserves the legacy version on backfill', () => {
    // Losing it would reset every domain's instruction version and make the next
    // reconciliation think nothing had ever been published.
    expect(sql).toMatch(/select domain_id,record_type,name,value,null,3600,purpose,true,version/)
  })
})
