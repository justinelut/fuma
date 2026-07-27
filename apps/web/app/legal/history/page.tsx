import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageMain } from '@/components/site-shell'
import { readEditorial } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Policy history',
  'Current Fuma public website policy versions, effective dates, review owners, and truthful history availability.',
  '/legal/history',
)

export default async function Page() {
  const policies = (await readEditorial())
    .filter((entry) => entry.meta.collection === 'legal')
    .sort((left, right) => left.meta.slug.localeCompare(right.meta.slug))
  return <PageMain className="max-w-5xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Policy history</p>
    <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Published website notices</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">This index lists every public policy version represented by the current repository content. These are initial versions, so no superseded public text is available yet. A future publication must preserve the prior version before replacing the current link.</p>
    <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Independent legal and privacy launch approval remains pending. The labels below identify accountable review roles, not named external counsel or a certification body.</p>
    <div className="mt-10 grid gap-4">
      {policies.map((policy) => <Card className="border" key={policy.meta.slug}>
        <CardHeader>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Current · Version {policy.meta.version}</p>
          <CardTitle className="text-xl"><a className="underline-offset-4 hover:underline" href={`/legal/${policy.meta.slug}`}>{policy.meta.title}</a></CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Effective</dt><dd className="mt-1 text-muted-foreground"><time dateTime={policy.meta.publishedAt}>{policy.meta.publishedAt.slice(0, 10)}</time></dd></div>
            <div><dt className="font-semibold">Review owner</dt><dd className="mt-1 text-muted-foreground">{policy.meta.owner}</dd></div>
            <div><dt className="font-semibold">Review due</dt><dd className="mt-1 text-muted-foreground"><time dateTime={policy.meta.reviewAt}>{policy.meta.reviewAt.slice(0, 10)}</time></dd></div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">Superseded public versions: none recorded.</p>
        </CardContent>
      </Card>)}
    </div>
  </PageMain>
}
