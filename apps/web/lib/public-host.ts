import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'

const BLYSS_ORIGIN_HOST = '127.0.0.1'
const BLYSS_PUBLIC_HOST = '3002.blyss.co.ke'

export const PUBLIC_WEB_HOSTS = Object.freeze([FUMA_WEB_DEPLOYMENT.hosts.public, BLYSS_PUBLIC_HOST] as const)

export function normalizedPublicHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '').split(':')[0] ?? ''
}

export function isBlyssAcceptanceProxy(
  headers: Headers,
  receivedHost: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.FUMA_BLYSS_ACCEPTANCE_PROXY === '1'
    && receivedHost === BLYSS_ORIGIN_HOST
    && headers.get('x-forwarded-proto') === 'https'
    && headers.get('cdn-loop')?.split(';', 1)[0]?.trim().toLowerCase() === 'cloudflare'
    && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(headers.get('cf-ray') ?? '')
    && headers.get('cf-visitor') === '{"scheme":"https"}'
}

export function effectivePublicHost(
  headers: Headers,
  fallbackHost = '',
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const receivedHost = normalizedPublicHost(headers.get('host') ?? fallbackHost)
  return isBlyssAcceptanceProxy(headers, receivedHost, env) ? BLYSS_PUBLIC_HOST : receivedHost
}

export function isKnownPublicHost(host: string): boolean {
  return (PUBLIC_WEB_HOSTS as readonly string[]).includes(host)
}
