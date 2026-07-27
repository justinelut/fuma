import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { NextResponse } from 'next/server'

const SettingsSchema = Type.Object({
  publicKey: Type.String({ minLength: 8, maxLength: 256 }),
  secretKey: Type.String({ minLength: 16, maxLength: 512 }),
  testMode: Type.Boolean(),
}, { additionalProperties: false })

export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()
  const origin = request.headers.get('origin')
  if (host !== 'app.fuma.co.ke' || origin !== 'https://app.fuma.co.ke' || !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return NextResponse.json({ error: 'request-denied' }, { status: 403 })
  const handoff = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('__Host-fuma-payment-handoff='))?.slice('__Host-fuma-payment-handoff='.length)
  const runtime = process.env.FUMA_PRIVATE_RUNTIME_ORIGIN
  if (!handoff || runtime !== 'http://runtime-web.fuma.svc.cluster.local') return NextResponse.json({ error: 'secure-handoff-unavailable' }, { status: 503 })
  const form = await request.formData()
  const settings = { publicKey: form.get('publicKey'), secretKey: form.get('secretKey'), testMode: form.get('testMode') === 'on' }
  if (!Value.Check(SettingsSchema, settings)) return NextResponse.json({ error: 'invalid-settings' }, { status: 400 })
  const response = await fetch(new URL('/internal/v1/payment-settings', runtime), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Handoff ${handoff}`, 'x-fuma-audience': 'secure-payment-settings' },
    body: JSON.stringify(settings),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  return NextResponse.json(response.ok ? { stored: true } : { error: 'secure-storage-failed' }, { status: response.ok ? 201 : 502, headers: { 'cache-control': 'no-store' } })
}
