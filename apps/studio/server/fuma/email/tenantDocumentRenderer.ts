import { createElement, type CSSProperties, type ReactNode } from 'react'
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
  render,
} from 'react-email'
import {
  EMAIL_DOCUMENT_MAX_OUTPUT_BYTES,
  parseEmailDocument,
  type EmailDocument,
  type EmailNode,
  type EmailStyle,
} from '@core/fuma/email'

export type RenderedEmailDocument = Readonly<{
  document: EmailDocument
  html: string
  text: string
}>

const TEXT_ENCODER = new TextEncoder()
const ACTIVE_HTML_PATTERN = /<\/?(?:script|iframe|object|embed|style|svg|math)\b|\son[a-z]+\s*=|(?:javascript|vbscript):/i
const UNSAFE_URL_ATTRIBUTE_PATTERN = /\s(?:href|src)=(?:"|')(?!https:\/\/|mailto:)/i

function styleProps(style: EmailStyle | undefined): { style?: CSSProperties } {
  if (!style) return {}
  const css: CSSProperties = { ...style }
  return { style: css }
}

function renderChildren(children: readonly EmailNode[], path: string): ReactNode[] {
  return children.map((node, index) => renderNode(node, `${path}.${index}`))
}

function renderNode(node: EmailNode, key: string): ReactNode {
  const props = { key, ...styleProps(node.style) }
  switch (node.type) {
    case 'container':
      return createElement(Container, props, ...renderChildren(node.children, `${key}.children`))
    case 'section':
      return createElement(Section, props, ...renderChildren(node.children, `${key}.children`))
    case 'row':
      return createElement(Row, {
        ...props,
        children: renderChildren(node.children, `${key}.children`),
      })
    case 'column':
      return createElement(
        Column,
        { ...props, width: node.width },
        ...renderChildren(node.children, `${key}.children`),
      )
    case 'text':
      return createElement(Text, props, node.text)
    case 'heading':
      return createElement(Heading, { ...props, as: `h${node.level}` }, node.text)
    case 'link':
      return createElement(Link, { ...props, href: node.href }, node.text)
    case 'button':
      return createElement(Button, { ...props, href: node.href }, node.text)
    case 'image':
      return createElement(Img, {
        ...props,
        src: node.src,
        alt: node.alt,
        width: node.width,
        height: node.height,
      })
    case 'divider':
      return createElement(Hr, props)
    case 'spacer': {
      const spacerStyle: CSSProperties = {
        ...props.style,
        fontSize: '1px',
        height: node.height,
        lineHeight: node.height,
      }
      return createElement(Section, { key, style: spacerStyle }, '\u00a0')
    }
  }
}

function createTenantElement(document: EmailDocument): ReactNode {
  const bodyStyle: CSSProperties | undefined = document.bodyStyle
    ? { ...document.bodyStyle }
    : undefined
  return createElement(
    Html,
    { lang: document.lang ?? 'en', dir: document.direction ?? 'ltr' },
    createElement(Head),
    document.previewText ? createElement(Preview, null, document.previewText) : null,
    createElement(
      Body,
      { style: bodyStyle },
      ...renderChildren(document.children, 'children'),
    ),
  )
}

function assertSafeRenderedOutput(html: string, text: string): void {
  if (ACTIVE_HTML_PATTERN.test(html) || UNSAFE_URL_ATTRIBUTE_PATTERN.test(html)) {
    throw new Error('FUMA-042 renderer invariant: unsafe active HTML escaped the EmailDocument allowlist')
  }
  const outputBytes = TEXT_ENCODER.encode(html).byteLength + TEXT_ENCODER.encode(text).byteLength
  if (outputBytes > EMAIL_DOCUMENT_MAX_OUTPUT_BYTES) {
    throw new Error(`FUMA-042 renderer invariant: output exceeds ${EMAIL_DOCUMENT_MAX_OUTPUT_BYTES} bytes`)
  }
}

/**
 * Validates an untyped tenant document, interprets its closed component
 * allowlist, and renders deterministic HTML and plaintext. This module has no
 * JSX/code-loading surface: tenant input can only select schema literals.
 */
export async function renderEmailDocument(input: unknown): Promise<RenderedEmailDocument> {
  const document = parseEmailDocument(input)
  const element = createTenantElement(document)
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])
  assertSafeRenderedOutput(html, text)
  return Object.freeze({ document, html, text })
}
