import {
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  createFumaRegistry,
  type CapabilityDefinition,
  type ProductProfile,
} from '@core/fuma'

export const BOOKING_ADMIN_CAPABILITY_ID = 'website.bookings'
export const BOOKING_ADMIN_ROUTE_ID = 'route.bookings'

const bookingCapability: CapabilityDefinition = Object.freeze({
  id: BOOKING_ADMIN_CAPABILITY_ID,
  dependsOn: ['site.home', 'site.settings'],
  navigation: [Object.freeze({
    id: 'nav.bookings',
    order: 55,
    label: 'Bookings',
    path: '/admin/bookings',
    permission: 'site.home.read',
  })],
  routes: [Object.freeze({
    id: BOOKING_ADMIN_ROUTE_ID,
    method: 'GET',
    path: '/admin/bookings',
    permission: 'site.home.read',
  })],
})

function withBookings(profile: ProductProfile): ProductProfile {
  if (profile.id !== 'website') return profile
  const analyticsIndex = profile.navigationPreset.indexOf('nav.website-analytics')
  const navigationPreset = [...profile.navigationPreset]
  navigationPreset.splice(analyticsIndex < 0 ? navigationPreset.length : analyticsIndex, 0, 'nav.bookings')
  return {
    ...profile,
    capabilityPreset: [...profile.capabilityPreset, BOOKING_ADMIN_CAPABILITY_ID],
    navigationPreset,
  }
}

export const bookingsAdminRegistry = createFumaRegistry({
  capabilities: Object.freeze([...LAUNCH_CAPABILITIES, bookingCapability]),
  profiles: Object.freeze(LAUNCH_PROFILES.map(withBookings)),
})
