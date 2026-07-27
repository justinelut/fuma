import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

export type ControlRealm = 'app' | 'admin'

export async function requireControlRealm(realm: ControlRealm): Promise<void> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')?.split(':')[0]?.toLowerCase() ?? ''
  const expected = realm === 'admin' ? 'admin.fuma.co.ke' : 'app.fuma.co.ke'
  const directAcceptanceHost = process.env.NODE_ENV !== 'production' && host === '5174.blyss.co.ke'
  const attestedAcceptanceProxy = process.env.FUMA_BLYSS_ACCEPTANCE_PROXY === '1'
    && host === '127.0.0.1'
    && requestHeaders.get('x-forwarded-proto') === 'https'
    && requestHeaders.get('cdn-loop')?.split(';', 1)[0]?.trim().toLowerCase() === 'cloudflare'
    && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(requestHeaders.get('cf-ray') ?? '')
    && requestHeaders.get('cf-visitor') === '{"scheme":"https"}'
  if (host !== expected && !directAcceptanceHost && !attestedAcceptanceProxy) notFound()
}
