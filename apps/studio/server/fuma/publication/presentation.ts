import {
  PublicationContentSchema,
  PublicationPresentationDecisionSchema,
  PublicationPresentationRequestSchema,
  parsePublicationContract,
  type PublicationAudienceContext,
  type PublicationContent,
  type PublicationPresentationDecision,
  type PublicationPresentationRequest,
} from '@core/fuma/publication'

export class PublicationMetadataConflictError extends Error {
  readonly code = 'metadata-conflict'
  constructor(message: string) {
    super(message)
    this.name = 'PublicationMetadataConflictError'
  }
}

function contentPath(content: PublicationContent): string { return `/${content.metadata.slug}` }
function normalizedUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new PublicationMetadataConflictError('Canonical URL is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new PublicationMetadataConflictError('Canonical URL must be credential-free HTTPS without a fragment.')
  }
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  url.searchParams.sort()
  return url.toString()
}
function canonicalPath(value: string): string { return new URL(normalizedUrl(value)).pathname }

/** Validates the complete owner-generation/profile collection, not only one row. */
export function assertPublicationMetadataAuthority(items: readonly PublicationContent[]): void {
  const contents = items.map((item) => parsePublicationContract('content metadata authority', PublicationContentSchema, item))
  const ids = new Set<string>()
  const livePaths = new Map<string, string>()
  const canonicals = new Map<string, string>()
  const redirectSources = new Map<string, string>()
  for (const content of contents) {
    if (ids.has(content.contentId)) throw new PublicationMetadataConflictError('Publication content IDs must be unique in one authority scope.')
    ids.add(content.contentId)
    const path = contentPath(content)
    const pathOwner = livePaths.get(path)
    if (pathOwner && pathOwner !== content.contentId) throw new PublicationMetadataConflictError(`Content path ${path} conflicts with another record.`)
    livePaths.set(path, content.contentId)
    if (content.metadata.canonicalUrl !== null) {
      const canonical = normalizedUrl(content.metadata.canonicalUrl)
      const canonicalOwner = canonicals.get(canonical)
      if (canonicalOwner && canonicalOwner !== content.contentId) throw new PublicationMetadataConflictError('Canonical URL conflicts with another Publication record.')
      canonicals.set(canonical, content.contentId)
    }
    for (const redirect of content.metadata.redirects) {
      if (redirect.fromPath === redirect.toPath) throw new PublicationMetadataConflictError('Redirect source and destination must differ.')
      if (redirect.toPath !== path) throw new PublicationMetadataConflictError('Redirects must point directly to the current content path.')
      const sourceOwner = redirectSources.get(redirect.fromPath)
      if (sourceOwner && sourceOwner !== content.contentId) throw new PublicationMetadataConflictError(`Redirect source ${redirect.fromPath} conflicts with another record.`)
      redirectSources.set(redirect.fromPath, content.contentId)
    }
  }
  for (const content of contents) {
    const path = contentPath(content)
    if (redirectSources.has(path)) throw new PublicationMetadataConflictError(`Current content path ${path} cannot also be a redirect source.`)
    if (content.metadata.canonicalUrl !== null && redirectSources.has(canonicalPath(content.metadata.canonicalUrl))) {
      throw new PublicationMetadataConflictError('Canonical path cannot be a redirect source.')
    }
    for (const redirect of content.metadata.redirects) {
      if (redirectSources.has(redirect.toPath)) throw new PublicationMetadataConflictError('Redirect chains are forbidden; every redirect must resolve in one hop.')
    }
  }
}

export function replacePublicationAuthorityRecord(current: readonly PublicationContent[], candidate: PublicationContent): readonly PublicationContent[] {
  return Object.freeze([candidate, ...current.filter((item) => item.contentId !== candidate.contentId)])
}

function audienceAllowed(content: PublicationContent, audience: PublicationAudienceContext): boolean {
  const visibility = content.metadata.visibility
  if (visibility.kind === 'public') return true
  if (visibility.kind === 'member') return audience.member
  if (visibility.kind === 'paid') return audience.member && audience.paid
  return audience.member && visibility.segmentIds.some((segmentId) => audience.segmentIds.includes(segmentId))
}
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function semanticPreview(content: PublicationContent): string {
  const title = escapeHtml(content.metadata.title)
  const excerpt = escapeHtml(content.metadata.excerpt)
  return `<article data-publication-preview="safe"><header><h1>${title}</h1></header>${excerpt ? `<p>${excerpt}</p>` : ''}</article>`
}
function canonicalFor(content: PublicationContent, request: PublicationPresentationRequest): string {
  if (content.metadata.canonicalUrl !== null) return normalizedUrl(content.metadata.canonicalUrl)
  const origin = new URL(request.origin)
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new PublicationMetadataConflictError('Presentation origin must be credential-free HTTPS.')
  return new URL(contentPath(content), origin.origin).toString()
}
function head(content: PublicationContent) {
  const description = content.metadata.seoDescription ?? content.metadata.excerpt
  const socialDescription = content.metadata.openGraph.description ?? (description || null)
  return {
    title: content.metadata.seoTitle ?? content.metadata.title,
    description,
    openGraph: {
      ...content.metadata.openGraph,
      title: content.metadata.openGraph.title ?? content.metadata.seoTitle ?? content.metadata.title,
      description: socialDescription,
      imageId: content.metadata.openGraph.imageId ?? content.metadata.featureImageId,
    },
    social: {
      ...content.metadata.social,
      title: content.metadata.social.title ?? content.metadata.openGraph.title ?? content.metadata.seoTitle ?? content.metadata.title,
      description: content.metadata.social.description ?? socialDescription,
      imageId: content.metadata.social.imageId ?? content.metadata.openGraph.imageId ?? content.metadata.featureImageId,
    },
  }
}

/** Produces a data-only semantic decision; arbitrary document HTML is never executed or interpolated. */
export function decidePublicationPresentation(contentInput: PublicationContent, requestInput: PublicationPresentationRequest): PublicationPresentationDecision {
  const content = parsePublicationContract('presentation content', PublicationContentSchema, contentInput)
  const request = parsePublicationContract('presentation request', PublicationPresentationRequestSchema, requestInput)
  const metadata = head(content)
  const canonicalUrl = canonicalFor(content, request)
  const allowed = audienceAllowed(content, request.audience)
  const preview = request.mode === 'preview'
  const base = { access: allowed ? 'allowed' as const : 'denied' as const, preview, canonicalUrl, title: metadata.title, description: metadata.description, openGraph: metadata.openGraph, social: metadata.social }
  if (preview) return parsePublicationContract('presentation decision', PublicationPresentationDecisionSchema, {
    ...base, delivery: 'render', statusCode: 200, redirectLocation: null, robots: 'noindex,nofollow', html: semanticPreview(content), reason: 'preview',
  })
  if (content.status !== 'published') return parsePublicationContract('presentation decision', PublicationPresentationDecisionSchema, {
    ...base, title: 'Not found', description: '', openGraph: { title: null, description: null, imageId: null, type: content.kind === 'post' ? 'article' : 'website' }, social: { title: null, description: null, imageId: null, card: 'summary' }, delivery: 'unavailable', statusCode: 404, redirectLocation: null, robots: 'noindex,nofollow', html: null, reason: 'not-published',
  })
  if (!allowed) return parsePublicationContract('presentation decision', PublicationPresentationDecisionSchema, {
    ...base, title: 'Restricted content', description: '', openGraph: { title: null, description: null, imageId: null, type: content.kind === 'post' ? 'article' : 'website' }, social: { title: null, description: null, imageId: null, card: 'summary' }, delivery: 'deny', statusCode: 403, redirectLocation: null, robots: 'noindex,nofollow', html: null, reason: 'audience-denied',
  })
  const redirect = content.metadata.redirects.find((item) => item.fromPath === request.requestedPath)
  if (redirect) return parsePublicationContract('presentation decision', PublicationPresentationDecisionSchema, {
    ...base, delivery: 'redirect', statusCode: redirect.statusCode, redirectLocation: redirect.toPath, robots: 'noindex,nofollow', html: null, reason: 'redirect',
  })
  return parsePublicationContract('presentation decision', PublicationPresentationDecisionSchema, {
    ...base, delivery: 'render', statusCode: 200, redirectLocation: null, robots: 'index,follow', html: semanticPreview(content), reason: 'published',
  })
}
