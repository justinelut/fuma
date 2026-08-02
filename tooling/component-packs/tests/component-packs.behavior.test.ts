import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { ComponentPackSourceSchema, sealComponentPackRelease } from '../contracts'
import { OpenComponentPackRegistry, confirmRestrictedClientArtifact, previewComponentPackUpgrade } from '../lifecycle'
import {
  COMPATIBILITY, LATER, RESTAURANT_OWNER, confirmationFor, disclosureFor, passingValidation,
  privateRestaurantRelease, restaurantClientDraft, restrictedRestaurantRelease,
  reviewedRestaurantRelease, upgradedRestaurantRelease,
} from '../fixtures'

describe('FUMA-SITE-007 component-pack lifecycle behavior', () => {
  test('visual and AI declarative components are immediately usable by their exact owner without review', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')
    const visual = registry.register(privateRestaurantRelease('1.0.0', 'private-site-created'))
    const ai = registry.register(privateRestaurantRelease('1.0.0', 'ai-created'))
    expect(registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', RESTAURANT_OWNER)).toBe(visual)
    expect(registry.usePrivateImmediately('restaurant.owner/ai-specials@1.0.0', RESTAURANT_OWNER)).toBe(ai)
    expect(visual.manifest.distribution).toEqual({ state: 'private', reviewId: null })
    expect(visual.payload.kind).toBe('declarative')
    if (visual.payload.kind === 'declarative') {
      expect(visual.payload.components[0]?.variants[0]?.id).toBe('featured')
      expect(visual.payload.components[0]?.tree.nodes['menu-loop']?.loop?.source).toBe('restaurant.menu.read')
      expect(visual.payload.components[0]?.tree.nodes['menu-root']?.responsiveRules).toHaveLength(1)
    }
  })

  test('validated, disclosed, confirmed source becomes only an immutable restricted-client artifact', () => {
    const release = restrictedRestaurantRelease()
    expect(release.manifest.trustTier).toBe('restricted-client')
    expect(release.payload.kind).toBe('restricted-client')
    expect(JSON.stringify(release)).not.toContain('sourceTsx')
    expect(release.immutableArtifact.sizeBytes).toBeGreaterThan(100)
    expect(Object.isFrozen(release)).toBe(true)
  })

  test('confirmation binds exact source and disclosure', () => {
    const draft = restaurantClientDraft(); const disclosure = disclosureFor(draft)
    const release = confirmRestrictedClientArtifact({ draft, validation: passingValidation(draft), disclosure, confirmation: confirmationFor(draft, disclosure), manifest: { displayName: 'Restaurant client', dependencies: [], compatibility: COMPATIBILITY, createdAt: LATER } })
    expect(release.payload.kind).toBe('restricted-client')
  })

  test('reviewed marketplace promotion is a separate immutable release', () => {
    const privateRelease = privateRestaurantRelease()
    const reviewed = reviewedRestaurantRelease()
    expect(privateRelease.manifest.trustTier).toBe('private-declarative')
    expect(reviewed.manifest.trustTier).toBe('reviewed-distributable')
    expect(reviewed.manifest.distribution.state).toBe('reviewed')
    expect(reviewed.immutableArtifact.integritySha256).not.toBe(privateRelease.immutableArtifact.integritySha256)
  })

  test('exact installs and upgrade previews expose permission, schema, compatibility, visual, and rollback evidence', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')
    const current = registry.register(reviewedRestaurantRelease())
    const next = registry.register(upgradedRestaurantRelease())
    registry.install('restaurant.owner/visual-menu@2.0.0', RESTAURANT_OWNER, LATER)
    const diff = registry.previewUpgrade(RESTAURANT_OWNER.siteId, 'restaurant.owner/visual-menu@2.1.0', 17)
    expect(diff).toEqual(expect.objectContaining({ from: 'restaurant.owner/visual-menu@2.0.0', to: 'restaurant.owner/visual-menu@2.1.0', affectedNodeCount: 17, visualArtifactChanged: true, requiresOwnerConfirmation: true, rollbackCoordinate: 'restaurant.owner/visual-menu@2.0.0' }))
    expect(diff.permissionDiff.added.map((item) => item.id)).toEqual(['restaurant.menu.read'])
    expect(diff.schemaDiff).toEqual([expect.objectContaining({ componentId: 'visual-menu', propsChanged: true })])
    expect(previewComponentPackUpgrade(current, next, 2).dependencyDiff).toEqual({ added: [], removed: [], changed: [] })
    expect(() => registry.upgrade(RESTAURANT_OWNER.siteId, 'restaurant.owner/visual-menu@2.1.0', false, LATER)).toThrow(/owner confirmation/i)
    expect(registry.upgrade(RESTAURANT_OWNER.siteId, 'restaurant.owner/visual-menu@2.1.0', true, LATER).rollbackCoordinates).toContain('restaurant.owner/visual-menu@2.0.0')
  })

  test('accepts every open registry source and authorizes private team packs across the exact team scope', () => {
    for (const source of ['official-fuma', 'private-site-created', 'ai-created', 'designer-created', 'source-imported', 'team-pack', 'reviewed-marketplace']) expect(Value.Check(ComponentPackSourceSchema, source)).toBe(true)
    const base = privateRestaurantRelease()
    const teamRelease = sealComponentPackRelease({
      manifest: {
        ...base.manifest, packId: 'team-menu', source: 'team-pack',
        owner: { kind: 'team', organizationId: RESTAURANT_OWNER.organizationId, workspaceId: RESTAURANT_OWNER.workspaceId, ownerKey: RESTAURANT_OWNER.ownerKey, ownerGeneration: RESTAURANT_OWNER.ownerGeneration },
      },
      payload: base.payload,
    })
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); registry.register(teamRelease)
    expect(registry.usePrivateImmediately('restaurant.owner/team-menu@1.0.0', { ...RESTAURANT_OWNER, siteId: 'site-restaurant-two' })).toEqual(teamRelease)
  })
})
