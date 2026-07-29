import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ApplicationStateProvider } from '../components/application-state'
import { NavigationStateProvider } from '../components/navigation-state'
import './site.css'

export const metadata: Metadata = { title: { default: 'Fuma site', template: '%s' }, robots: { index: true, follow: true } }

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><ApplicationStateProvider><NavigationStateProvider>{children}</NavigationStateProvider></ApplicationStateProvider></body></html>
}
