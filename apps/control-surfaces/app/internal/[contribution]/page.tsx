import { notFound } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'

const contributions = {
  'plugin-review': { owner: 'FUMA-068', title: 'Plugin review', description: 'Hash, permission diff, scans, reviewer separation, signature and revocation evidence.' },
  support: { owner: 'FUMA-072', title: 'Support and moderation', description: 'Step-up, reason, banner, expiry, appeals and immutable evidence. Break glass remains isolated.' },
  experts: { owner: 'FUMA-073', title: 'Expert moderation', description: 'Approved revisions, opt-in consent, attribution, inquiry abuse and immediate projection invalidation.' },
  transfers: { owner: 'FUMA-074', title: 'Handoff recovery', description: 'Retry, reconcile and refund escalation over the existing saga; never bypass current contract authority.' },
} as const

export default async function ContributionPage({ params }: Readonly<{ params: Promise<{ contribution: string }> }>) {
  await requireControlRealm('admin')
  const { contribution } = await params
  const item = contributions[contribution as keyof typeof contributions]
  if (!item) notFound()
  return <main className="mx-auto max-w-4xl p-6"><p className="text-sm text-muted-foreground">Owned by {item.owner} · internal authority and step-up resolved server-side</p><h1 className="mb-6 text-3xl font-semibold">{item.title}</h1><Card><CardHeader><CardTitle>Contribution boundary</CardTitle><CardDescription>{item.description}</CardDescription></CardHeader><CardContent><p className="text-sm">Actions remain unavailable until the central domain service returns current authority, pagination cursor, redacted evidence and audit correlation.</p></CardContent></Card></main>
}
