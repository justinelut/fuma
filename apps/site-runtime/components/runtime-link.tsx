import Link from 'next/link'
import type { Route } from 'next'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { resolveRuntimeLink } from '../lib/links'

export function RuntimeLink(props: Readonly<{
  value: string
  currentHost: string
  target?: '_self' | '_blank' | '_parent'
  decoration?: AnchorHTMLAttributes<HTMLAnchorElement>
  children: ReactNode
}>) {
  const target = resolveRuntimeLink(props.value, props.currentHost)
  const hardenedRel = props.target === '_blank' ? 'noopener noreferrer' : undefined
  if (target.kind === 'internal') {
    return <Link {...props.decoration} href={target.href as Route} target={props.target}>{props.children}</Link>
  }
  return <a {...props.decoration} href={target.href} target={props.target} rel={target.rel ?? hardenedRel}>{props.children}</a>
}
