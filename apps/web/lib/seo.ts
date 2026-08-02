import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'
import type { Metadata } from 'next'
import type { EditorialEntry } from './editorial-compiler'
import { SOCIAL_CARD } from './social-card'
import { serializeStructuredData } from './structured-data'

export const CANONICAL_ORIGIN = FUMA_WEB_DEPLOYMENT.origins.public
export const RSS_URL = `${CANONICAL_ORIGIN}/feeds/rss.xml`
export const ATOM_URL = `${CANONICAL_ORIGIN}/feeds/atom.xml`
export const SOCIAL_CARD_URL = `${CANONICAL_ORIGIN}${SOCIAL_CARD.pathname}`

const PUBLIC_PATH = /^\/(?:[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)*)?$/
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

type PublicMetadataOptions = Readonly<{
  noindex?: boolean
  kind?: 'website' | 'article'
  publishedTime?: string
  modifiedTime?: string
  authors?: readonly string[]
  section?: string
}>

function boundedText(value: string, field: 'title' | 'description'): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const maximum = field === 'title' ? 80 : 240
  if (!normalized || normalized.length > maximum || hasControlCharacter(normalized)) {
    throw new TypeError(`Public metadata ${field} is invalid.`)
  }
  return normalized
}

export function canonicalPublicUrl(pathname: string): string {
  if (!PUBLIC_PATH.test(pathname) || pathname.startsWith('//') || (pathname !== '/' && pathname.endsWith('/'))) {
    throw new TypeError('Canonical pathname must be a normalized query-free public path.')
  }
  const url = new URL(pathname, CANONICAL_ORIGIN)
  if (url.origin !== CANONICAL_ORIGIN || url.pathname !== pathname || url.search || url.hash) {
    throw new TypeError('Canonical pathname escaped the public origin.')
  }
  return url.toString()
}

export function publicMetadata(
  titleValue: string,
  descriptionValue: string,
  pathname: string,
  noindexOrOptions: boolean | PublicMetadataOptions = false,
): Metadata {
  const options: PublicMetadataOptions = typeof noindexOrOptions === 'boolean'
    ? { noindex: noindexOrOptions }
    : noindexOrOptions
  const title = boundedText(titleValue, 'title')
  const description = boundedText(descriptionValue, 'description')
  const canonical = canonicalPublicUrl(pathname)
  const noindex = options.noindex === true
  const image = {
    url: SOCIAL_CARD_URL,
    secureUrl: SOCIAL_CARD_URL,
    width: SOCIAL_CARD.width,
    height: SOCIAL_CARD.height,
    type: SOCIAL_CARD.contentType,
    alt: SOCIAL_CARD.alt,
  }

  return {
    title,
    description,
    metadataBase: new URL(CANONICAL_ORIGIN),
    alternates: {
      canonical,
      languages: { 'en-KE': canonical, 'x-default': canonical },
      types: {
        'application/rss+xml': RSS_URL,
        'application/atom+xml': ATOM_URL,
      },
    },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      title,
      description,
      locale: 'en_KE',
      type: options.kind ?? 'website',
      url: canonical,
      siteName: FUMA_PUBLIC_IDENTITY.product.name,
      images: [image],
      ...(options.kind === 'article'
        ? {
            publishedTime: options.publishedTime,
            modifiedTime: options.modifiedTime,
            authors: options.authors ? [...options.authors] : undefined,
            section: options.section,
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: SOCIAL_CARD_URL, alt: SOCIAL_CARD.alt }],
    },
  }
}

export function editorialMetadata(entry: EditorialEntry | null, pathname: string, fallbackTitle: string): Metadata {
  if (!entry) return publicMetadata(fallbackTitle, 'This reviewed public entry is unavailable.', pathname, { noindex: true })
  return publicMetadata(entry.meta.title, entry.meta.description, entry.canonicalPath, {
    kind: 'article',
    publishedTime: entry.meta.publishedAt,
    modifiedTime: entry.meta.updatedAt,
    authors: [entry.meta.author],
    section: entry.meta.category,
  })
}

export function jsonLd(value: Readonly<Record<string, unknown>>) {
  return { __html: serializeStructuredData(value) }
}
