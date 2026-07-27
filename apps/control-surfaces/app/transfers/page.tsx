import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'

const steps = ['Contract and paid-transfer-pending revalidated', 'Destination organization active', 'Domain choice recorded', 'AI/BYOK choice recorded', 'MCP connectors revoke or re-scope', 'Plugin settings and secrets rekey', 'Payment merchant retained or detached', 'Collaborators retained by explicit choice'] as const

export default async function TransfersPage() {
  await requireControlRealm('app')
  return <main className="mx-auto max-w-4xl p-6"><p className="text-sm text-muted-foreground">en-KE · KES · Africa/Nairobi</p><h1 className="mb-6 text-3xl font-semibold">Site handoff</h1><Card><CardHeader><CardTitle>Review the handoff</CardTitle><CardDescription>The active contract, payment, destination and quotas are revalidated immediately before the existing transfer saga starts.</CardDescription></CardHeader><CardContent><ol className="space-y-2">{steps.map((step, index) => <li className="flex gap-3" key={step}><span aria-hidden className="font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span>{step}</span></li>)}</ol><div className="mt-6 flex gap-3"><Button disabled>Confirm and start handoff</Button><Button variant="outline" disabled>Cancel</Button></div></CardContent></Card></main>
}
