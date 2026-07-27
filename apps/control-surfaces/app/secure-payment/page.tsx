import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'

export default async function SecurePaymentPage() {
  await requireControlRealm('app')
  const handoffReady = Boolean((await cookies()).get('__Host-fuma-payment-handoff')?.value)
  return <main className="mx-auto max-w-xl p-6"><h1 className="mb-6 text-3xl font-semibold">Secure payment setup</h1><Card><CardHeader><CardTitle>Enter provider credentials</CardTitle><CardDescription>This form posts directly to the encrypted credential boundary. Values are never returned to AI, logs, audit payloads or plugin workers.</CardDescription></CardHeader><CardContent><form className="space-y-4" method="post" action="/api/secure-payment-settings" autoComplete="off"><label className="block text-sm font-medium" htmlFor="public-key">Public key</label><input className="h-10 w-full rounded-md border bg-background px-3" id="public-key" name="publicKey" required maxLength={256} spellCheck={false} disabled={!handoffReady} /><label className="block text-sm font-medium" htmlFor="secret-key">Secret key</label><input className="h-10 w-full rounded-md border bg-background px-3" id="secret-key" name="secretKey" type="password" required maxLength={512} spellCheck={false} disabled={!handoffReady} /><label className="flex gap-2 text-sm"><input name="testMode" type="checkbox" defaultChecked disabled={!handoffReady} />Test mode preview</label><Button type="submit" disabled={!handoffReady}>Store through one-time handoff</Button>{!handoffReady && <p className="text-sm text-muted-foreground" role="status">Return to the confirmed AI proposal and open its one-time secure setup link.</p>}</form></CardContent></Card></main>
}
