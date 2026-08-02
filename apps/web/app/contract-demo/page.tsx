import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { readProductFactsForPresentation } from '@/lib/public-projections'

export const metadata: Metadata = {
  title: 'Product availability · Fuma',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function PublicContractDemoPage() {
  const products = await readProductFactsForPresentation(new URLSearchParams({ limit: '6' })).catch(() => null)

  return (
    <main id="main-content" className="mx-auto grid min-h-svh w-full max-w-5xl content-center gap-8 px-6 py-16 sm:px-10">
      <header className="grid gap-3">
        <p className="font-mono text-sm uppercase tracking-[0.18em] text-muted-foreground">Product availability</p>
        <h1 className="text-fuma-display font-semibold leading-[0.95] tracking-tight">What’s available in Fuma</h1>
        <p className="max-w-3xl text-fuma-sm leading-relaxed text-muted-foreground">
          This page shows the latest available product information.
        </p>
      </header>

      {products ? (
        <section aria-label="Available Fuma products" className="grid gap-4 md:grid-cols-2">
          {products.data.items.map((product) => (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>{product.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{product.available ? 'Available' : 'Currently unavailable'}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <Card role="status">
          <CardHeader>
            <CardTitle>Product information is temporarily unavailable</CardTitle>
            <CardDescription>Try again in a moment.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Link className="w-fit underline underline-offset-4" href="/">Return home</Link>
    </main>
  )
}
