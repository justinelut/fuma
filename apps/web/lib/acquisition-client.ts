import type {
  PublicAcquisitionEvent,
  PublicConsentState,
  PublicHandoffRequest,
  PublicRouteClass,
} from '@fuma/public-contracts'

export const PUBLIC_CONSENT_STORAGE_KEY = 'fuma_public_consent_v1'
export type PublicConsentChoice = 'essential' | 'optional'
type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type ConsentPreference = Readonly<{
  available: boolean
  choice: PublicConsentChoice | null
}>

const SOURCE_ROUTE_CLASS: Readonly<Record<PublicHandoffRequest['source'], PublicRouteClass>> = Object.freeze({
  direct: 'company',
  home: 'home',
  product: 'product',
  solution: 'solution',
  pricing: 'pricing',
  template: 'template',
  showcase: 'showcase',
  expert: 'expert',
  plugin: 'plugin',
  docs: 'resource',
  guide: 'resource',
  blog: 'resource',
  changelog: 'resource',
})

export function routeClassForPath(pathname: string): PublicRouteClass {
  if (pathname === '/') return 'home'
  if (/^\/(?:website|publication|features)(?:\/|$)/.test(pathname)) return 'product'
  if (pathname.startsWith('/solutions')) return 'solution'
  if (pathname.startsWith('/pricing')) return 'pricing'
  if (pathname.startsWith('/templates')) return 'template'
  if (pathname.startsWith('/showcase')) return 'showcase'
  if (pathname.startsWith('/experts')) return 'expert'
  if (pathname.startsWith('/plugins')) return 'plugin'
  if (/^\/(?:docs|guides|blog|changelog)(?:\/|$)/.test(pathname)) return 'resource'
  if (/^\/(?:legal|trust|security|privacy-request)(?:\/|$)/.test(pathname)) return 'legal'
  return 'company'
}

export function consentStateFromSession(raw: string | null): PublicConsentState {
  if (!raw) return 'not_required'
  try {
    const value = JSON.parse(raw) as unknown
    if (
      typeof value === 'object'
      && value !== null
      && 'version' in value
      && value.version === 1
      && 'choice' in value
    ) {
      if (value.choice === 'optional') return 'granted'
      if (value.choice === 'essential') return 'denied'
    }
  } catch {
    // Invalid or obsolete preferences are treated as absent, never as consent.
  }
  return 'not_required'
}

export function readConsentPreference(storage: ConsentStorage): ConsentPreference {
  try {
    const raw = storage.getItem(PUBLIC_CONSENT_STORAGE_KEY)
    const state = consentStateFromSession(raw)
    if (state === 'granted') return Object.freeze({ available: true, choice: 'optional' })
    if (state === 'denied') return Object.freeze({ available: true, choice: 'essential' })
    if (raw !== null) storage.removeItem(PUBLIC_CONSENT_STORAGE_KEY)
    return Object.freeze({ available: true, choice: null })
  } catch {
    return Object.freeze({ available: false, choice: null })
  }
}

export function persistConsentPreference(storage: ConsentStorage, choice: PublicConsentChoice, updatedAt: string): boolean {
  try {
    storage.setItem(PUBLIC_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, choice, updatedAt }))
    return true
  } catch {
    return false
  }
}

export function clearConsentPreference(storage: ConsentStorage): boolean {
  try {
    storage.removeItem(PUBLIC_CONSENT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function sendOptionalAcquisition(
  event: PublicAcquisitionEvent,
  consent: PublicConsentState,
  fetchImpl: typeof fetch = fetch,
): boolean {
  if (!shouldSendOptionalAcquisition(consent)) return false
  void fetchImpl('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => undefined)
  return true
}

export function handoffStartedEvent(
  intent: PublicHandoffRequest,
  correlation: string,
  timestamp: string,
  consent: PublicConsentState,
): PublicAcquisitionEvent {
  return {
    version: 1,
    kind: 'handoff_started',
    routeClass: SOURCE_ROUTE_CLASS[intent.source],
    timestamp,
    consent,
    handoffCorrelation: correlation,
    ...(intent.kind === 'choose_plan' ? { planId: intent.planId } : {}),
    ...(intent.kind === 'use_template' ? { templateId: intent.templateId } : {}),
  }
}

export function shouldSendOptionalAcquisition(consent: PublicConsentState): boolean {
  return consent === 'granted'
}
