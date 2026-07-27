import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AnalyticsBeacon } from '@/components/analytics-beacon'
import { ConsentBanner } from '@/components/consent-banner'
import { SiteShell } from '@/components/site-shell'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import { CANONICAL_ORIGIN } from '@/lib/seo'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN), title: { default: 'Fuma — own your publishing', template: '%s · Fuma' },
  description: 'Build an independent website or publication with Fuma.', applicationName: FUMA_PUBLIC_IDENTITY.product.name,
  alternates: { canonical: '/', languages: { 'en-KE': '/', 'x-default': '/' } },
  other: { 'content-language': 'en-KE' },
}
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) { return <html lang="en-KE"><head><link rel="alternate" type="application/rss+xml" title="Fuma RSS" href="/feeds/rss.xml"/><link rel="alternate" type="application/atom+xml" title="Fuma Atom" href="/feeds/atom.xml"/></head><body><a href="#main-content" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:translate-y-0">Skip to content</a><SiteShell>{children}<ConsentBanner /></SiteShell><AnalyticsBeacon /><WebVitalsReporter /></body></html> }
