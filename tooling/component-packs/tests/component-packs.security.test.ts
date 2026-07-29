import { describe, expect, test } from 'bun:test'
import { auditComponentPackFixture } from '../auditor'
import { ComponentPackContractError, sealComponentPackRelease, sha256, validateComponentPackRelease } from '../contracts'
import { ComponentPackLifecycleError, OpenComponentPackRegistry, auditGeneratedClientSource, confirmRestrictedClientArtifact, promoteTrustedPrivileged } from '../lifecycle'
import {
  COMPATIBILITY, LATER, OTHER_OWNER, RESTAURANT_OWNER, REVIEW_EVIDENCE, confirmationFor, disclosureFor,
  passingValidation, privateRestaurantRelease, restaurantClientDraft, reviewedRestaurantRelease,
} from '../fixtures'

describe('FUMA-SITE-007 hostile component-pack security', () => {
  test.each([
    ["'use server'; export async function Action(){}", 'server-code'],
    ["export const C=()=>import('./tenant')", 'dynamic-import'],
    ["export const C=()=>fetch('https://evil.example')", 'direct-network'],
    ["export const C=()=>process.env.SECRET", 'secret-access'],
    ["export const C=()=>window.parent.location", 'sandbox-escape'],
    ["export const C=({color})=><div className={`bg-${color}-500`}/>", 'dynamic-tailwind'],
    ["export const C=()=>eval('1+1')", 'dangerous-evaluation'],
    ["import x from 'unlocked'; export const C=()=>x", 'undeclared-dependency'],
  ])('rejects hostile generated source: %s', (source, rule) => {
    expect(auditGeneratedClientSource(restaurantClientDraft(source))).toEqual(expect.objectContaining({ passed: false, findings: [expect.objectContaining({ rule })] }))
  })

  test('rejects failed checks, undisclosed permission changes, and unconfirmed artifacts', () => {
    const draft = restaurantClientDraft(); const validation = passingValidation(draft); const disclosure = disclosureFor(draft); const confirmation = confirmationFor(draft, disclosure)
    validation.checks.accessibility.passed = false
    expect(() => confirmRestrictedClientArtifact({ draft, validation, disclosure, confirmation, manifest: { displayName: 'bad', dependencies: [], compatibility: COMPATIBILITY, createdAt: LATER } })).toThrow(/accessibility/i)
    validation.checks.accessibility.passed = true
    expect(() => confirmRestrictedClientArtifact({ draft, validation, disclosure: { ...disclosure, permissions: [] }, confirmation, manifest: { displayName: 'bad', dependencies: [], compatibility: COMPATIBILITY, createdAt: LATER } })).toThrow(/disclosure/i)
    expect(() => confirmRestrictedClientArtifact({ draft, validation, disclosure, confirmation: { ...confirmation, ownerGeneration: 999 }, manifest: { displayName: 'bad', dependencies: [], compatibility: COMPATIBILITY, createdAt: LATER } })).toThrow(/confirmation/i)
  })

  test('rejects self-reference and mutable bytes', () => {
    const original = privateRestaurantRelease()
    const selfReferential = structuredClone({ manifest: original.manifest, payload: original.payload })
    if (selfReferential.payload.kind !== 'declarative') throw new Error('fixture kind')
    selfReferential.payload.components[0]!.tree.nodes['menu-root']!.component = { namespace: 'restaurant.owner', packId: 'visual-menu', componentId: 'visual-menu', exactVersion: '1.0.0' }
    expect(() => sealComponentPackRelease(selfReferential)).toThrow(ComponentPackContractError)

    const tampered = structuredClone(original)
    if (tampered.payload.kind !== 'declarative') throw new Error('fixture kind')
    tampered.payload.components[0]!.description = 'mutated after sealing'
    expect(() => validateComponentPackRelease(tampered)).toThrow(/integrity/i)
  })

  test('rejects executable source hidden inside otherwise open canonical declarative props', () => {
    const original = privateRestaurantRelease()
    const hostile = structuredClone({ manifest: original.manifest, payload: original.payload })
    if (hostile.payload.kind !== 'declarative') throw new Error('fixture kind')
    hostile.payload.components[0]!.tree.nodes['menu-root']!.props = { visualFreedom: { gradient: 'brand' }, nested: { jsx: '<ArbitraryServerComponent />' } }
    expect(() => sealComponentPackRelease(hostile)).toThrow(/forbidden executable field jsx/i)
    hostile.payload.components[0]!.tree.nodes['menu-root']!.props = { responsiveDesign: true, tailwindCompileInput: ['bg-red-500'] }
    expect(() => sealComponentPackRelease(hostile)).toThrow(/tailwindCompileInput/i)
  })

  test('rejects same exact coordinate with different valid bytes', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); const original = privateRestaurantRelease()
    registry.register(original)
    const content = structuredClone({ manifest: original.manifest, payload: original.payload })
    if (content.payload.kind !== 'declarative') throw new Error('fixture kind')
    content.payload.components[0]!.description = 'different immutable content'
    const resealed = sealComponentPackRelease(content)
    expect(() => registry.register(resealed)).toThrow(ComponentPackLifecycleError)
    try { registry.register(resealed) } catch (error) { expect((error as ComponentPackLifecycleError).code).toBe('mutable-release') }
  })

  test('rejects dependency drift and namespace/cross-tenant substitution', () => {
    const original = privateRestaurantRelease(); const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')
    registry.register(original)
    const missingDependency = sealComponentPackRelease({ manifest: { ...original.manifest, packId: 'dependent-menu', dependencies: [{ namespace: 'missing.pack', packId: 'base', exactVersion: '9.9.9', integritySha256: original.immutableArtifact.integritySha256 }] }, payload: original.payload })
    expect(() => registry.register(missingDependency)).toThrow(/dependency/i)

    const foreign = sealComponentPackRelease({ manifest: { ...original.manifest, packId: 'foreign-menu', owner: { kind: 'site', ...OTHER_OWNER } }, payload: original.payload })
    expect(() => registry.register(foreign)).toThrow(/namespace/i)
    expect(() => registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', OTHER_OWNER)).toThrow(/owner/i)
  })

  test('strict contracts reject schema drift and privileged permissions on declarative packs', () => {
    const original = privateRestaurantRelease()
    const schemaDrift = { ...original, manifest: { ...original.manifest, unknownPermission: true } }
    expect(() => validateComponentPackRelease(schemaDrift)).toThrow(/TypeBox/i)
    const privileged = { manifest: { ...original.manifest, permissions: [{ id: 'payments.charge', authority: 'payment', purpose: 'Charge cards', required: true }] }, payload: original.payload }
    expect(() => sealComponentPackRelease(privileged)).toThrow(/authority/i)
  })

  test('hostile auditor reports source and cross-owner findings without executing input', () => {
    const first = privateRestaurantRelease()
    const foreign = sealComponentPackRelease({ manifest: { ...first.manifest, packId: 'foreign-menu', owner: { kind: 'site', ...OTHER_OWNER } }, payload: first.payload })
    const findings = auditComponentPackFixture({ name: 'security', files: [], persistedRecords: [], releases: [first, foreign], generatedDrafts: [restaurantClientDraft("'use server'; export const x=window.parent")] })
    expect(new Set(findings.map((item) => item.ruleId))).toEqual(new Set(['namespace-owner-isolation', 'no-tenant-server-import', 'draft-isolation']))
  })

  test('trusted privileged code requires review-bound provenance and explicit server/payment capabilities', () => {
    const reviewed = reviewedRestaurantRelease()
    const manifest = {
      ...reviewed.manifest,
      packId: 'booking-provider',
      trustTier: 'trusted-privileged' as const,
      capabilities: ['server.execute' as const, 'payment.transact' as const],
      permissions: [
        { id: 'booking.server', authority: 'server' as const, purpose: 'Run reviewed booking orchestration.', required: true },
        { id: 'booking.payment', authority: 'payment' as const, purpose: 'Use reviewed payment authority.', required: true },
      ],
    }
    const promoted = promoteTrustedPrivileged({ manifest, componentId: 'booking-provider', displayName: 'Booking Provider', execution: 'reviewed-provider-adapter', sourceHashSha256: sha256('reviewed source'), buildProvenanceSha256: sha256('reviewed build'), evidence: REVIEW_EVIDENCE })
    expect(promoted.payload.kind).toBe('trusted-privileged')
    expect(promoted.manifest.capabilities).toEqual(['server.execute', 'payment.transact'])
    expect(() => promoteTrustedPrivileged({ manifest: { ...manifest, source: 'ai-created', distribution: { state: 'private', reviewId: null } }, componentId: 'unsafe-server', displayName: 'Unsafe', execution: 'reviewed-provider-adapter', sourceHashSha256: sha256('unsafe'), buildProvenanceSha256: sha256('unsafe build'), evidence: REVIEW_EVIDENCE })).toThrow(/reviewed/i)
    expect(() => promoteTrustedPrivileged({ manifest, componentId: 'forged', displayName: 'Forged', execution: 'reviewed-provider-adapter', sourceHashSha256: sha256('forged'), buildProvenanceSha256: sha256('forged build'), evidence: { ...REVIEW_EVIDENCE, authority: 'tenant-self-review' } })).toThrow(/TypeBox/i)
  })

  test('owner generation is part of private authorization', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); registry.register(privateRestaurantRelease())
    expect(() => registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', { ...RESTAURANT_OWNER, ownerGeneration: RESTAURANT_OWNER.ownerGeneration + 1 })).toThrow(/owner/i)
  })
})
