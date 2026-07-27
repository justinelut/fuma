import Link from 'next/link'
import type { Metadata } from 'next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { readProductFactsForPresentation } from '@/lib/public-projections'

export const metadata: Metadata = {
  title: 'Public contract demonstration · Fuma',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function PublicContractDemoPage() {
  const projection = await readProductFactsForPresentation(new URLSearchParams({ limit: '6' })).catch(() => null)

  return (
    <main id="main-content" className="mx-auto grid min-h-svh w-full max-w-5xl content-center gap-8 px-6 py-16 sm:px-10">
      <header className="grid gap-3">
        <p className="font-mono text-sm uppercase tracking-[0.18em] text-muted-foreground">Public contract demo</p>
        <h1 className="text-fuma-display font-semibold leading-[0.95] tracking-tight">Server-owned product facts</h1>
        <p className="max-w-3xl text-fuma-sm leading-relaxed text-muted-foreground">
          This page renders only a versioned public projection validated at the private service and again inside Next.
        </p>
      </header>

      {projection ? (
        <section aria-label="Validated product facts" className="grid gap-4 md:grid-cols-2">
          {projection.data.items.map((product) => (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>{product.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{product.available ? 'Publicly available' : 'Currently unavailable'}</p>
              </CardContent>
            </Card>
          ))}
          <p className="md:col-span-2 font-mono text-xs text-muted-foreground">
            Dataset {projection.meta.datasetVersion}
          </p>
        </section>
      ) : (
        <Card role="status">
          <CardHeader>
            <CardTitle>Product facts are temporarily unavailable</CardTitle>
            <CardDescription>No cached or editorial business values are substituted when platform authority cannot be validated.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Link className="w-fit underline underline-offset-4" href="/">Return to the public foundation</Link>
    </main>
  )
}
