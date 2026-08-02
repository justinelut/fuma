import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import lifecycleEvidence from './evidence/fuma-web-008-lifecycle.json'
import { EditorialContent } from '../components/editorial-content'
import {
  compileDiskEditorial,
  compileEditorialSources,
  generateAtom,
  generateRss,
  getEditorialPreview,
  parseEditorialSource,
  readEditorial,
  resolveEditorialRedirect,
  searchCompiledEditorial,
  searchEditorial,
  type EditorialSource,
} from '../lib/editorial'

const CLOCK = new Date('2026-07-26T12:00:00Z')
const ORIGIN = 'https://trimly.co.ke'

type SourceOptions = Readonly<{
  title?: string
  slug?: string
  collection?: 'docs' | 'guides' | 'blog' | 'changelog' | 'legal'
  publishedAt?: string
  updatedAt?: string
  reviewAt?: string
  draft?: boolean
  redirects?: readonly string[]
  components?: readonly ('Callout' | 'CodeBlock')[]
  audience?: string
  body?: string
  extra?: string
  sourcePath?: string
}>

function source(options: SourceOptions = {}): EditorialSource {
  const collection = options.collection ?? 'docs'
  const slug = options.slug ?? 'safe-entry'
  const redirects = JSON.stringify(options.redirects ?? [])
  const components = JSON.stringify(options.components ?? [])
  return {
    sourcePath: options.sourcePath ?? `/content/public/${collection}/${slug}.mdx`,
    source: `---
title: ${options.title ?? 'Safe entry'}
description: A deterministic public editorial fixture.
slug: ${slug}
collection: ${collection}
author: Fuma Docs
category: Foundations
publishedAt: ${options.publishedAt ?? '2026-07-26T00:00:00Z'}
updatedAt: ${options.updatedAt ?? '2026-07-26T00:00:00Z'}
reviewAt: ${options.reviewAt ?? '2026-10-26T00:00:00Z'}
draft: ${options.draft ?? false}
version: 1.0
redirects: ${redirects}
components: ${components}
owner: Documentation
audience: ${options.audience ?? 'public'}${options.extra ? `\n${options.extra}` : ''}
---
${options.body ?? '## Safe heading\n\nPublic copy.'}`,
  }
}

function compile(items: readonly EditorialSource[], now = CLOCK) {
  return compileEditorialSources(items, now)
}

describe('validated Git Markdown and MDX editorial compiler', () => {
  test('enforces strict TypeBox frontmatter, review windows, and explicit public audience', () => {
    const entry = parseEditorialSource(source().source)
    expect(entry.meta.slug).toBe('safe-entry')
    expect(entry.headings).toEqual([{ depth: 2, text: 'Safe heading', id: 'safe-heading' }])
    expect(() => parseEditorialSource(source({ extra: 'secret: hidden' }).source)).toThrow('Invalid frontmatter')
    expect(() => parseEditorialSource(source({ reviewAt: '2028-01-01T00:00:00Z' }).source)).toThrow('Invalid review window')
    expect(() => compile([source({ reviewAt: '2026-07-26T00:00:00Z' })])).toThrow('Editorial review overdue')
    expect(() => parseEditorialSource(source({ audience: 'internal' }).source)).toThrow('Invalid frontmatter')
    expect(() => parseEditorialSource(source({ body: 'Internal plan for a public launch.' }).source)).toThrow('Internal material excluded')
    expect(() => parseEditorialSource(source({ body: 'Security exploit reproduction details.' }).source)).toThrow('Internal material excluded')
  })

  test('rejects malformed metadata, duplicate keys, timestamps, and colliding slugs', () => {
    expect(() => parseEditorialSource('no frontmatter')).toThrow('Missing frontmatter')
    expect(() => parseEditorialSource(source({ extra: 'title: Duplicate' }).source)).toThrow('Duplicate frontmatter key')
    expect(() => parseEditorialSource(source().source.replace('redirects: []', 'redirects: [broken'))).toThrow('Invalid frontmatter')
    expect(() => parseEditorialSource(source({ updatedAt: 'not-a-date' }).source)).toThrow('Invalid frontmatter')
    expect(() => compile([source({ collection: 'blog', sourcePath: '/content/public/docs/wrong.md' })])).toThrow('Collection mismatch')
    expect(() => compile([source(), source({ sourcePath: '/other.md' })])).toThrow('Colliding editorial slug')
    expect(() => parseEditorialSource(source({ body: '### Skipped heading level\n\nCopy.' }).source)).toThrow('Invalid heading hierarchy')
  })

  test('excludes draft and future content from public reads, redirects, search, and feeds', () => {
    const published = source({ slug: 'published', body: '## Public\n\nEligible searchable phrase.' })
    const draft = source({ slug: 'draft', draft: true, redirects: ['/docs/draft-old'], body: 'Draft leakage phrase.' })
    const future = source({ slug: 'future', publishedAt: '2027-01-01T00:00:00Z', body: 'Future leakage phrase.' })
    const result = compile([published, draft, future])
    expect(result.publicEntries.map((entry) => entry.meta.slug)).toEqual(['published'])
    expect(result.redirects.has('/docs/draft-old')).toBe(false)
    expect(searchCompiledEditorial(result, 'leakage phrase')).toEqual([])
    expect(generateRss(result.publicEntries, ORIGIN)).not.toContain('/docs/draft')
    expect(generateAtom(result.publicEntries, ORIGIN)).not.toContain('/docs/future')
  })

  test('allows only declared safe MDX components while preserving escaped code examples', () => {
    const safe = source({
      components: ['Callout', 'CodeBlock'],
      body: `## Components

<Callout>
A reviewed **note**.
</Callout>

<CodeBlock language="typescript">
const sample = '<script>text only</script>'
</CodeBlock>`,
    })
    const entry = parseEditorialSource(safe.source)
    expect(entry.blocks.map((block) => block.kind)).toEqual(['heading', 'callout', 'code'])
    expect(() => parseEditorialSource(source({ body: '<Unreviewed />' }).source)).toThrow('Unapproved component')
    expect(() => parseEditorialSource(source({ body: '<Callout>undeclared</Callout>' }).source)).toThrow('Unapproved component')
    expect(() => parseEditorialSource(source({
      body: '<CodeBlock language="typescript">\nconst unsafe = true\n</CodeBlock>',
    }).source)).toThrow('Undeclared component')
    expect(() => parseEditorialSource(source({ body: '<div onclick="run()">unsafe</div>' }).source)).toThrow('Unsafe markup')
  })

  test('fails broken/noncanonical links, fragments, unsafe URLs, and redirect chains', () => {
    const target = source({ slug: 'target', body: '## Existing target\n\nTarget.' })
    expect(() => compile([target, source({ slug: 'broken', body: '[Missing](/docs/missing)' })])).toThrow('Broken internal link')
    expect(() => compile([target, source({ slug: 'fragment', body: '[Missing heading](/docs/target#missing)' })])).toThrow('Broken heading link')
    expect(() => parseEditorialSource(source({ body: '[Unsafe](javascript:alert(1))' }).source)).toThrow('Unsafe link')

    const renamed = source({ slug: 'renamed', redirects: ['/docs/old'] })
    expect(() => compile([renamed, source({ slug: 'linker', body: '[Old](/docs/old)' })])).toThrow('Link targets redirect')
    const chainShape = source({ slug: 'old', redirects: ['/docs/older'] })
    expect(() => compile([renamed, chainShape])).toThrow('Colliding redirect')
  })

  test('produces deterministic feed and search output independent of source order', () => {
    const alpha = source({ title: 'Alpha release', slug: 'alpha', collection: 'blog', body: '## Launch\n\nDeterministic search phrase.' })
    const beta = source({ title: 'Beta release', slug: 'beta', collection: 'changelog', body: '## Launch\n\nDeterministic search phrase.' })
    const forward = compile([alpha, beta])
    const reverse = compile([beta, alpha])
    expect(forward.searchIndex).toEqual(reverse.searchIndex)
    expect(searchCompiledEditorial(forward, 'deterministic search').map((entry) => entry.canonicalPath)).toEqual(
      searchCompiledEditorial(reverse, 'deterministic search').map((entry) => entry.canonicalPath),
    )
    expect(generateRss(forward.publicEntries, ORIGIN)).toBe(generateRss(reverse.publicEntries, ORIGIN))
    expect(generateAtom(forward.publicEntries, ORIGIN)).toBe(generateAtom(reverse.publicEntries, ORIGIN))
  })

  test('renders an accessible TOC, callout, and keyboard-scrollable escaped code block', () => {
    const entry = parseEditorialSource(source({
      components: ['Callout', 'CodeBlock'],
      body: `## Accessible output

<Callout>
A useful note.
</Callout>

<CodeBlock language="typescript">
const html = '<script>escaped</script>'
const component = '<Unreviewed />'
</CodeBlock>`,
    }).source)
    const html = renderToStaticMarkup(createElement(EditorialContent, { entry }))
    expect(html).toContain('aria-label="On this page"')
    expect(html).toContain('aria-label="Note"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="typescript code example"')
    expect(html).toContain('&lt;script&gt;escaped&lt;/script&gt;')
    expect(html).toContain('&lt;Unreviewed /&gt;')
    expect(html).not.toContain('<script>escaped</script>')
  })
})

describe('real disk collection and committed lifecycle evidence', () => {
  test('loads Markdown and MDX, generated search, draft preview, and canonical redirects', async () => {
    const compilation = await compileDiskEditorial(CLOCK)
    expect(compilation.publicEntries.some((entry) => entry.sourcePath.endsWith('.mdx'))).toBe(true)
    expect((await readEditorial(false, CLOCK)).some((entry) => entry.meta.slug === 'editorial-preview-workflow')).toBe(false)
    expect(await getEditorialPreview('blog', 'editorial-preview-workflow', CLOCK)).not.toBeNull()
    expect((await searchEditorial('reviewed components', CLOCK)).map((entry) => entry.meta.slug)).toContain('safe-components-and-code')
    expect(await resolveEditorialRedirect('/docs/quick-start', CLOCK)).toBe('/docs/getting-started')
  })

  test('executes preview → publish → search → slug change → canonical redirect/feed demo', () => {
    const draft = source({
      title: 'Editorial lifecycle',
      slug: 'editorial-lifecycle',
      collection: 'blog',
      draft: true,
      publishedAt: '2026-08-01T00:00:00Z',
      body: '## Lifecycle\n\nDeterministic lifecycle demonstration.',
    })
    const preview = compile([draft])
    const previewFeed = generateRss(preview.publicEntries, ORIGIN)

    const published = source({
      title: 'Editorial lifecycle',
      slug: 'editorial-lifecycle',
      collection: 'blog',
      body: '## Lifecycle\n\nDeterministic lifecycle demonstration.',
    })
    const publish = compile([published])
    const publishFeed = generateRss(publish.publicEntries, ORIGIN)

    const renamed = source({
      title: 'Validated editorial lifecycle',
      slug: 'validated-editorial-lifecycle',
      collection: 'blog',
      redirects: ['/blog/editorial-lifecycle'],
      body: '## Lifecycle\n\nDeterministic lifecycle demonstration.',
    })
    const slugChange = compile([renamed])
    const renamedFeed = generateRss(slugChange.publicEntries, ORIGIN)
    const oldCanonical = `${ORIGIN}/blog/editorial-lifecycle`
    const newCanonical = `${ORIGIN}/blog/validated-editorial-lifecycle`

    const actual = {
      ticket: 'FUMA-WEB-008',
      clock: CLOCK.toISOString().replace('.000Z', 'Z'),
      preview: {
        path: '/preview/blog/editorial-lifecycle',
        draftVisible: preview.allEntries.some((entry) => entry.meta.slug === 'editorial-lifecycle'),
        publicVisible: preview.publicEntries.some((entry) => entry.meta.slug === 'editorial-lifecycle'),
        searchPaths: searchCompiledEditorial(preview, 'deterministic lifecycle').map((entry) => entry.canonicalPath),
        feedContainsCanonical: previewFeed.includes(oldCanonical),
      },
      publish: {
        canonicalPath: publish.publicEntries[0]!.canonicalPath,
        publicVisible: publish.publicEntries.some((entry) => entry.meta.slug === 'editorial-lifecycle'),
        searchPaths: searchCompiledEditorial(publish, 'deterministic lifecycle').map((entry) => entry.canonicalPath),
        feedContainsCanonical: publishFeed.includes(oldCanonical),
      },
      slugChange: {
        canonicalPath: slugChange.publicEntries[0]!.canonicalPath,
        oldPath: '/blog/editorial-lifecycle',
        redirectTarget: slugChange.redirects.get('/blog/editorial-lifecycle'),
        searchPaths: searchCompiledEditorial(slugChange, 'deterministic lifecycle').map((entry) => entry.canonicalPath),
        feedContainsCanonical: renamedFeed.includes(newCanonical),
        feedContainsOldCanonical: renamedFeed.includes(`<link>${oldCanonical}</link>`),
      },
    }
    expect(actual).toEqual(lifecycleEvidence)
  })
})
