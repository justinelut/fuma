import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import type { ReactNode } from 'react'
import { AnalyticsBeacon } from '@/components/analytics-beacon'
import { ConsentBanner } from '@/components/consent-banner'
import { SiteShell } from '@/components/site-shell'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import { CANONICAL_ORIGIN } from '@/lib/seo'
import './globals.css'

/**
 * Three type roles, deliberately cast:
 *   display — Plus Jakarta Sans, used only for hero and section headings.
 *   body    — Inter, demoted to running text so it stops setting the tone.
 *   mono    — the platform monospace stack, used as a utility co-star for evidence and source.
 *             Keeping this role native preserves the 100 kB acquisition font budget.
 */
// The reference site uses GT Walsheim, a commercially licensed face. Plus Jakarta Sans is
// the closest freely licensed geometric grotesque; this is a deliberate substitution.
const display = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN), title: { default: 'Fuma — own your publishing', template: '%s · Fuma' },
  description: 'Build an independent website or publication with Fuma.', applicationName: FUMA_PUBLIC_IDENTITY.product.name,
  alternates: {
    canonical: '/',
    languages: { 'en-KE': '/', 'x-default': '/' },
    types: {
      'application/rss+xml': '/feeds/rss.xml',
      'application/atom+xml': '/feeds/atom.xml',
    },
  },
  other: { 'content-language': 'en-KE' },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en-KE" className={`${display.variable} ${body.variable}`}>
    <body>
      <a href="#main-content" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:translate-y-0">Skip to content</a>
      <SiteShell>{children}<ConsentBanner /></SiteShell>
      <AnalyticsBeacon />
      <WebVitalsReporter />
    </body>
  </html>
}
