import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import { domainContractAuthorityV2Migration } from '../../../server/fuma/db/migrations/000062_domain_contract_authority_v2'

const ROOT = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const sourceTree = (path: string): string => readdirSync(join(ROOT, path), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory()
    ? [sourceTree(`${path}/${entry.name}`)]
    : /\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [read(`${path}/${entry.name}`)]
      : [])
  .join('\n')
const domainFiles = [
  'server/fuma/domains/contracts.ts',
  'server/fuma/domains/service.ts',
  'server/fuma/domains/credentialCipher.ts',
  'server/fuma/domains/commercial.ts',
  'server/fuma/domains/fakes.ts',
]

describe('FUMA-059 architecture boundaries', () => {
  it('uses strict TypeBox contracts without Zod, app imports, shared UI, or later provider modules', () => {
    const source = domainFiles.map(read).join('\n')
    expect(source).toContain('DomainRecordSchema = Type.Object')
    expect(source).toContain('DomainCredentialEnvelopeSchema = Type.Object')
    expect(source).toContain('{ additionalProperties: false }')
    expect(source).not.toMatch(/(?:from|import\()\s*['"]zod['"]|\bz\.object\s*\(/)
    expect(source).not.toMatch(/(?:from|import\()\s*['"][^'"]*(?:apps\/|apps\\|shared\/ui|cloudflare|registrar|domainOperations)/)
  })

  it('keeps plaintext out of persistence and public/redacted projection contracts', () => {
    const contracts = read('server/fuma/domains/contracts.ts')
    const service = read('server/fuma/domains/service.ts')
    expect(contracts).toContain('ciphertext: Type.String')
    expect(contracts).toContain("secret: Type.Literal('[REDACTED]')")
    expect(service).toContain('plaintext?.fill(0)')
    expect(service).not.toMatch(/console\.(?:log|info|warn|error)/)
    const publicProjection = contracts.slice(contracts.indexOf('DomainPublicProjectionSchema'), contracts.indexOf('CreateDomainCommandSchema'))
    expect(publicProjection).not.toContain('ciphertext')
    expect(publicProjection).not.toContain('fingerprintSha256')
  })

  it('does not expose credential internals to AI, MCP, or plugin production surfaces', () => {
    const untrustedSurfaces = [
      sourceTree('server/ai'),
      sourceTree('server/plugins'),
      sourceTree('server/fuma/plugins'),
    ].join('\n')
    expect(untrustedSurfaces).not.toMatch(
      /DomainCredentialEnvelope|DomainSecretCipher|StoreCredentialCommand|RotateCredentialCommand|RevokeCredentialCommand|domains\/(?:service|credentialCipher|contracts)/,
    )
  })

  it('ships the conductor-finalized additive migration with central registration', () => {
    expect(() => assertHostedMigrationIsAdditive(domainContractAuthorityV2Migration)).not.toThrow()
    const migration = read('server/fuma/db/migrations/000062_domain_contract_authority_v2.ts')
    const registry = read('server/fuma/db/migrations/index.ts')
    expect(domainContractAuthorityV2Migration.id).toBe('000062_domain_contract_authority_v2')
    expect(migration).toContain('fuma_domain_credential_versions_v2')
    expect(migration).toContain('fuma_domain_transitions_v2')
    expect(migration).toContain('platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, domain_id')
    expect(migration).toContain("owner_state text not null check (owner_state in ('active','transferring'))")
    expect(migration).not.toMatch(/\b(?:plaintext|secret)\s+text\b/i)
    expect(registry).toContain('domainContractAuthorityV2Migration')
    expect(registry).toContain('000062_domain_contract_authority_v2')
  })

  it('contains contracts and read-only provider ports but no DNS/TLS mutation, purchase, or provider adapter', () => {
    const source = domainFiles.map(read).join('\n')
    expect(source).toContain("Type.Literal('validate-ownership')")
    expect(source).toContain("Type.Literal('read-provider-status')")
    expect(source).not.toMatch(/\b(?:createDnsRecord|deleteDnsRecord|issueCertificate|purchaseDomain|renewDomain)\b/)
    expect(source).not.toMatch(/class\s+(?:Cloudflare|Registrar|Dns|Tls)[A-Za-z]*Adapter/)
  })
})
