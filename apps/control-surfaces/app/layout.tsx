import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = { title: 'Fuma control surfaces', robots: { index: false, follow: false } }

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en-KE"><body><header className="border-b bg-card"><nav aria-label="Control surfaces" className="mx-auto flex max-w-7xl gap-5 px-5 py-4 text-sm"><Link href="/internal">Platform console</Link><Link href="/marketplace">Marketplace</Link><Link href="/transfers">Transfers</Link><Link href="/secure-payment">Secure payment setup</Link></nav></header>{children}</body></html>
}
