import { timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { InternalAuthority } from '../../../packages/fuma-governance-launch/src'
import { FUMA_CONTROL_DEPLOYMENT } from './deployment-profile'

export type ControlRealm = 'app' | 'admin'

export async function requireControlRealm(realm: ControlRealm): Promise<void> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')?.split(':')[0]?.toLowerCase() ?? ''
  const expected = realm === 'admin' ? FUMA_CONTROL_DEPLOYMENT.hosts.console : FUMA_CONTROL_DEPLOYMENT.hosts.product
  const directAcceptanceHost = process.env.NODE_ENV !== 'production' && host === '5174.blyss.co.ke'
  const attestedAcceptanceProxy = process.env.FUMA_BLYSS_ACCEPTANCE_PROXY === '1'
    && host === '127.0.0.1'
    && requestHeaders.get('x-forwarded-proto') === 'https'
    && requestHeaders.get('cdn-loop')?.split(';', 1)[0]?.trim().toLowerCase() === 'cloudflare'
    && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(requestHeaders.get('cf-ray') ?? '')
    && requestHeaders.get('cf-visitor') === '{"scheme":"https"}'
  if (host !== expected && !directAcceptanceHost && !attestedAcceptanceProxy) notFound()
}

function exactSecret(left: string, right: string): boolean {
  const first = Buffer.from(left)
  const second = Buffer.from(right)
  return first.length === second.length && timingSafeEqual(first, second)
}

/**
 * Production accepts only a server-side trusted-proxy attestation produced after
 * hosted staff session and capability resolution. Merely reaching the admin host
 * never confers internal console authority. The public Blyss fixture is limited
 * to non-production browser acceptance and has read authority only.
 */
export async function requireInternalConsoleAuthority(): Promise<InternalAuthority> {
  await requireControlRealm('admin')
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')?.split(':')[0]?.toLowerCase() ?? ''
  const attestedAcceptanceProxy = process.env.FUMA_BLYSS_ACCEPTANCE_PROXY === '1'
    && host === '127.0.0.1'
    && requestHeaders.get('x-forwarded-proto') === 'https'
    && requestHeaders.get('cdn-loop')?.split(';', 1)[0]?.trim().toLowerCase() === 'cloudflare'
    && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(requestHeaders.get('cf-ray') ?? '')
    && requestHeaders.get('cf-visitor') === '{"scheme":"https"}'
  if (process.env.NODE_ENV !== 'production' && (host === '5174.blyss.co.ke' || attestedAcceptanceProxy)) {
    return Object.freeze({
      actorId: 'blyss-acceptance-reader',
      host: FUMA_CONTROL_DEPLOYMENT.hosts.console,
      authorities: new Set(['internal.console.read']),
      stepUpAt: null,
      protectedOwner: false,
    })
  }
  const expected = process.env.FUMA_INTERNAL_AUTHORITY_ATTESTATION_SECRET ?? ''
  const received = requestHeaders.get('x-fuma-internal-authority-attestation') ?? ''
  const actorId = requestHeaders.get('x-fuma-staff-actor-id') ?? ''
  const authorities = (requestHeaders.get('x-fuma-internal-authorities') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (expected.length < 32 || !exactSecret(expected, received)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,94}[A-Za-z0-9]$/.test(actorId)
    || !authorities.includes('internal.console.read')
    || authorities.some((value) => !/^internal\.[a-z0-9.:-]+$/.test(value))) notFound()
  return Object.freeze({
    actorId,
    host: FUMA_CONTROL_DEPLOYMENT.hosts.console,
    authorities: new Set(authorities),
    stepUpAt: requestHeaders.get('x-fuma-step-up-at'),
    protectedOwner: requestHeaders.get('x-fuma-protected-owner') === '1',
  })
}
