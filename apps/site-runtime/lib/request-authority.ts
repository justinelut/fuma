import { SiteRuntimeClientError } from './contracts'

export type HeaderReader = Pick<Headers, 'get'>

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

export function normalizeTenantHost(rawHost: string): string {
  if (!rawHost || rawHost !== rawHost.trim() || /[^\x21-\x7e]|[\s/@\\,#[\]]/.test(rawHost)) throw new SiteRuntimeClientError('invalid-request', 'Malformed Host has no fallback.')
  let authority = rawHost.toLowerCase()
  let dots = 0
  if (authority.endsWith('.')) { authority = authority.slice(0, -1); dots += 1 }
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority)
  if (!match || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65_535))) throw new SiteRuntimeClientError('invalid-request', 'Malformed Host has no fallback.')
  let host = match[1]!
  if (host.endsWith('.')) { host = host.slice(0, -1); dots += 1 }
  if (dots > 1 || host.split('.').some((label) => label.startsWith('xn--')) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) {
    throw new SiteRuntimeClientError('invalid-request', 'Malformed or IDN Host has no fallback.')
  }
  return host
}

export function authorizeRoutedHost(headers: HeaderReader, routingToken: string): string {
  if (routingToken.length < 32) throw new SiteRuntimeClientError('direct-origin', 'Routing authority is unavailable.')
  const host = normalizeTenantHost(headers.get('host') ?? '')
  const routedHost = headers.get('x-fuma-routed-host')
  const token = headers.get('x-fuma-routing-token')
  if (!routedHost || normalizeTenantHost(routedHost) !== host || !token || !constantTimeEqual(token, routingToken)) {
    throw new SiteRuntimeClientError('direct-origin', 'Direct origin requests are denied.')
  }
  if (headers.get('x-forwarded-authorization') || headers.get('authorization')) throw new SiteRuntimeClientError('direct-origin', 'Caller authorization cannot enter the tenant runtime.')
  return host
}

export function canonicalRoute(parts: readonly string[] | undefined): string {
  if (!parts || parts.length === 0) return '/'
  if (parts.some((part) => part === '.' || part === '..' || !/^[A-Za-z0-9._~-]+$/.test(part))) throw new SiteRuntimeClientError('invalid-request', 'Route is not canonical.')
  return `/${parts.join('/')}`
}

export function canonicalQuery(searchParams: Readonly<Record<string, string | string[] | undefined>>): string {
  const entries: Array<[string, string]> = []
  for (const [key, raw] of Object.entries(searchParams)) {
    if (!/^[A-Za-z0-9._~-]+$/.test(key)) throw new SiteRuntimeClientError('invalid-request', 'Query key is invalid.')
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      if (!/^[A-Za-z0-9._~-]*$/.test(value)) throw new SiteRuntimeClientError('invalid-request', 'Query value is invalid.')
      entries.push([key, value])
    }
  }
  return entries.sort(([ak, av], [bk, bv]) => ak.localeCompare(bk, 'en') || av.localeCompare(bv, 'en'))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

export function siteMemberSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const values: string[] = []
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== '__Host-fuma_member_session') continue
    try { values.push(decodeURIComponent(item.slice(separator + 1).trim())) } catch { return null }
  }
  if (values.length !== 1) return null
  const token = values[0]!
  return token.startsWith('fmm1_') && token.length >= 37 && token.length <= 4_096 ? token : null
}
