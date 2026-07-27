import { notFound } from 'next/navigation'

import { LegalPolicyPage } from '@/components/legal-policy-page'
import { PageMain } from '@/components/site-shell'
import { getEditorial } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

const LEGAL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

async function policy(slug: string) {
  return LEGAL_SLUG.test(slug) ? getEditorial('legal', slug) : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await policy(slug)
  return publicMetadata(
    entry?.meta.title ?? 'Policy unavailable',
    entry?.meta.description ?? 'The requested public policy is unavailable.',
    entry?.canonicalPath ?? '/legal/unavailable',
    !entry,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await policy(slug)
  if (!entry) notFound()
  return <PageMain className="max-w-6xl"><LegalPolicyPage entry={entry} /></PageMain>
}
