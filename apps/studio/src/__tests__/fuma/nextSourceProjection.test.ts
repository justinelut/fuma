import { describe, expect, test } from 'bun:test'
import { analyzeNextSource } from '@core/siteImport/analyzeNextSource'
import type { FileMap } from '@core/siteImport/types'
import type { NextSourceDraftRevision } from '@core/siteImport'
import { CoreSemanticReleaseRenderer } from '../../../server/fuma/publishing/semanticRenderer'
import { NextSourceProjectionError, projectNextSourceRevision } from '../../../server/fuma/nextSource/projection'

const encoder = new TextEncoder()

function files(entries: Readonly<Record<string, string>>): FileMap {
  return {
    files: Object.fromEntries(Object.entries(entries).map(([path, source]) => [path, { bytes: encoder.encode(source) }])),
  }
}

const destination = Object.freeze({
  organizationId: 'organization-main',
  workspaceId: 'workspace-main',
  siteId: 'site-main',
})

async function revisionFor(fileMap: FileMap): Promise<NextSourceDraftRevision> {
  const analysis = await analyzeNextSource(fileMap, {
    destination,
    provenance: { kind: 'file-map', locator: 'projection-test' },
  })
  return {
    revisionId: 'next-draft:projection-test',
    destination,
    provenance: analysis.provenance,
    parentRevisionId: null,
    sourceHashSha256: analysis.sourceHashSha256,
    analysis,
    fixReceiptIds: [],
    state: 'draft',
    createdAt: '2026-08-03T10:00:00.000Z',
  }
}

describe('FUMA-077 deterministic static editor projection', () => {
  test('projects exact stored source into a stable editor document and canonical semantic artifacts', async () => {
    const fileMap = files({
      'app/page.tsx': `
        import './global.css'
        export default function Home() {
          return <main className="landing" aria-label="Landing">
            <h1>Source-owned website</h1>
            <p style={{ color: 'navy', marginTop: 12 }}>Portable content</p>
            <a href="/about" target="_self">About</a>
          </main>
        }
      `,
      'app/global.css': '.landing { max-width: 70rem; margin: 0 auto; }',
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)
    const first = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const second = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    expect(second).toEqual(first)
    expect(first.document.site.id).toBe(destination.siteId)
    expect(first.document.pages).toHaveLength(1)
    expect(first.document.pages[0]?.slug).toBe('index')
    expect(first.document.pages[0]?.title).toBe('Source-owned website')
    expect(first.document.site.files).toHaveLength(1)
    expect(first.documentHashSha256).toMatch(/^[a-f0-9]{64}$/)

    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main',
        organizationId: destination.organizationId,
        workspaceId: destination.workspaceId,
        siteId: destination.siteId,
        ownerKey: 'owner-key-main',
        state: 'active',
        generation: 7,
        transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-main',
      hashSha256: 'a'.repeat(64),
      immutableRevision: '1',
      document: first.document,
    })) artifacts.push(artifact)
    const html = artifacts.find(({ logicalPath }) => logicalPath === '/index.html')
    expect(html).toBeDefined()
    const rendered = new TextDecoder().decode(html!.bytes)
    expect(rendered).toContain('<main')
    expect(rendered).toContain('class="landing"')
    expect(rendered).toContain('<h1>Source-owned website</h1>')
    expect(rendered).toContain('Portable content')
    expect(artifacts.some(({ mimeType, bytes }) => mimeType === 'text/css' && new TextDecoder().decode(bytes).includes('.landing'))).toBe(true)
  })

  test('inlines analyzed local and imported components with bounded static props and text children without execution', async () => {
    const fileMap = files({
      'app/page.tsx': `
        import Header, { Footer } from '../components/Chrome'
        export default function Page() { return <main><Header title="Fuma" className="hero"/><p>Body</p><Footer>Owned footer</Footer></main> }
      `,
      'components/Chrome.tsx': [
        'const Mark = () => <strong>Fuma</strong>',
        "export default function Header({ title, className = '' }: { title: string; className?: string }) { return <header className={className}><h1>{`Welcome ${title}`}</h1><Mark/></header> }",
        'export function Footer({ children }: { children: string }) { return <footer>{children}</footer> }',
      ].join('\n'),
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)
    expect(revision.analysis.modules.map(({ path }) => path)).toEqual(['app/page.tsx', 'components/Chrome.tsx'])

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main',
        organizationId: destination.organizationId,
        workspaceId: destination.workspaceId,
        siteId: destination.siteId,
        ownerKey: 'owner-key-main',
        state: 'active',
        generation: 7,
        transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-components',
      hashSha256: 'b'.repeat(64),
      immutableRevision: '1',
      document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!.bytes)
    expect(html).toContain('<header class="hero"><h1>Welcome Fuma</h1><strong>Fuma</strong></header>')
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain('<footer>Owned footer</footer>')
  })

  test('projects hash-bound public images and emits exact immutable asset bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const fileMap = files({
      'app/page.tsx': 'export default function Page(){ return <main><img src="/photo.png" alt="Portrait" loading="lazy"/></main> }',
    })
    fileMap.files['public/photo.png'] = { bytes: png }
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)
    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    expect(projection.document.site.files.find(({ path }) => path === 'public/photo.png')).toMatchObject({
      type: 'asset',
      blob: { mimeType: 'image/png', base64: Buffer.from(png).toString('base64') },
    })

    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main',
        organizationId: destination.organizationId,
        workspaceId: destination.workspaceId,
        siteId: destination.siteId,
        ownerKey: 'owner-key-main',
        state: 'active',
        generation: 7,
        transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-assets',
      hashSha256: 'c'.repeat(64),
      immutableRevision: '1',
      document: projection.document,
    })) artifacts.push(artifact)
    const image = artifacts.find(({ logicalPath }) => logicalPath === '/photo.png')
    expect(image).toMatchObject({ kind: 'asset', mimeType: 'image/png', references: [] })
    expect(image?.bytes).toEqual(png)
    const html = artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!
    expect(new TextDecoder().decode(html.bytes)).toContain('<img')
    expect(new TextDecoder().decode(html.bytes)).toContain('alt="Portrait"')
    expect(html.references).toContain('/photo.png')
  })

  test('projects bounded immutable data collections, local component maps, conditional JSX, and nested static routes', async () => {
    const fileMap = files({
      'app/guides/getting-started/page.tsx': `
        const cards = [
          { slug: 'install', title: 'Install', featured: true },
          { slug: 'publish', title: 'Publish', featured: false },
        ] as const
        function Card({ card, index }: { card: { slug: string; title: string; featured: boolean }; index: number }) {
          return <article data-position={index}><h2>{card.title}</h2>{card.featured && <strong>Featured</strong>}<a href={\`/guides/${'${card.slug}'}\`}>Open</a></article>
        }
        export default function Guide() {
          const heading = 'Getting started'
          return <main><h1>{heading}</h1><section>{cards.map((card, index) => <Card key={card.slug} card={card} index={index}/>)}</section></main>
        }
      `,
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    expect(projection.document.pages[0]).toMatchObject({ slug: 'guides/getting-started', title: 'Getting started' })

    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-key-main', state: 'active', generation: 7, transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-data', hashSha256: 'd'.repeat(64), immutableRevision: '1', document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/guides-getting-started.html')!.bytes)
    expect(html).toContain('<h1>Getting started</h1>')
    expect(html).toContain('<h2>Install</h2><strong>Featured</strong><a href="/guides/install"')
    expect(html).toContain('<h2>Publish</h2><a href="/guides/publish"')
  })


  test('projects allowlisted Next link/image components and bounded imported JSON collections without runtime execution', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const fileMap = files({
      'app/page.tsx': `
        import Link from 'next/link'
        import Image from 'next/image'
        import cards from '../content/cards.json'
        const Card = ({ card, index }: { card: { slug: string; title: string; featured: boolean }; index: number }) => (
          <article className={card.featured ? 'featured' : 'standard'} data-position={index}>
            <Link href={\`/guides/${'${card.slug}'}\`} prefetch={false}><h2>{card.title}</h2></Link>
          </article>
        )
        export default function Page() {
          return <main><h1>Guides</h1><Image src="/cover.png" alt="Guide cover" width={640} height={360} priority />{cards.slice(0, 2).map((card, index) => <Card key={card.slug} card={card} index={index} />)}</main>
        }
      `,
      'content/cards.json': JSON.stringify([
        { slug: 'install', title: 'Install', featured: true },
        { slug: 'publish', title: 'Publish', featured: false },
        { slug: 'ignored', title: 'Ignored', featured: false },
      ]),
    })
    fileMap.files['public/cover.png'] = { bytes: png }
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)
    expect(revision.analysis.modules[0]?.imports.map(({ specifier, policy }) => [specifier, policy])).toContainEqual(['next/link', 'supported'])
    expect(revision.analysis.modules[0]?.imports.map(({ specifier, resolvedPath }) => [specifier, resolvedPath])).toContainEqual(['../content/cards.json', 'content/cards.json'])

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-key-main', state: 'active', generation: 7, transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-framework-data', hashSha256: 'e'.repeat(64), immutableRevision: '1', document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!.bytes)
    expect(html).toContain('<img')
    expect(html).toContain('src="/cover.png"')
    expect(html).toContain('<article class="featured" data-position="0"><a href="/guides/install"')
    expect(html).toContain('<h2>Install</h2>')
    expect(html).toContain('<article class="standard" data-position="1"><a href="/guides/publish"')
    expect(html).not.toContain('Ignored')
    expect(artifacts.find(({ logicalPath }) => logicalPath === '/cover.png')?.bytes).toEqual(png)
  })

  test('projects bounded inline collection predicates and chained static selection without callback execution', async () => {
    const fileMap = files({
      'app/page.tsx': `
        const cards = [
          { slug: 'install', title: 'Install', published: true, featured: true },
          { slug: 'publish', title: 'Publish', published: true, featured: false },
          { slug: 'draft', title: 'Draft', published: false, featured: false },
          { slug: 'later', title: 'Later', published: true, featured: false },
        ] as const
        export default function Page() {
          const visible = cards.filter(({ published }, index) => published && index < 3).slice(0, 2)
          const selected = visible.find((card) => card.slug === 'install')
          const hasFeatured = visible.some(({ featured }) => featured)
          const allPublished = visible.every((card) => card.published)
          return <main>
            <h1>{selected.title}</h1>
            {hasFeatured && <strong>Featured collection</strong>}
            {allPublished ? <p>Ready</p> : <p>Review</p>}
            <section>{visible.map((card) => <article><h2>{card.title}</h2></article>)}</section>
          </main>
        }
      `,
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-key-main', state: 'active', generation: 7, transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-predicates', hashSha256: 'f'.repeat(64), immutableRevision: '1', document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!.bytes)
    expect(html).toContain('<h1>Install</h1>')
    expect(html).toContain('<strong>Featured collection</strong>')
    expect(html).toContain('<p>Ready</p>')
    expect(html).toContain('<h2>Install</h2>')
    expect(html).toContain('<h2>Publish</h2>')
    expect(html).not.toContain('Draft')
    expect(html).not.toContain('Later')
  })

  test('projects bounded object enumeration, flat tuples, and scalar array lookups without global or callback execution', async () => {
    const fileMap = files({
      'app/page.tsx': `
        const groups = {
          featured: [{ slug: 'install', title: 'Install' }, { slug: 'publish', title: 'Publish' }],
          archive: [{ slug: 'history', title: 'History' }],
        } as const
        export default function Page() {
          const groupNames = Object.keys(groups)
          const firstGroup = Object.values(groups).at(0)
          const selectedName = groupNames.find((name) => name === 'featured')
          const selectedIndex = groupNames.indexOf(selectedName)
          const finalIndex = groupNames.lastIndexOf('archive')
          const isKnown = groupNames.includes(selectedName)
          return <main>
            <h1>{selectedName}</h1>
            {isKnown && <p data-selected={selectedIndex}>Known group</p>}
            <p>Final index {finalIndex}</p>
            <section>{firstGroup.map((card) => <article><h2>{card.title}</h2></article>)}</section>
            {Object.entries(groups).map(([name, cards], index) => <section data-name={name} data-index={index}><h2>{name}</h2><p>{cards.length} records</p></section>)}
          </main>
        }
      `,
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-key-main', state: 'active', generation: 7, transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-enumeration', hashSha256: '1'.repeat(64), immutableRevision: '1', document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!.bytes)
    expect(html).toContain('<h1>featured</h1>')
    expect(html).toContain('<p data-selected="0">Known group</p>')
    expect(html).toContain('<p>Final index 1</p>')
    expect(html).toContain('<h2>Install</h2>')
    expect(html).toContain('<h2>Publish</h2>')
    expect(html).toContain('<section data-index="0" data-name="featured"><h2>featured</h2><p>2 records</p></section>')
    expect(html).toContain('<section data-index="1" data-name="archive"><h2>archive</h2><p>1 records</p></section>')
  })

  test('projects bounded string normalization, tokenization, predicates, slicing, and scalar joins without code execution', async () => {
    const fileMap = files({
      'app/page.tsx': `
        const sections = [
          { slug: ' section-news ', title: ' News ' },
          { slug: 'section-draft', title: ' Draft ' },
          { slug: 'pillar-analysis', title: ' Analysis ' },
        ] as const
        export default function Page() {
          const visible = sections.filter(({ slug }) => slug.trim().startsWith('section-') && !slug.trim().endsWith('-draft'))
          const heading = ['The', 'Lawyer'].join(' ')
          const query = ' LAW '.trim().toLowerCase()
          const hasQuery = 'the lawyer'.includes(query)
          const offset = 'section-news'.indexOf('news')
          const finalN = 'section-news'.lastIndexOf('n')
          const suffix = 'section-news'.slice(offset)
          const initial = suffix.at(0).toUpperCase()
          return <main>
            <h1>{heading}</h1>
            {hasQuery && <p data-offset={offset} data-final={finalN}>{initial}{suffix.slice(1)}</p>}
            <section>{visible.map(({ slug, title }) => <article data-slug={slug.trim().slice(8)}><h2>{title.trim().toUpperCase()}</h2></article>)}</section>
            <div>{'Kenya Law'.split(' ').map((word, index) => <span data-index={index}>{word.toLowerCase()}</span>)}</div>
          </main>
        }
      `,
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(false)

    const projection = projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })
    const renderer = new CoreSemanticReleaseRenderer()
    const artifacts = []
    for await (const artifact of renderer.render({
      scope: {
        platformId: 'platform-main', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-key-main', state: 'active', generation: 7, transferFence: null,
      },
      profileId: 'website',
    }, {
      id: 'snapshot-strings', hashSha256: '2'.repeat(64), immutableRevision: '1', document: projection.document,
    })) artifacts.push(artifact)
    const html = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === '/index.html')!.bytes)
    expect(html).toContain('<h1>The Lawyer</h1>')
    expect(html).toContain('<p data-final="8" data-offset="8">News</p>')
    expect(html).toContain('<article data-slug="news"><h2>NEWS</h2></article>')
    expect(html).not.toContain('DRAFT')
    expect(html).not.toContain('ANALYSIS')
    expect(html).toContain('<span data-index="0">kenya</span><span data-index="1">law</span>')
  })

  test('rejects executable, statement-bodied, non-boolean, mutating, and unbounded collection/string selection', async () => {
    const cases = [
      {
        source: `const cards=[{show:true}]; const predicate=(card:{show:boolean})=>card.show; export default function Page(){ return <main>{cards.filter(predicate).map(card => <p>Card</p>)}</main> }`,
        message: 'Static collection predicates must be inline functions.',
      },
      {
        source: `const cards=[{show:true}]; export default function Page(){ return <main>{cards.filter(card => { const allowed = card.show; return allowed }).map(card => <p>Card</p>)}</main> }`,
        message: 'Static collection predicates must contain one unconditional return.',
      },
      {
        source: `const cards=[{title:'Card'}]; export default function Page(){ return <main>{cards.filter(card => card.title).map(card => <p>{card.title}</p>)}</main> }`,
        message: 'Static collection predicates must resolve to booleans.',
      },
      {
        source: `const cards=[{title:'Card'}]; export default function Page(){ return <main>{cards.sort().map(card => <p>{card.title}</p>)}</main> }`,
        message: 'bounded static literals',
      },
      {
        source: `const Object={keys:'spoofed'}; const groups={safe:['Card']}; export default function Page(){ return <main>{Object.keys(groups).map(name => <p>{name}</p>)}</main> }`,
        message: 'bounded static literals',
      },
      {
        source: `const groups={safe:['Card']}; export default function Page(){ return <main>{Object.keys(groups, groups).map(name => <p>{name}</p>)}</main> }`,
        message: 'Static Object.keys accepts exactly one bounded object.',
      },
      {
        source: `const cards=[{title:'Card'}]; export default function Page(){ return <main>{cards.includes({title:'Card'}) ? 'yes' : 'no'}</main> }`,
        message: 'Static includes accepts only a scalar needle.',
      },
      {
        source: `const groups={safe:['Card']}; export default function Page(){ return <main>{Object.entries(groups).map(([name, ...cards]) => <p>{name}</p>)}</main> }`,
        message: 'Static collection callback tuple destructuring must be flat, contiguous, and explicit.',
      },
      {
        source: `export default function Page(){ return <main>{'news'.includes(1) ? 'yes' : 'no'}</main> }`,
        message: 'Static string includes search value must be a string literal.',
      },
      {
        source: `export default function Page(){ return <main>{'news'.trim('n')}</main> }`,
        message: 'Static trim requires one bounded string and no arguments.',
      },
      {
        source: `export default function Page(){ return <main>{'news-items'.split(/-/).map(item => <p>{item}</p>)}</main> }`,
        message: 'Static split separator must be a string literal, never a regular expression.',
      },
      {
        source: `const values=[{name:'unsafe'}]; export default function Page(){ return <main>{values.join(',')}</main> }`,
        message: 'Static join accepts only scalar array values.',
      },
      {
        source: `const value='${'x,'.repeat(500)}x'; export default function Page(){ return <main>{value.split(',').map(item => <p>{item}</p>)}</main> }`,
        message: 'Static split exceeds the bounded projection item limit.',
      },
    ]
    for (const item of cases) {
      const fileMap = files({ 'app/page.tsx': item.source })
      const revision = await revisionFor(fileMap)
      expect(() => projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })).toThrow(item.message)
    }
  })
  test('rejects dynamic expressions, event handlers, prop-driven components, media without asset binding, and unsafe CSS', async () => {
    const cases = [

      { source: 'export default function Page({name}: {name: string}) { return <main>{name}</main> }', message: 'static literals' },
      { source: 'export default function Page() { return <button onClick={() => 1}>Click</button> }', message: 'Event handler' },
      { source: 'const Card=({label}: {label: string})=> <div>{label}</div>; export default function Page() { return <Card label={getLabel()}/> }', message: 'bounded static literals' },
      { source: 'export default function Page() { return <img src="/photo.png"/> }', message: 'hash-bound imported public asset' },
    ]
    for (const item of cases) {
      const fileMap = files({ 'app/page.tsx': item.source })
      const revision = await revisionFor(fileMap)
      expect(() => projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })).toThrow(item.message)
    }
    const cycleFiles = files({
      'app/page.tsx': 'const A=()=> <B/>; const B=()=> <A/>; export default function Page(){ return <A/> }',
    })
    const cycleRevision = await revisionFor(cycleFiles)
    expect(() => projectNextSourceRevision({ revision: cycleRevision, files: cycleFiles, profileId: 'website' })).toThrow('Component cycle detected')
    const unsafeCssFiles = files({
      'app/page.tsx': 'export default function Page() { return <main>Safe structure</main> }',
      'app/global.css': '@import url("https://example.invalid/tracker.css");',
    })
    const unsafeCssRevision = await revisionFor(unsafeCssFiles)
    expect(() => projectNextSourceRevision({ revision: unsafeCssRevision, files: unsafeCssFiles, profileId: 'website' })).toThrow('CSS contains imports')
  })

  test('refuses analyzer-blocked revisions before parsing JSX', async () => {
    const fileMap = files({
      'app/page.tsx': `import Stripe from 'stripe'; export default function Page() { return <main>Denied</main> }`,
      'package.json': JSON.stringify({ dependencies: { stripe: '19.0.0' } }),
    })
    const revision = await revisionFor(fileMap)
    expect(revision.analysis.blocking).toBe(true)
    expect(() => projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })).toThrow(NextSourceProjectionError)
    expect(() => projectNextSourceRevision({ revision, files: fileMap, profileId: 'website' })).toThrow('Blocking source diagnostics')
  })
})
