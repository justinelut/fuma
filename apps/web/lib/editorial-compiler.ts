import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'
import { Value } from '@sinclair/typebox/value'
import path from 'node:path'
import {
  EditorialFrontmatterSchema,
  type EditorialFrontmatter,
} from './public-web-contracts'

export type EditorialHeading = Readonly<{ id: string; text: string; depth: 2 | 3 }>
export type EditorialBlock =
  | Readonly<{ kind: 'heading'; heading: EditorialHeading }>
  | Readonly<{ kind: 'paragraph'; text: string }>
  | Readonly<{ kind: 'list'; items: readonly string[] }>
  | Readonly<{ kind: 'blockquote'; text: string }>
  | Readonly<{
      kind: 'code'
      code: string
      language: string | null
      component: 'CodeBlock' | null
    }>
  | Readonly<{ kind: 'callout'; text: string }>

export type EditorialEntry = Readonly<{
  meta: EditorialFrontmatter
  body: string
  blocks: readonly EditorialBlock[]
  headings: readonly EditorialHeading[]
  sourcePath: string
  canonicalPath: string
}>

export type EditorialSource = Readonly<{ source: string; sourcePath: string }>
export type EditorialSearchRecord = Readonly<{
  path: string
  title: string
  description: string
  text: string
  publishedAt: string
}>
export type EditorialSearchIndex = readonly EditorialSearchRecord[]

export type EditorialCompilation = Readonly<{
  allEntries: readonly EditorialEntry[]
  publicEntries: readonly EditorialEntry[]
  redirects: ReadonlyMap<string, string>
  searchIndex: EditorialSearchIndex
}>

const INTERNAL_MARKERS = [
  /\bFUMA-[A-Z]+-[0-9]+\b/i,
  /\b(?:internal|private|confidential)[_ -]?(?:plan|roadmap|runbook|key|secret)\b/i,
  /\b(?:security exploit|zero[ -]?day|credential dump)\b/i,
]
const COMPONENT_TAG = /<\/?([A-Z][A-Za-z0-9]*)\b[^>]*>/g
const LOWERCASE_HTML_TAG = /<\/?[a-z][^>]*>/i
const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const ALLOWED_COMPONENTS = new Set(['Callout', 'CodeBlock'])
const STATIC_PUBLIC_PATHS = new Set([
  '/', '/about', '/blog', '/changelog', '/components', '/contact', '/docs', '/experts', '/features',
  '/feeds/atom.xml', '/feeds/rss.xml', '/guides', '/legal/history', '/plugins',
  '/pricing', '/publication', '/security', '/showcase', '/solutions', '/start',
  '/status', '/templates', '/trust', '/website',
])

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[')) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return Symbol('invalid-json')
    }
  }
  return value.replace(/^['"]|['"]$/g, '')
}

function validTimestamp(value: string): boolean {
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) && new Date(epoch).toISOString().replace('.000Z', 'Z') === value
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function headingId(text: string): string {
  return text.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseBlocks(body: string, sourcePath: string): readonly EditorialBlock[] {
  const lines = body.split('\n')
  const blocks: EditorialBlock[] = []
  let cursor = 0
  const consumeUntilBlank = (): string[] => {
    const values: string[] = []
    while (cursor < lines.length && lines[cursor]!.trim() !== '') values.push(lines[cursor++]!)
    return values
  }

  while (cursor < lines.length) {
    const line = lines[cursor]!
    if (line.trim() === '') { cursor += 1; continue }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading) {
      const text = heading[2]!.trim()
      const id = headingId(text)
      if (!id) throw new Error(`Invalid heading: ${sourcePath}`)
      blocks.push({ kind: 'heading', heading: { depth: heading[1]!.length as 2 | 3, text, id } })
      cursor += 1
      continue
    }

    const fence = /^```([A-Za-z0-9_+#.-]*)\s*$/.exec(line)
    if (fence) {
      cursor += 1
      const code: string[] = []
      while (cursor < lines.length && lines[cursor] !== '```') code.push(lines[cursor++]!)
      if (cursor >= lines.length) throw new Error(`Unclosed code block: ${sourcePath}`)
      cursor += 1
      blocks.push({
        kind: 'code',
        code: code.join('\n'),
        language: fence[1] || null,
        component: null,
      })
      continue
    }

    if (line === '<Callout>') {
      cursor += 1
      const content: string[] = []
      while (cursor < lines.length && lines[cursor] !== '</Callout>') content.push(lines[cursor++]!)
      if (cursor >= lines.length || content.length === 0) throw new Error(`Malformed Callout: ${sourcePath}`)
      cursor += 1
      blocks.push({ kind: 'callout', text: content.join(' ').trim() })
      continue
    }

    const codeBlock = /^<CodeBlock(?: language="([A-Za-z0-9_+#.-]+)")?>$/.exec(line)
    if (codeBlock) {
      cursor += 1
      const code: string[] = []
      while (cursor < lines.length && lines[cursor] !== '</CodeBlock>') code.push(lines[cursor++]!)
      if (cursor >= lines.length) throw new Error(`Malformed CodeBlock: ${sourcePath}`)
      cursor += 1
      blocks.push({
        kind: 'code',
        code: code.join('\n'),
        language: codeBlock[1] || null,
        component: 'CodeBlock',
      })
      continue
    }

    if (line.startsWith('- ')) {
      const items: string[] = []
      while (cursor < lines.length && lines[cursor]!.startsWith('- ')) items.push(lines[cursor++]!.slice(2).trim())
      blocks.push({ kind: 'list', items: Object.freeze(items) })
      continue
    }

    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (cursor < lines.length && lines[cursor]!.startsWith('> ')) quote.push(lines[cursor++]!.slice(2))
      blocks.push({ kind: 'blockquote', text: quote.join(' ') })
      continue
    }

    blocks.push({ kind: 'paragraph', text: consumeUntilBlank().join(' ') })
  }
  return Object.freeze(blocks)
}

function visibleText(block: EditorialBlock): string {
  if (block.kind === 'heading') return block.heading.text
  if (block.kind === 'list') return block.items.join(' ')
  if (block.kind === 'code') return ''
  return block.text
}

function validateRenderableBlocks(
  blocks: readonly EditorialBlock[],
  declaredComponents: readonly string[],
  sourcePath: string,
): void {
  const renderable = blocks.filter((block) => block.kind !== 'code').map(visibleText).join('\n')
  for (const component of renderable.matchAll(COMPONENT_TAG)) {
    throw new Error(`Unapproved component ${component[1]} or malformed syntax: ${sourcePath}`)
  }
  if (LOWERCASE_HTML_TAG.test(renderable) || /on[a-z]+\s*=/i.test(renderable)) {
    throw new Error(`Unsafe markup: ${sourcePath}`)
  }
  for (const block of blocks) {
    if (block.kind === 'callout' && !declaredComponents.includes('Callout')) {
      throw new Error(`Undeclared component: ${sourcePath}`)
    }
    if (block.kind === 'code' && block.component === 'CodeBlock' && !declaredComponents.includes('CodeBlock')) {
      throw new Error(`Undeclared component: ${sourcePath}`)
    }
    if (block.kind === 'code' && block.language !== null && !/^[A-Za-z0-9_+#.-]+$/.test(block.language)) {
      throw new Error(`Unsafe code language: ${sourcePath}`)
    }
  }
}

export function isSafeEditorialHref(raw: string): boolean {
  if (raw.startsWith('#')) return /^#[a-z0-9][a-z0-9-]*$/.test(raw)
  if (raw.startsWith('/')) return !raw.startsWith('//') && /^\/[a-z0-9/#?&=._~-]*$/i.test(raw)
  if (/^(?:\.\.\/|\.\/)/.test(raw)) return /^[a-z0-9./#?&=_~-]+$/i.test(raw)
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function linksFrom(entry: EditorialEntry): readonly string[] {
  const links: string[] = []
  for (const block of entry.blocks) {
    if (block.kind === 'code') continue
    for (const match of visibleText(block).matchAll(MARKDOWN_LINK)) {
      if (match[1] === '!') throw new Error(`Unapproved embedded asset: ${entry.sourcePath}`)
      const href = match[3]!
      if (!isSafeEditorialHref(href)) throw new Error(`Unsafe link: ${entry.sourcePath}`)
      links.push(href)
    }
  }
  return links
}

export function parseEditorialSource(source: string, sourcePath = 'inline.md'): EditorialEntry {
  const normalized = source.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized)
  if (!match) throw new Error(`Missing frontmatter: ${sourcePath}`)
  if (INTERNAL_MARKERS.some((pattern) => pattern.test(normalized))) {
    throw new Error(`Internal material excluded: ${sourcePath}`)
  }

  const candidate: Record<string, unknown> = {}
  for (const line of match[1]!.split('\n')) {
    const split = line.indexOf(':')
    if (split < 1) throw new Error(`Malformed frontmatter: ${sourcePath}`)
    const key = line.slice(0, split).trim()
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`Malformed frontmatter: ${sourcePath}`)
    if (Object.hasOwn(candidate, key)) throw new Error(`Duplicate frontmatter key: ${sourcePath}`)
    candidate[key] = parseScalar(line.slice(split + 1))
  }
  if (!Value.Check(EditorialFrontmatterSchema, candidate)) throw new Error(`Invalid frontmatter: ${sourcePath}`)

  const meta = Object.freeze(candidate as EditorialFrontmatter)
  if (![meta.publishedAt, meta.updatedAt, meta.reviewAt].every(validTimestamp)) {
    throw new Error(`Invalid frontmatter timestamp: ${sourcePath}`)
  }
  const updateMs = Date.parse(meta.updatedAt)
  const reviewMs = Date.parse(meta.reviewAt)
  if (reviewMs < updateMs || reviewMs - updateMs > 366 * 24 * 60 * 60 * 1_000) {
    throw new Error(`Invalid review window: ${sourcePath}`)
  }
  if (meta.audience !== 'public') throw new Error(`Internal material excluded: ${sourcePath}`)
  if (meta.components.some((name) => !ALLOWED_COMPONENTS.has(name))) {
    throw new Error(`Unapproved component: ${sourcePath}`)
  }

  const body = match[2]!.trim()
  const blocks = parseBlocks(body, sourcePath)
  validateRenderableBlocks(blocks, meta.components, sourcePath)
  const headings = Object.freeze(blocks.filter((block): block is Extract<EditorialBlock, { kind: 'heading' }> => block.kind === 'heading').map((block) => block.heading))
  if (headings[0]?.depth === 3) {
    throw new Error(`Invalid heading hierarchy: ${sourcePath}`)
  }
  if (new Set(headings.map((heading) => heading.id)).size !== headings.length) {
    throw new Error(`Duplicate heading: ${sourcePath}`)
  }
  const canonicalPath = `/${meta.collection}/${meta.slug}`
  const entry: EditorialEntry = Object.freeze({ meta, body, blocks, headings, sourcePath, canonicalPath })
  linksFrom(entry)
  return entry
}

function normalizeInternalHref(href: string, entry: EditorialEntry): { pathname: string; hash: string } | null {
  if (href.startsWith('https:')) return null
  if (href.startsWith('#')) return { pathname: entry.canonicalPath, hash: href.slice(1) }
  const base = href.startsWith('/') ? href : path.posix.resolve(path.posix.dirname(entry.canonicalPath), href)
  const parsed = new URL(base, FUMA_WEB_DEPLOYMENT.origins.public)
  return { pathname: parsed.pathname.replace(/\/$/, '') || '/', hash: parsed.hash.slice(1) }
}

function validateLinks(
  entries: readonly EditorialEntry[],
  publicEntries: readonly EditorialEntry[],
  redirectOwners: ReadonlyMap<string, string>,
): void {
  const allByPath = new Map(entries.map((entry) => [entry.canonicalPath, entry]))
  const publicByPath = new Map(publicEntries.map((entry) => [entry.canonicalPath, entry]))
  for (const entry of entries) {
    const publicSource = publicByPath.has(entry.canonicalPath)
    for (const href of linksFrom(entry)) {
      const internal = normalizeInternalHref(href, entry)
      if (!internal) continue
      if (redirectOwners.has(internal.pathname)) throw new Error(`Link targets redirect: ${entry.sourcePath}`)
      const target = allByPath.get(internal.pathname)
      if (!target && !STATIC_PUBLIC_PATHS.has(internal.pathname)) throw new Error(`Broken internal link: ${entry.sourcePath}`)
      if (publicSource && target && !publicByPath.has(internal.pathname)) {
        throw new Error(`Public link targets unpublished content: ${entry.sourcePath}`)
      }
      if (internal.hash && target && !target.headings.some((heading) => heading.id === internal.hash)) {
        throw new Error(`Broken heading link: ${entry.sourcePath}`)
      }
    }
  }
}

export function buildEditorialSearchIndex(entries: readonly EditorialEntry[]): EditorialSearchIndex {
  return Object.freeze([...entries]
    .map((entry): EditorialSearchRecord => Object.freeze({
      path: entry.canonicalPath,
      title: entry.meta.title,
      description: entry.meta.description,
      text: entry.blocks.map(visibleText).join(' ').replace(/\s+/g, ' ').trim().toLowerCase(),
      publishedAt: entry.meta.publishedAt,
    }))
    .sort((left, right) => compareText(left.path, right.path)))
}

export function searchEditorialIndex(index: EditorialSearchIndex, query: string): readonly EditorialSearchRecord[] {
  const words = [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))].slice(0, 8)
  if (words.length === 0) return []
  return index
    .map((record) => {
      const title = record.title.toLowerCase()
      const description = record.description.toLowerCase()
      if (!words.every((word) => title.includes(word) || description.includes(word) || record.text.includes(word))) return null
      const score = words.reduce((total, word) => total + (title.includes(word) ? 4 : 0) + (description.includes(word) ? 2 : 0) + (record.text.includes(word) ? 1 : 0), 0)
      return { record, score }
    })
    .filter((result): result is { record: EditorialSearchRecord; score: number } => result !== null)
    .sort((left, right) => right.score - left.score || compareText(right.record.publishedAt, left.record.publishedAt) || compareText(left.record.path, right.record.path))
    .slice(0, 20)
    .map((result) => result.record)
}

export function compileEditorialSources(sources: readonly EditorialSource[], now = new Date()): EditorialCompilation {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid editorial clock')
  const entries = sources.map(({ source, sourcePath }) => parseEditorialSource(source, sourcePath))
  for (const entry of entries) {
    const normalizedPath = entry.sourcePath.replace(/\\/g, '/')
    const directoryCollection = /\/content\/public\/(docs|guides|blog|changelog|legal)\//.exec(normalizedPath)?.[1]
    if (directoryCollection && entry.meta.collection !== directoryCollection) {
      throw new Error(`Collection mismatch: ${entry.sourcePath}`)
    }
  }
  const canonicalOwners = new Map<string, string>()
  for (const entry of entries) {
    if (canonicalOwners.has(entry.canonicalPath)) throw new Error(`Colliding editorial slug: ${entry.canonicalPath}`)
    canonicalOwners.set(entry.canonicalPath, entry.sourcePath)
  }
  const redirectOwners = new Map<string, string>()
  const redirects = new Map<string, string>()
  for (const entry of entries) {
    for (const oldPath of entry.meta.redirects) {
      if (oldPath === entry.canonicalPath || canonicalOwners.has(oldPath) || redirectOwners.has(oldPath)) {
        throw new Error(`Colliding redirect: ${oldPath}`)
      }
      redirectOwners.set(oldPath, entry.sourcePath)
      redirects.set(oldPath, entry.canonicalPath)
    }
  }
  for (const [oldPath, canonicalPath] of redirects) {
    if (redirects.has(canonicalPath)) throw new Error(`Redirect chain: ${oldPath}`)
  }

  const publicEntries = entries
    .filter((entry) => !entry.meta.draft && Date.parse(entry.meta.publishedAt) <= now.getTime())
    .sort((left, right) => compareText(right.meta.publishedAt, left.meta.publishedAt) || compareText(left.canonicalPath, right.canonicalPath))
  const overdue = publicEntries.find((entry) => Date.parse(entry.meta.reviewAt) < now.getTime())
  if (overdue) throw new Error(`Editorial review overdue: ${overdue.sourcePath}`)
  validateLinks(entries, publicEntries, redirects)
  const publicPaths = new Set(publicEntries.map((entry) => entry.canonicalPath))
  const publicRedirects = new Map([...redirects].filter(([, target]) => publicPaths.has(target)))
  return Object.freeze({
    allEntries: Object.freeze(entries),
    publicEntries: Object.freeze(publicEntries),
    redirects: publicRedirects,
    searchIndex: buildEditorialSearchIndex(publicEntries),
  })
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function generateRss(entries: readonly EditorialEntry[], origin: string): string {
  const items = entries.map((entry) => `<item><title>${xml(entry.meta.title)}</title><link>${origin}${entry.canonicalPath}</link><guid isPermaLink="true">${origin}${entry.canonicalPath}</guid><description>${xml(entry.meta.description)}</description><author>${xml(entry.meta.author)}</author><category>${xml(entry.meta.category)}</category><pubDate>${new Date(entry.meta.publishedAt).toUTCString()}</pubDate></item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fuma</title><link>${origin}</link><description>Fuma public writing and changes</description><language>en-KE</language>${items}</channel></rss>`
}

export function generateAtom(entries: readonly EditorialEntry[], origin: string): string {
  const updated = [...entries].map((entry) => entry.meta.updatedAt).sort().at(-1) ?? '2026-01-01T00:00:00Z'
  const items = entries.map((entry) => `<entry><title>${xml(entry.meta.title)}</title><id>${origin}${entry.canonicalPath}</id><link href="${origin}${entry.canonicalPath}"/><published>${entry.meta.publishedAt}</published><updated>${entry.meta.updatedAt}</updated><author><name>${xml(entry.meta.author)}</name></author><category term="${xml(entry.meta.category)}"/><summary>${xml(entry.meta.description)}</summary></entry>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Fuma</title><id>${origin}</id><link href="${origin}/feeds/atom.xml" rel="self"/><updated>${updated}</updated>${items}</feed>`
}
