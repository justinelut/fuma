import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'
import { MarketplaceCatalog } from './catalog'

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && idPattern.test(value) ? value : null
}

export default async function MarketplacePage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  await requireControlRealm('app')
  const query = await searchParams
  const organizationId = one(query.organizationId)
  const workspaceId = one(query.workspaceId)
  const siteId = one(query.siteId)
  const scope = organizationId && workspaceId && siteId ? { organizationId, workspaceId, siteId } : null
  return <main className="mx-auto max-w-5xl p-6">
    <p className="text-sm text-muted-foreground">Hash-bound, artifact-specific scanned, Ed25519-signed and unrevoked releases only</p>
    <h1 className="mb-6 text-3xl font-semibold">Plugin &amp; component marketplace</h1>
    {scope ? <MarketplaceCatalog scope={scope} /> : <Card><CardHeader><CardTitle>Select a site first</CardTitle><CardDescription>Marketplace reads and installs require an authenticated active site scope.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground" role="status">Catalog and install actions are disabled because organizationId, workspaceId and siteId were not supplied by the product navigation context.</p></CardContent></Card>}
  </main>
}
