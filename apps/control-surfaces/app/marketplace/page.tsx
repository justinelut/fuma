import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'

export default async function MarketplacePage() {
  await requireControlRealm('app')
  return <main className="mx-auto max-w-5xl p-6"><p className="text-sm text-muted-foreground">Hash-bound, scanned and signed releases only</p><h1 className="mb-6 text-3xl font-semibold">Reviewed plugins</h1><Card><CardHeader><CardTitle>Fuma Customer Payments</CardTitle><CardDescription>Deposits, donations and checkout through the shared customer merchant ledger.</CardDescription></CardHeader><CardContent className="space-y-4"><ul className="list-disc pl-5 text-sm"><li>KES settlement and provider verification</li><li>Site-scoped settings, secrets and refunds</li><li>No direct provider network or credential access</li></ul><Button disabled aria-describedby="install-state">Install after signed review</Button><p id="install-state" className="text-xs text-muted-foreground">Installation remains disabled until a current review signature and explicit permission grant are returned by the product API.</p></CardContent></Card></main>
}
