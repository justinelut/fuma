import { createFumaRegistry, type CapabilityDefinition, type ProductProfile } from '@core/fuma'
import { bookingsAdminRegistry } from '../bookings'

export const AI_CREDITS_CAPABILITY_ID = 'ai.credits'
export const AI_CREDITS_ROUTE_ID = 'route.ai-credits'

const creditsCapability: CapabilityDefinition = Object.freeze({
  id: AI_CREDITS_CAPABILITY_ID,
  dependsOn: ['ai.chat'],
  navigation: [Object.freeze({
    id: 'nav.ai-credits',
    order: 95,
    label: 'AI credits',
    path: '/admin/settings/credits',
    permission: 'ai.chat',
  })],
  routes: [Object.freeze({
    id: AI_CREDITS_ROUTE_ID,
    method: 'GET',
    path: '/admin/settings/credits',
    permission: 'ai.chat',
  })],
})

function withCredits(profile: ProductProfile): ProductProfile {
  const settingsIndex = profile.navigationPreset.indexOf('nav.settings')
  const navigationPreset = [...profile.navigationPreset]
  navigationPreset.splice(settingsIndex < 0 ? navigationPreset.length : settingsIndex, 0, 'nav.ai-credits')
  return {
    ...profile,
    capabilityPreset: [...profile.capabilityPreset, AI_CREDITS_CAPABILITY_ID],
    navigationPreset,
  }
}

/** Hosted registry layers task-owned credits onto every previously composed feature. */
export const creditsAdminRegistry = createFumaRegistry({
  capabilities: Object.freeze([...bookingsAdminRegistry.capabilities, creditsCapability]),
  profiles: Object.freeze(bookingsAdminRegistry.profiles.map(withCredits)),
})
