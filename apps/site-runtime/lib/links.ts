import { SiteRuntimeClientError } from './contracts'

export type RuntimeLinkTarget = Readonly<
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string; rel: 'noopener noreferrer' | null }
>

export function resolveRuntimeLink(value: unknown, currentHost: string): RuntimeLinkTarget {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) throw new SiteRuntimeClientError('invalid-response', 'Runtime link is invalid.')
  if (value.startsWith('cms:page:')) {
    const route = value.slice('cms:page:'.length)
    if (!/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(route)) throw new SiteRuntimeClientError('invalid-response', 'Internal page reference is invalid.')
    return Object.freeze({ kind: 'internal', href: route })
  }
  let url: URL
  try { url = new URL(value, `https://${currentHost}`) } catch { throw new SiteRuntimeClientError('invalid-response', 'Runtime link URL is invalid.') }
  if (url.origin === `https://${currentHost}` && /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(url.pathname) && !url.search && !url.hash) {
    return Object.freeze({ kind: 'internal', href: url.pathname })
  }
  if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) throw new SiteRuntimeClientError('invalid-response', 'Runtime link scheme is denied.')
  return Object.freeze({ kind: 'external', href: url.href, rel: url.protocol === 'https:' || url.protocol === 'http:' ? 'noopener noreferrer' : null })
}
