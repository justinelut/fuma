import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import type { Metadata } from 'next'
export const CANONICAL_ORIGIN = `https://${FUMA_PUBLIC_IDENTITY.marketing.host}`
export function publicMetadata(title: string, description: string, pathname: string, noindex = false): Metadata {
  const canonical = new URL(pathname, CANONICAL_ORIGIN).toString()
  return { title, description, metadataBase: new URL(CANONICAL_ORIGIN), alternates: { canonical, languages: { 'en-KE': canonical, 'x-default': canonical } }, robots: noindex ? { index: false, follow: false } : { index: true, follow: true }, openGraph: { title, description, locale: 'en_KE', type: 'website', url: canonical, siteName: 'Fuma', images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: `${title} · Fuma` }] }, twitter: { card: 'summary_large_image', title, description } }
}
export function jsonLd(value: Readonly<Record<string, unknown>>) { return { __html: JSON.stringify(value).replace(/</g, '\\u003c') } }
