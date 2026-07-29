import { describe, expect, test } from 'bun:test'
import { OpenComponentPackRegistry, auditGeneratedClientSource } from '../lifecycle'
import {
  LATER, RESTAURANT_OWNER, privateRestaurantRelease, restaurantClientDraft,
  restrictedRestaurantRelease, reviewedRestaurantRelease, upgradedRestaurantRelease,
} from '../fixtures'

describe('FUMA-SITE-007 amended restaurant demo', () => {
  test('open creation, sandbox confirmation, rejection, promotion, pins, upgrade, and safe withdrawal', () => {
    const registry = new OpenComponentPackRegistry('1.2.0', '1.0.0')

    const visual = registry.register(privateRestaurantRelease('1.0.0', 'private-site-created'))
    const ai = registry.register(privateRestaurantRelease('1.0.0', 'ai-created'))
    expect(registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', RESTAURANT_OWNER)).toBe(visual)
    expect(registry.usePrivateImmediately('restaurant.owner/ai-specials@1.0.0', RESTAURANT_OWNER)).toBe(ai)

    const restricted = registry.register(restrictedRestaurantRelease())
    expect(restricted.payload.kind).toBe('restricted-client')
    expect(restricted.manifest.permissions.map((permission) => permission.id)).toEqual(['booking.create'])
    expect(auditGeneratedClientSource(restaurantClientDraft("'use server'; export async function charge(){ return process.env.PAYMENT_SECRET }"))).toEqual(expect.objectContaining({ passed: false }))

    const reviewed = registry.register(reviewedRestaurantRelease())
    const upgrade = registry.register(upgradedRestaurantRelease())
    expect(reviewed.manifest.distribution.state).toBe('reviewed')
    expect(reviewed.manifest.exactVersion).toBe('2.0.0')
    expect(upgrade.manifest.exactVersion).toBe('2.1.0')

    registry.install('restaurant.owner/visual-menu@2.0.0', RESTAURANT_OWNER, LATER)
    registry.pinRelease('restaurant-release-042', RESTAURANT_OWNER, [
      'restaurant.owner/visual-menu@1.0.0',
      'restaurant.owner/ai-specials@1.0.0',
      'restaurant.owner/client-menu@1.0.0',
      'restaurant.owner/visual-menu@2.0.0',
    ], LATER)
    const diff = registry.previewUpgrade(RESTAURANT_OWNER.siteId, 'restaurant.owner/visual-menu@2.1.0', 24)
    expect(diff.permissionDiff.added.map((permission) => permission.id)).toEqual(['restaurant.menu.read'])
    expect(diff.schemaDiff).toHaveLength(1)
    expect(diff.rollbackCoordinate).toBe('restaurant.owner/visual-menu@2.0.0')

    registry.withdrawMarketplace('restaurant.owner/visual-menu@2.0.0')
    const retained = registry.resolveRetained('restaurant-release-042')
    expect(retained).toHaveLength(4)
    expect(retained.find((item) => item.release.manifest.exactVersion === '2.0.0')).toEqual(expect.objectContaining({ marketplaceWithdrawn: true, publishingBlocked: false }))
    expect(registry.usePrivateImmediately('restaurant.owner/visual-menu@1.0.0', RESTAURANT_OWNER)).toBe(visual)

    console.log(JSON.stringify({
      privateImmediate: [visual.manifest.source, ai.manifest.source],
      restrictedClient: { version: restricted.manifest.exactVersion, permissions: restricted.manifest.permissions.map((permission) => permission.id) },
      arbitraryServerVariant: 'rejected', reviewedPromotion: reviewed.manifest.distribution.state,
      exactPins: retained.map((item) => `${item.release.manifest.namespace}/${item.release.manifest.packId}@${item.release.manifest.exactVersion}`),
      upgrade: { from: diff.from, to: diff.to, affectedNodes: diff.affectedNodeCount },
      withdrawal: 'listing-blocked-artifacts-retained',
    }))
  })
})
