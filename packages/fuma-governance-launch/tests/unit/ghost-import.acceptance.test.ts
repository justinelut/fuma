import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  compareStructuredGhostSourceParity,
  executeStructuredGhostImport,
  ghostAdminApiSnapshotToExport,
  parseGhostMemberCsv,
  planStructuredGhostImport,
  rollbackStructuredGhostImport,
  type GhostImportExecutionPort,
  type GhostImportReceiptV2,
  type GhostMappedObject,
  type GhostMediaObject,
  type StructuredGhostImportPlan,
} from '../../src'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

const source = {
  meta: { version: '5.82.0' },
  data: {
    posts: [
      {
        id: 'post-a', type: 'post', title: 'Daily brief', slug: 'daily-brief', html: '<p><img src="https://cdn.example/a.jpg">News</p>', lexical: '{"root":{}}', status: 'published', visibility: 'paid', featured: 1,
        published_at: '2026-07-20T08:00:00Z', created_at: '2026-07-19T08:00:00Z', updated_at: '2026-07-20T09:00:00Z',
        meta_title: 'Daily SEO', meta_description: 'SEO summary', og_title: 'Daily social', og_description: 'Social summary', og_image: 'https://cdn.example/b.jpg',
        twitter_title: 'Daily X', twitter_description: 'X summary', twitter_image: 'https://cdn.example/b.jpg', canonical_url: 'https://publication.example/daily-brief', feature_image: 'https://cdn.example/a.jpg',
      },
      { id: 'page-a', type: 'page', title: 'About', slug: 'about', html: '<p>About</p>', status: 'draft', visibility: 'public', created_at: '2026-07-18T08:00:00Z', updated_at: '2026-07-18T09:00:00Z' },
    ],
    users: [{ id: 'author-a', name: 'Author A', slug: 'author-a', email: 'author@example.test', bio: 'Reporter' }],
    tags: [{ id: 'tag-a', name: 'Analysis', slug: 'analysis', visibility: 'public', meta_title: 'Analysis SEO' }],
    posts_authors: [{ post_id: 'post-a', author_id: 'author-a' }, { post_id: 'page-a', author_id: 'author-a' }],
    posts_tags: [{ post_id: 'post-a', tag_id: 'tag-a' }],
    settings: [{ key: 'title', value: 'Fixture Publication' }, { key: 'description', value: 'Fixture summary' }],
    newsletters: [{ id: 'newsletter-a', name: 'Daily', description: 'Daily newsletter', status: 'active', sender_name: 'Fixture', sender_email: 'news@example.test', subscribe_on_signup: true }],
  },
}

const adminApiSnapshot = {
  meta: source.meta,
  posts: [{ ...source.data.posts[0], authors: [source.data.users[0]], tags: [source.data.tags[0]] }],
  pages: [{ ...source.data.posts[1], authors: [source.data.users[0]], tags: [] }],
  authors: source.data.users,
  tags: source.data.tags,
  settings: source.data.settings,
  newsletters: source.data.newsletters,
}

const memberCsv = 'email,name,note,labels,subscribed_to_emails,created_at\nmember@example.test,"Member, A",Imported,"paid,founder",true,2026-07-01T08:00:00Z\n'

class MemoryImportPort implements GhostImportExecutionPort {
  readonly objects = new Map<string, GhostMappedObject>()
  readonly media = new Map<string, Uint8Array>()
  readonly receipts = new Map<string, GhostImportReceiptV2>()
  readonly cursors: string[] = []
  readonly applyObjectCalls = new Map<string, number>()
  readonly applyMediaCalls = new Map<string, number>()
  failMediaUrlOnce: string | null = null
  private failed = false

  async findReceipt(hash: string): Promise<GhostImportReceiptV2 | null> { return this.receipts.get(hash) ?? null }
  async begin(_plan: StructuredGhostImportPlan): Promise<void> {}
  async objectState(importId: string, kind: GhostMappedObject['kind'], sourceId: string): Promise<'pending' | 'applied'> { return this.objects.has(`${importId}:${kind}:${sourceId}`) ? 'applied' : 'pending' }

  async applyObject(importId: string, object: GhostMappedObject): Promise<void> {
    const key = `${importId}:${object.kind}:${object.sourceId}`
    this.applyObjectCalls.set(key, (this.applyObjectCalls.get(key) ?? 0) + 1)
    this.objects.set(key, object)
  }
  async mediaState(importId: string, destinationKey: string): Promise<'pending' | 'applied'> { return this.media.has(`${importId}:${destinationKey}`) ? 'applied' : 'pending' }
  async fetchMedia(sourceUrl: string): Promise<Uint8Array> {
    if (sourceUrl === this.failMediaUrlOnce && !this.failed) { this.failed = true; throw new Error('transient media failure') }
    return new TextEncoder().encode(sourceUrl)
  }
  async applyMedia(importId: string, media: GhostMediaObject, bytes: Uint8Array): Promise<void> {
    const key = `${importId}:${media.destinationKey}`
    this.applyMediaCalls.set(key, (this.applyMediaCalls.get(key) ?? 0) + 1)
    this.media.set(key, bytes)
  }
  async saveCursor(_importId: string, cursor: string): Promise<void> { this.cursors.push(cursor) }
  async complete(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2> { this.receipts.set(receipt.manifestHashSha256, receipt); return receipt }
  async rollbackObject(importId: string, object: GhostMappedObject): Promise<void> { this.objects.delete(`${importId}:${object.kind}:${object.sourceId}`) }
  async rollbackMedia(importId: string, media: GhostMediaObject): Promise<void> { this.media.delete(`${importId}:${media.destinationKey}`) }
  async completeRollback(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2> { this.receipts.set(receipt.manifestHashSha256, receipt); return receipt }
}

describe('FUMA-075 reusable structured Ghost import', () => {
  it('maps complete Ghost publication state with deterministic provenance and reauthentication', async () => {
    const plan = await planStructuredGhostImport(source, { importId: 'ghost-fixture', dryRun: true, digest, memberCsv })
    expect(plan.manifest.counts).toEqual({ posts: 1, pages: 1, authors: 1, tags: 1, settings: 2, members: 1, newsletters: 1, relations: 3, media: 2 })
    expect(plan.manifest.excludedKinds).toEqual(['passwords', 'sessions', 'provider-secrets'])
    expect(plan.manifest.sourceHashSha256).toHaveLength(64)
    expect(plan.manifest.relationHashSha256).toHaveLength(64)
    expect(plan.manifest.mediaHashSha256).toHaveLength(64)
    const post = plan.objects.find(({ kind }) => kind === 'post')
    expect(post?.value).toMatchObject({ status: 'published', visibility: 'paid', canonicalUrl: 'https://publication.example/daily-brief', seo: { title: 'Daily SEO' }, social: { ogTitle: 'Daily social', twitterTitle: 'Daily X' }, authorIds: ['author-a'], tagIds: ['tag-a'] })
    expect(plan.objects.filter(({ requiresReauthentication }) => requiresReauthentication).map(({ kind }) => kind).sort()).toEqual(['author', 'member'])
    expect((await compareStructuredGhostSourceParity(source, ghostAdminApiSnapshotToExport(adminApiSnapshot), { digest, memberCsv })).countsMatch).toBe(true)
    const secondPlan = await planStructuredGhostImport(structuredClone(source), { importId: 'ghost-fixture', dryRun: true, digest, memberCsv })
    expect(secondPlan).toEqual(plan)
  })

  it('rejects malformed CSV, relations, timestamps, and credential/session material', async () => {
    expect(() => parseGhostMemberCsv('name\nNo email\n')).toThrow('requires unique headers including email')
    expect(() => parseGhostMemberCsv('email,name\na@example.test,"unterminated\n')).toThrow('unterminated quoted field')
    expect(() => parseGhostMemberCsv('email\na@example.test\na@example.test\n')).toThrow('invalid or duplicate email')
    await expect(planStructuredGhostImport({ ...source, data: { ...source.data, posts_authors: [{ post_id: 'missing', author_id: 'author-a' }] } }, { importId: 'bad-relation', dryRun: true, digest })).rejects.toThrow('relation is invalid')
    await expect(planStructuredGhostImport({ ...source, data: { ...source.data, posts: source.data.posts.map((post, index) => index === 0 ? { ...post, published_at: 'yesterday' } : post) } }, { importId: 'bad-date', dryRun: true, digest })).rejects.toThrow('ISO UTC timestamp')
    const secretSettingPlan = await planStructuredGhostImport({ ...source, data: { ...source.data, settings: [{ key: 'mailgun_password', value: 'must-not-map' }] } }, { importId: 'excluded-provider-secret', dryRun: true, digest })
    expect(secretSettingPlan.objects.some(({ kind }) => kind === 'setting')).toBe(false)
    expect(secretSettingPlan.manifest.counts.settings).toBe(0)
    await expect(planStructuredGhostImport({ ...source, data: { ...source.data, settings: [{ key: 'mail', api_key: 'forbidden' }] } }, { importId: 'secret', dryRun: true, digest })).rejects.toThrow('Forbidden source field')
    await expect(planStructuredGhostImport({ ...source, data: { ...source.data, users: [{ id: 'author-a', sessions: ['forbidden'] }] } }, { importId: 'session', dryRun: true, digest })).rejects.toThrow('Forbidden source field')
  })

  it('resumes media retries, deduplicates the second import, and rolls back idempotently', async () => {
    const plan = await planStructuredGhostImport(source, { importId: 'ghost-demo', dryRun: false, digest, memberCsv })
    const samePlan = await planStructuredGhostImport(structuredClone(source), { importId: 'ghost-demo', dryRun: false, digest, memberCsv })
    expect(samePlan.manifestHashSha256).toBe(plan.manifestHashSha256)
    const port = new MemoryImportPort()
    port.failMediaUrlOnce = 'https://cdn.example/b.jpg'
    await expect(executeStructuredGhostImport(plan, port)).rejects.toThrow('transient media failure')
    expect(port.objects.size).toBe(plan.objects.length)
    expect(port.media.size).toBe(1)
    const receipt = await executeStructuredGhostImport(plan, port)
    expect(receipt.state).toBe('applied')
    expect(port.media.size).toBe(2)
    expect([...port.applyObjectCalls.values()]).toEqual(Array(plan.objects.length).fill(1))
    expect([...port.applyMediaCalls.values()]).toEqual([1, 1])
    expect(await executeStructuredGhostImport(samePlan, port)).toBe(receipt)
    const rolledBack = await rollbackStructuredGhostImport(plan, receipt, port)
    expect(rolledBack.state).toBe('rolled-back')
    expect(port.objects.size).toBe(0)
    expect(port.media.size).toBe(0)
    expect(await rollbackStructuredGhostImport(plan, rolledBack, port)).toBe(rolledBack)
    console.log('FUMA-075 demo', JSON.stringify({ sourceHashSha256: plan.manifest.sourceHashSha256, firstManifestHashSha256: plan.manifestHashSha256, secondManifestHashSha256: samePlan.manifestHashSha256, objectCount: plan.objects.length, mediaCount: plan.media.length, resumedAfterMediaFailure: true, duplicateSubmissionReusedReceipt: true, finalState: rolledBack.state }))
  })
})
