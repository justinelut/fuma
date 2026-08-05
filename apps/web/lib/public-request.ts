import { effectivePublicHost, isBlyssAcceptanceProxy, isKnownPublicHost, normalizedPublicHost } from './public-host'

function effectiveRequestProtocol(request: Request, url: URL): string {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase()
  return forwarded === 'https' || forwarded === 'http' ? `${forwarded}:` : url.protocol
}

export function isPublicWebRequest(request: Request): boolean {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return false
  }
  const urlHost = normalizedPublicHost(url.hostname)
  const receivedHost = normalizedPublicHost(request.headers.get('host') ?? urlHost)
  const acceptanceProxy = isBlyssAcceptanceProxy(request.headers, receivedHost)
  const host = effectivePublicHost(request.headers, urlHost)
  return isKnownPublicHost(host)
    && (acceptanceProxy || (effectiveRequestProtocol(request, url) === 'https:' && receivedHost === urlHost))
}

export function isSameOriginPublicRequest(request: Request): boolean {
  if (!isPublicWebRequest(request)) return false
  try {
    const requestUrl = new URL(request.url)
    const origin = new URL(request.headers.get('origin') ?? 'invalid:')
    const receivedHost = normalizedPublicHost(request.headers.get('host') ?? requestUrl.hostname)
    const acceptanceProxy = isBlyssAcceptanceProxy(request.headers, receivedHost)
    const expectedHost = effectivePublicHost(request.headers, requestUrl.hostname)
    return origin.protocol === 'https:'
      && normalizedPublicHost(origin.hostname) === expectedHost
      && (acceptanceProxy ? origin.port === '' : origin.port === requestUrl.port)
      && origin.username === ''
      && origin.password === ''
  } catch {
    return false
  }
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') return { ok: false, status: 415 }
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return { ok: false, status: 413 }
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > maximumBytes) return { ok: false, status: 413 }
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400 }
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export const NO_STORE_HEADERS = Object.freeze({ 'cache-control': 'no-store' })
