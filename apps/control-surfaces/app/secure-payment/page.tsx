import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'
import { SecurePaymentSetup } from './payment-setup'

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && idPattern.test(value) ? value : null
}

export default async function SecurePaymentPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>) {
  await requireControlRealm('app')
  const query = await searchParams
  const organizationId = one(query.organizationId)
  const workspaceId = one(query.workspaceId)
  const siteId = one(query.siteId)
  const proposalId = one(query.proposalId)
  const scope = organizationId && workspaceId && siteId ? { organizationId, workspaceId, siteId } : null

  return <main className="mx-auto max-w-3xl p-6">
    <p className="text-sm text-muted-foreground">Signed review · explicit actor confirmation · credentials outside AI</p>
    <h1 className="mb-6 text-3xl font-semibold">Secure payment setup</h1>
    {scope && proposalId
      ? <SecurePaymentSetup scope={scope} proposalId={proposalId} />
      : <Card><CardHeader><CardTitle>Select the originating site and proposal</CardTitle><CardDescription>Payment setup cannot infer or accept tenant authority from form fields.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground" role="status">Open this page from the authenticated site navigation with organizationId, workspaceId, siteId, and proposalId. No installation or credential fields are enabled.</p></CardContent></Card>}
  </main>
}
