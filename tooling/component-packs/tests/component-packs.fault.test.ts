import { describe, expect, test } from 'bun:test'
import { sealComponentPackRelease } from '../contracts'
import { ComponentPackLifecycleError, OpenComponentPackRegistry } from '../lifecycle'
import { LATER, OTHER_OWNER, RESTAURANT_OWNER, privateRestaurantRelease, reviewedRestaurantRelease, upgradedRestaurantRelease } from '../fixtures'

describe('FUMA-SITE-007 lifecycle fault handling', () => {
  test('fails closed on incompatible runtimes', () => {
    const release = privateRestaurantRelease()
    const incompatible = sealComponentPackRelease({ manifest: { ...release.manifest, packId: 'future-menu', compatibility: { ...release.manifest.compatibility, minimumRuntimeVersion: '9.0.0', maximumRuntimeVersion: '9.9.9' } }, payload: release.payload })
    expect(() => new OpenComponentPackRegistry('1.2.0', '1.0.0').register(incompatible)).toThrow(/incompatible/i)
  })

  test('blocks uninstall while pages, Visual Components, templates, or retained releases reference a pack', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); registry.register(reviewedRestaurantRelease())
    registry.install('restaurant.owner/visual-menu@2.0.0', RESTAURANT_OWNER, LATER)
    for (const usage of [
      { pageNodeIds: ['page-node'], visualComponentIds: [], templateIds: [], retainedReleaseIds: [] },
      { pageNodeIds: [], visualComponentIds: ['component'], templateIds: [], retainedReleaseIds: [] },
      { pageNodeIds: [], visualComponentIds: [], templateIds: ['template'], retainedReleaseIds: [] },
      { pageNodeIds: [], visualComponentIds: [], templateIds: [], retainedReleaseIds: ['release'] },
    ]) expect(() => registry.uninstall(RESTAURANT_OWNER.siteId, 'restaurant.owner', 'visual-menu', usage)).toThrow(/blocked/i)
    registry.uninstall(RESTAURANT_OWNER.siteId, 'restaurant.owner', 'visual-menu', { pageNodeIds: [], visualComponentIds: [], templateIds: [], retainedReleaseIds: [] })
    expect(registry.installedFor(RESTAURANT_OWNER.siteId, 'restaurant.owner', 'visual-menu')).toBeUndefined()
  })

  test('marketplace withdrawal blocks only new installs and preserves retained/private exact bytes', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')
    const reviewed = registry.register(reviewedRestaurantRelease()); const privateRelease = registry.register(privateRestaurantRelease())
    registry.install('restaurant.owner/visual-menu@2.0.0', RESTAURANT_OWNER, LATER)
    registry.pinRelease('release-restaurant-001', RESTAURANT_OWNER, ['restaurant.owner/visual-menu@2.0.0'], LATER)
    registry.withdrawMarketplace('restaurant.owner/visual-menu@2.0.0')
    expect(() => registry.install('restaurant.owner/visual-menu@2.0.0', OTHER_OWNER, LATER)).toThrow(/withdrawn/i)
    const retained = registry.resolveRetained('release-restaurant-001')[0]!
    expect(retained.marketplaceWithdrawn).toBe(true)
    expect(retained.publishingBlocked).toBe(false)
    expect(retained.release.immutableArtifact.integritySha256).toBe(reviewed.immutableArtifact.integritySha256)
    expect(registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', RESTAURANT_OWNER).immutableArtifact.integritySha256).toBe(privateRelease.immutableArtifact.integritySha256)
  })

  test('critical security revocation retains bytes but blocks publishing, installation, and new release pins', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); registry.register(reviewedRestaurantRelease())
    registry.pinRelease('release-before-revoke', RESTAURANT_OWNER, ['restaurant.owner/visual-menu@2.0.0'], LATER)
    registry.revokeForSecurity('restaurant.owner/visual-menu@2.0.0')
    expect(() => registry.assertPublishable('restaurant.owner/visual-menu@2.0.0')).toThrow(/revocation/i)
    expect(() => registry.install('restaurant.owner/visual-menu@2.0.0', OTHER_OWNER, LATER)).toThrow(/revoked/i)
    expect(() => registry.pinRelease('release-after-revoke', RESTAURANT_OWNER, ['restaurant.owner/visual-menu@2.0.0'], LATER)).toThrow(/revocation/i)
    expect(registry.resolveRetained('release-before-revoke')[0]).toEqual(expect.objectContaining({ publishingBlocked: true }))
  })

  test('withdrawn marketplace versions cannot become upgrade targets', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')
    registry.register(reviewedRestaurantRelease()); registry.register(upgradedRestaurantRelease())
    registry.install('restaurant.owner/visual-menu@2.0.0', RESTAURANT_OWNER, LATER)
    registry.withdrawMarketplace('restaurant.owner/visual-menu@2.1.0')
    expect(() => registry.upgrade(RESTAURANT_OWNER.siteId, 'restaurant.owner/visual-menu@2.1.0', true, LATER)).toThrow(/withdrawn/i)
  })

  test('missing releases and duplicate retained IDs fail without mutation', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0'); registry.register(privateRestaurantRelease())
    expect(() => registry.get('missing/pack@1.0.0')).toThrow(ComponentPackLifecycleError)
    registry.pinRelease('immutable-release', RESTAURANT_OWNER, ['restaurant.owner/visual-menu@1.0.0'], LATER)
    expect(() => registry.pinRelease('immutable-release', RESTAURANT_OWNER, ['restaurant.owner/visual-menu@1.0.0'], LATER)).toThrow(/immutable/i)
  })
})
