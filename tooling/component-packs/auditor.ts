import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { ComponentPackContractError, validateComponentPackRelease } from './contracts'
import { auditGeneratedClientSource } from './lifecycle'

export const COMPONENT_PACK_GATE_RULE_IDS = [
  'typebox-only',
  'canonical-data-only',
  'no-tenant-server-import',
  'static-tailwind',
  'draft-isolation',
  'restricted-authority',
  'exact-version-integrity',
  'namespace-owner-isolation',
  'marketplace-private-separation',
  'self-reference',
  'external-authority-seams',
] as const
export type ComponentPackGateRuleId = typeof COMPONENT_PACK_GATE_RULE_IDS[number]
export type ComponentPackGateFinding = Readonly<{ ruleId: ComponentPackGateRuleId; path: string; detail: string }>

const Strict = { additionalProperties: false } as const
const FixtureSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  files: Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 1_024 }), content: Type.String({ maxLength: 2_000_000 }) }, Strict), { maxItems: 10_000 }),
  persistedRecords: Type.Array(Type.Unknown(), { maxItems: 10_000 }),
  releases: Type.Array(Type.Unknown(), { maxItems: 1_000 }),
  generatedDrafts: Type.Array(Type.Unknown(), { maxItems: 1_000 }),
}, Strict)

export type ComponentPackAuditFixture = Readonly<{
  name: string
  files: ReadonlyArray<Readonly<{ path: string; content: string }>>
  persistedRecords: readonly unknown[]
  releases: readonly unknown[]
  generatedDrafts: readonly unknown[]
}>

const ZOD = /(?:from\s*|import\s*\(|require\s*\()\s*['"]zod(?:\/[^'"]*)?['"]|\bz\.object\s*\(/
const TENANT_SERVER_IMPORT = /\bimport\s*\(\s*(?!['"](?:\.\/)?official\/)|tenant(?:Source|Module|Path)|serverComponentPath/
const FORBIDDEN_AUTHORITY_IMPLEMENTATION = /(?:create table|insert into component_pack|signArtifact|verifySignature|marketplaceDecision|executeAgentTool|site_create_component)/i
const JSX_KEYS = new Set(['jsx', 'tsx', 'sourceTsx', 'componentSource', 'serverComponentSource', 'tailwindUtilities'])

function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function findKey(value: unknown, keys: ReadonlySet<string>, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) { for (const item of value) { const found = findKey(item, keys, seen); if (found) return found }; return undefined }
  for (const [key, nested] of Object.entries(value)) { if (keys.has(key)) return key; const found = findKey(nested, keys, seen); if (found) return found }
  return undefined
}
function add(findings: ComponentPackGateFinding[], ruleId: ComponentPackGateRuleId, path: string, detail: string): void { findings.push({ ruleId, path, detail }) }

export function auditComponentPackFixture(value: unknown): ReadonlyArray<ComponentPackGateFinding> {
  if (!Value.Check(FixtureSchema, value)) throw new Error('Component-pack hostile fixture does not satisfy its strict TypeBox fixture schema.')
  const fixture = value as ComponentPackAuditFixture; const findings: ComponentPackGateFinding[] = []
  for (const file of fixture.files) {
    if (ZOD.test(file.content)) add(findings, 'typebox-only', file.path, 'Component-pack boundaries use TypeBox only; Zod is forbidden.')
    if (TENANT_SERVER_IMPORT.test(file.content)) add(findings, 'no-tenant-server-import', file.path, 'Arbitrary tenant Server Component imports are forbidden in the shared runtime.')
    if (FORBIDDEN_AUTHORITY_IMPLEMENTATION.test(file.content) && /(?:migrations|repository|signing|review|agent|mcp)/.test(file.path)) add(findings, 'external-authority-seams', file.path, 'SITE-007 exposes seams and must not implement FUMA-067/068/SITE-008 authority.')
  }
  const persistedKey = findKey(fixture.persistedRecords, JSX_KEYS)
  if (persistedKey) add(findings, 'canonical-data-only', 'persistedRecords', `Canonical persisted content contains forbidden executable/styling source field ${persistedKey}.`)

  const namespaceOwners = new Map<string, string>()
  for (let index = 0; index < fixture.releases.length; index += 1) {
    const candidate = fixture.releases[index]
    try {
      const release = validateComponentPackRelease(candidate)
      const owner = release.manifest.owner.kind === 'platform' ? `platform:${release.manifest.owner.platformId}` : `${release.manifest.owner.organizationId}:${release.manifest.owner.workspaceId}:${release.manifest.owner.ownerKey}:${release.manifest.owner.ownerGeneration}`
      const previous = namespaceOwners.get(release.manifest.namespace)
      if (previous && previous !== owner) add(findings, 'namespace-owner-isolation', `releases[${index}]`, 'One namespace was substituted across owner scopes.')
      namespaceOwners.set(release.manifest.namespace, owner)
      if ((release.manifest.trustTier === 'private-declarative' || release.manifest.trustTier === 'restricted-client') && release.manifest.distribution.state !== 'private') add(findings, 'marketplace-private-separation', `releases[${index}]`, 'Private use and marketplace distribution are separate lifecycles.')
    } catch (error) {
      if (error instanceof ComponentPackContractError) {
        const rule: ComponentPackGateRuleId = error.code === 'integrity-mismatch' ? 'exact-version-integrity'
          : error.code === 'invalid-tree' ? 'self-reference'
            : error.code === 'invalid-trust' ? 'restricted-authority'
              : error.code === 'invalid-dependency' ? 'self-reference'
                : 'exact-version-integrity'
        add(findings, rule, `releases[${index}]`, error.message)
      } else throw error
    }
  }

  for (let index = 0; index < fixture.generatedDrafts.length; index += 1) {
    try {
      const audit = auditGeneratedClientSource(fixture.generatedDrafts[index])
      for (const finding of audit.findings) {
        const rule: ComponentPackGateRuleId = finding.rule === 'dynamic-tailwind' ? 'static-tailwind'
          : finding.rule === 'server-code' || finding.rule === 'dynamic-import' ? 'no-tenant-server-import'
            : finding.rule === 'direct-network' || finding.rule === 'secret-access' ? 'restricted-authority'
              : 'draft-isolation'
        add(findings, rule, `generatedDrafts[${index}]`, finding.detail)
      }
    } catch (error) {
      add(findings, 'draft-isolation', `generatedDrafts[${index}]`, error instanceof Error ? error.message : 'Invalid generated draft.')
    }
  }
  return Object.freeze(findings)
}

export function assertComponentPackFixtureSafe(value: unknown): void {
  const findings = auditComponentPackFixture(value)
  if (findings.length > 0) throw new Error(findings.map((finding) => `[${finding.ruleId}] ${finding.path}: ${finding.detail}`).join('\n'))
}

export function fixtureReleaseRecord(value: unknown): Record<string, unknown> | undefined { return record(value) }
