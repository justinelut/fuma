import type { ReactNode } from 'react'
import { render } from 'react-email'

export type RenderedTrustedSystemTemplate = Readonly<{
  html: string
  text: string
}>

/**
 * Renders a React tree authored and imported by the server. Never pass tenant
 * data as a component, source string, callback, import path, or JSX module to
 * this boundary; tenant documents use tenantDocumentRenderer.ts instead.
 */
export async function renderTrustedSystemTemplate(
  serverAuthoredTemplate: ReactNode,
): Promise<RenderedTrustedSystemTemplate> {
  const [html, text] = await Promise.all([
    render(serverAuthoredTemplate),
    render(serverAuthoredTemplate, { plainText: true }),
  ])
  return Object.freeze({ html, text })
}
