import type {
  PublicAcquisitionEvent,
  PublicConsentState,
  PublicHandoffRequest,
  PublicRouteClass,
} from '@fuma/public-contracts'

export const PUBLIC_CONSENT_STORAGE_KEY = 'fuma_public_consent_v1'

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
