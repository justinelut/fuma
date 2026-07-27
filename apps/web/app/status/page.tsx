import { StatusSummary } from '@/components/status-summary'
import { PageMain } from '@/components/site-shell'
import { readPublicStatus } from '@/lib/status-boundary'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Service status',
  'Authority-reported Fuma service status when available, with an explicit unavailable state otherwise.',
  '/status',
)
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Page() {
  const status = await readPublicStatus()
  return <PageMain className="max-w-4xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Service status</p>
    <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Current service information</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">This page reports only a fresh, validated status-authority response. It does not infer uptime, incidents, providers, service levels, or resolution times.</p>
    <StatusSummary value={status} />
  </PageMain>
}
