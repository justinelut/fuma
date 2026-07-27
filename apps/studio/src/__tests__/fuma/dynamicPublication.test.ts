import { describe, expect, test } from 'bun:test'
import {
  DynamicPublicationLoopQuerySchema,
  DynamicPublicationTemplateSchema,
  parseDynamicPublicationContract,
  type DynamicPublicationLoopItem,
  type DynamicPublicationLoopQuery,
  type DynamicPublicationTarget,
  type DynamicPublicationTemplate,
} from '../../core/fuma/publication/dynamicPublication'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'
import type { DynamicPublicationRepository } from '../../../server/fuma/publication/dynamicPublicationRepository'
import { DynamicPublicationService } from '../../../server/fuma/publication/dynamicPublicationService'
import { DynamicPublicationPublicBoundary } from '../../../server/fuma/publication/dynamicPublicationRoutes'
import { publicationFixture, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const PUBLIC = { kind: 'public' } as const
const MEMBER = { kind: 'member' } as const
const PAID = { kind: 'paid' } as const
const SEGMENT = { kind: 'segment', segmentIds: ['segment-east'] } as const

type RecordWithAccess = Readonly<{
  scope: PublicationRepositoryScope
  item: DynamicPublicationLoopItem
  visibility: typeof PUBLIC | typeof MEMBER | typeof PAID | typeof SEGMENT
  collectionId?: string
}>

class MemoryDynamicPublicationRepository implements DynamicPublicationRepository {
  templates = new Map<string, DynamicPublicationTemplate>()
  records: RecordWithAccess[] = []
  queryCalls = 0
  resolveCalls = 0
  saveCalls = 0
  async saveTemplate(scope: PublicationRepositoryScope, template: DynamicPublicationTemplate, expectedVersion: number | null): Promise<boolean> {
    this.saveCalls++
    const key = `${scope.ownerKey}\0${scope.generation}\0${scope.profileId}\0${template.templateId}`
    const current = this.templates.get(key)
    if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) return false
    if ([...this.templates.entries()].some(([otherKey, value]) => otherKey !== key && sameScope(scope, otherKey) && value.active && template.active && value.target.kind === template.target.kind && value.target.targetId === template.target.targetId)) return false
    this.templates.set(key, structuredClone(template))
    return true
  }
  async listTemplates(scope: PublicationRepositoryScope): Promise<readonly DynamicPublicationTemplate[]> {
    return [...this.templates.entries()].filter(([key]) => sameScope(scope, key)).map(([, value]) => structuredClone(value))
  }
  async resolveTemplate(scope: PublicationRepositoryScope, target: DynamicPublicationTarget): Promise<DynamicPublicationTemplate | null> {
    this.resolveCalls++
    const values = await this.listTemplates(scope)
    return values.find((value) => value.active && value.target.kind === target.kind && value.target.targetId === target.targetId)
      ?? values.find((value) => value.active && value.target.kind === target.kind && value.target.targetId === null)
      ?? null
  }
  async queryLoop(scope: PublicationRepositoryScope, input: DynamicPublicationLoopQuery) {
    this.queryCalls++
    const query = parseDynamicPublicationContract('memory query', DynamicPublicationLoopQuerySchema, input)
    const eligible = this.records.filter((record) => exactScope(record.scope, scope) && matches(record, query) && allowed(record, query))
      .sort((left, right) => right.item.publishedAt.localeCompare(left.item.publishedAt) || left.item.contentId.localeCompare(right.item.contentId))
    const offset = (query.page - 1) * query.pageSize
    return Object.freeze({ items: eligible.slice(offset, offset + query.pageSize).map((record) => record.item), total: eligible.length })
  }
}

function sameScope(scope: PublicationRepositoryScope, key: string): boolean { return key.startsWith(`${scope.ownerKey}\0${scope.generation}\0${scope.profileId}\0`) }
function exactScope(left: PublicationRepositoryScope, right: PublicationRepositoryScope): boolean { return ['platformId','organizationId','workspaceId','siteId','ownerKey','generation','profileId'].every((key) => left[key as keyof PublicationRepositoryScope] === right[key as keyof PublicationRepositoryScope]) }
function matches(record: RecordWithAccess, query: DynamicPublicationLoopQuery): boolean {
  const id = query.target.targetId
  if (query.target.kind === 'post' || query.target.kind === 'page') return record.item.kind === query.target.kind && record.item.slug === id
  if (query.target.kind === 'author') return record.item.authorIds.includes(id ?? '')
  if (query.target.kind === 'tag') return record.item.tagIds.includes(id ?? '')
  if (query.target.kind === 'date') return record.item.publishedAt.startsWith(id ?? '')
  return record.collectionId === id || id === `${record.item.kind}s`
}
function allowed(record: RecordWithAccess, query: DynamicPublicationLoopQuery): boolean {
  if (record.visibility.kind === 'public') return true
  if (record.visibility.kind === 'member') return query.audience.member
  if (record.visibility.kind === 'paid') return query.audience.paid
  return record.visibility.segmentIds.some((id) => query.audience.segmentIds.includes(id))
}
function item(contentId: string, title: string, slug: string, authorIds: string[], tagIds: string[], publishedAt = TEST_NOW): DynamicPublicationLoopItem {
  return { contentId, kind: 'post', title, slug, excerpt: `${title} excerpt`, publishedAt, authorIds, tagIds }
}
function template(templateId: string, target: DynamicPublicationTarget, version = 1, marker = 'Shared article'): DynamicPublicationTemplate {
  return parseDynamicPublicationContract('fixture template', DynamicPublicationTemplateSchema, {
    templateId, name: `${target.kind} template`, target, emptyState: 'Nothing published here yet.', version, active: true,
    createdAt: TEST_NOW, updatedAt: version === 1 ? TEST_NOW : '2040-01-02T00:00:00.000Z',
    document: { version: 1, blocks: [
      { blockId: 'heading', scope: 'root', element: 'h1', value: { kind: 'binding', binding: target.kind === 'post' ? 'content.title' : 'archive.title' }, href: null },
      { blockId: 'marker', scope: 'root', element: 'p', value: { kind: 'literal', value: marker }, href: null },
      ...(target.kind === 'post' || target.kind === 'page' ? [] : [{ blockId: 'item', scope: 'item', element: 'a', value: { kind: 'binding', binding: 'item.title' }, href: { kind: 'binding', binding: 'item.url' } }]),
    ] },
  })
}
function query(target: DynamicPublicationTarget, audience = { member: false, paid: false, segmentIds: [] as string[] }, page = 1, pageSize = 20): DynamicPublicationLoopQuery {
  return { target, audience, page, pageSize, asOf: '2040-02-01T00:00:00.000Z' }
}

describe('FUMA-037 Dynamic Publication templates and archives', () => {
  test('supports reusable templates for every required route kind with strict stable IDs', async () => {
    const h = publicationFixture(), repository = new MemoryDynamicPublicationRepository(), service = new DynamicPublicationService(repository)
    for (const kind of ['post','page','author','tag','date','collection'] as const) await service.saveTemplate(h.scope, template(`template-${kind}`, { kind, targetId: null }), null)
    expect((await service.listTemplates(h.scope)).map((value) => value.target.kind).sort()).toEqual(['author','collection','date','page','post','tag'])
    expect(() => parseDynamicPublicationContract('hostile template', DynamicPublicationTemplateSchema, { ...template('safe', { kind: 'post', targetId: null }), callerOwnerKey: 'other' })).toThrow()
  })

  test('keeps loop work constant, excludes private and foreign-site rows, and admits only authorized audiences', async () => {
    const h = publicationFixture(), repository = new MemoryDynamicPublicationRepository(), service = new DynamicPublicationService(repository)
    const foreign = { ...h.scope, siteId: 'foreign-site', ownerKey: 'foreign-owner' }
    await service.saveTemplate(h.scope, template('author-template', { kind: 'author', targetId: null }), null)
    repository.records.push(
      { scope: h.scope, item: item('public', 'Public', 'public', ['author-1'], ['tag-1']), visibility: PUBLIC },
      { scope: h.scope, item: item('member', 'Member', 'member', ['author-1'], ['tag-1']), visibility: MEMBER },
      { scope: h.scope, item: item('paid', 'Paid', 'paid', ['author-1'], ['tag-1']), visibility: PAID },
      { scope: h.scope, item: item('segment', 'Segment', 'segment', ['author-1'], ['tag-1']), visibility: SEGMENT },
      { scope: foreign, item: item('foreign', 'Foreign', 'foreign', ['author-1'], ['tag-1']), visibility: PUBLIC },
    )
    const anonymous = await service.render(h.scope, query({ kind: 'author', targetId: 'author-1' }))
    const authorized = await service.render(h.scope, query({ kind: 'author', targetId: 'author-1' }, { member: true, paid: true, segmentIds: ['segment-east'] }))
    expect(anonymous.page.items.map((value) => value.contentId)).toEqual(['public'])
    expect(authorized.page.items.map((value) => value.contentId).sort()).toEqual(['member','paid','public','segment'])
    expect(authorized.html).not.toContain('Foreign')
    expect(repository.queryCalls).toBe(2)
    expect(repository.resolveCalls).toBe(2)
  })

  test('preserves canonical pagination and renders explicit empty states', async () => {
    const h = publicationFixture(), repository = new MemoryDynamicPublicationRepository(), service = new DynamicPublicationService(repository)
    await service.saveTemplate(h.scope, template('tag-template', { kind: 'tag', targetId: null }), null)
    await service.saveTemplate(h.scope, template('collection-template', { kind: 'collection', targetId: null }), null)
    repository.records.push(
      { scope: h.scope, item: item('newer', 'Newer', 'newer', ['author'], ['tag-1'], '2040-01-02T00:00:00.000Z'), visibility: PUBLIC },
      { scope: h.scope, item: item('older', 'Older', 'older', ['author'], ['tag-1'], '2040-01-01T00:00:00.000Z'), visibility: PUBLIC },
    )
    const first = await service.render(h.scope, query({ kind: 'tag', targetId: 'tag-1' }, undefined, 1, 1))
    const second = await service.render(h.scope, query({ kind: 'tag', targetId: 'tag-1' }, undefined, 2, 1))
    const empty = await service.render(h.scope, query({ kind: 'collection', targetId: 'empty' }))
    expect(first.page).toMatchObject({ canonicalPath: '/tags/tag-1', previousPath: null, nextPath: '/tags/tag-1?page=2' })
    expect(second.page).toMatchObject({ canonicalPath: '/tags/tag-1?page=2', previousPath: '/tags/tag-1', nextPath: null })
    expect(empty.html).toContain('data-publication-empty="true"')
    expect(empty.html).toContain('Nothing published here yet.')
  })

  test('demo: changing one shared article template updates articles and live author/tag archives', async () => {
    const h = publicationFixture(), repository = new MemoryDynamicPublicationRepository(), service = new DynamicPublicationService(repository)
    const articleV1 = await service.saveTemplate(h.scope, template('shared-article', { kind: 'post', targetId: null }, 1, 'Edition A'), null)
    await service.saveTemplate(h.scope, template('shared-author', { kind: 'author', targetId: null }), null)
    await service.saveTemplate(h.scope, template('shared-tag', { kind: 'tag', targetId: null }), null)
    repository.records.push(
      { scope: h.scope, item: item('article-1', 'Nairobi dispatch', 'nairobi-dispatch', ['author-ada'], ['tag-kenya']), visibility: PUBLIC },
      { scope: h.scope, item: item('article-2', 'Mombasa dispatch', 'mombasa-dispatch', ['author-ada'], ['tag-coast']), visibility: PUBLIC },
    )
    const before = await service.render(h.scope, query({ kind: 'post', targetId: 'nairobi-dispatch' }))
    await service.saveTemplate(h.scope, template('shared-article', { kind: 'post', targetId: null }, 2, 'Edition B'), articleV1.version)
    const after = await service.render(h.scope, query({ kind: 'post', targetId: 'mombasa-dispatch' }))
    const author = await service.render(h.scope, query({ kind: 'author', targetId: 'author-ada' }))
    const tag = await service.render(h.scope, query({ kind: 'tag', targetId: 'tag-kenya' }))
    const transcript = { before: before.html, after: after.html, authorTitles: author.page.items.map((value) => value.title), tagTitles: tag.page.items.map((value) => value.title) }
    process.stdout.write(`[FUMA-037 demo] ${JSON.stringify(transcript)}\n`)
    expect(before.html).toContain('Edition A')
    expect(after.html).toContain('Edition B')
    expect(author.page.items).toHaveLength(2)
    expect(tag.page.items.map((value) => value.title)).toEqual(['Nairobi dispatch'])
  })

  test('public boundary derives scope from Host and redirects page=1 to the canonical route', async () => {
    const h = publicationFixture(), repository = new MemoryDynamicPublicationRepository(), service = new DynamicPublicationService(repository)
    await service.saveTemplate(h.scope, template('tag-template', { kind: 'tag', targetId: null }), null)
    repository.records.push({ scope: h.scope, item: item('article', 'Article', 'article', ['author'], ['tag-1']), visibility: PUBLIC })
    const boundary = new DynamicPublicationPublicBoundary({ service, hosts: { scopeForHost: async (host) => host === 'publication.example' ? h.scope : null }, audience: { audienceForRequest: async () => ({ member: false, paid: false, segmentIds: [] }) }, now: () => new Date('2040-02-01T00:00:00.000Z') })
    const canonical = await boundary.handle(new Request('https://publication.example/tags/tag-1'))
    const redirect = await boundary.handle(new Request('https://publication.example/tags/tag-1?page=1&utm_source=x'))
    const foreign = await boundary.handle(new Request('https://foreign.example/tags/tag-1'))
    expect(canonical?.status).toBe(200)
    expect(canonical?.headers.get('link')).toContain('https://publication.example/tags/tag-1')
    expect(await canonical?.text()).toContain('Article')
    expect(redirect?.status).toBe(308)
    expect(redirect?.headers.get('location')).toBe('/tags/tag-1')
    expect(foreign?.status).toBe(404)
  })
})
