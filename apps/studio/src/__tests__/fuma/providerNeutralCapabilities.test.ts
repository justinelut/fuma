import { describe, expect, test } from 'bun:test'
import {
  PROVIDER_NEUTRAL_CAPABILITY_IDS,
  PROVIDER_NEUTRAL_COVERAGE_MATRIX,
  SavePublicationDraftInputSchema,
  assertStrictCapabilitySchema,
  createProviderNeutralPublicationCapabilities,
  providerNeutralBlockingDiagnostic,
} from '../../../server/fuma/aiBackendCapabilities'
import {
  PROVIDER_NEUTRAL_CONTENT,
  PROVIDER_NEUTRAL_NOW,
  createProviderNeutralFixture,
  providerNeutralAuthority,
} from './providerNeutralCapabilityFixture'

const LIST_INPUT = Object.freeze({ kind: 'all' as const, status: 'all' as const, query: '', afterId: null, limit: 25 })
const DRAFT_INPUT = Object.freeze({
  contentId: 'post-088', kind: 'post' as const, title: 'Updated provider-neutral publishing',
  slug: 'provider-neutral-publishing', excerpt: 'Updated safely.',
  body: { format: 'markdown' as const, value: '# Updated' },
  canonicalUrl: 'https://site.example.test/provider-neutral-publishing',
  redirects: [{ fromPath: '/provider-neutral-old', toPath: '/provider-neutral-publishing', statusCode: 308 as const }],
  openGraph: { title: 'Provider-neutral Open Graph', description: 'Reviewed metadata.', imageId: null, type: 'article' as const },
  social: { title: 'Provider-neutral social', description: 'Reviewed card metadata.', imageId: null, card: 'summary-large-image' as const },
  seoTitle: 'Updated provider-neutral publishing', seoDescription: 'No direct database authority.',
  featureImageId: null, tagIds: ['tag-088'], primaryTagId: 'tag-088', authorIds: ['author-088'],
  visibility: { kind: 'public' as const }, expectedVersion: 1,
})

async function invoke(
  fixture: ReturnType<typeof createProviderNeutralFixture>,
  id: string,
  channel: 'site-ai' | 'mcp',
  input: unknown,
  confirmed = false,
) {
  const definition = fixture.registry.definition(id, '1.0.0')!
  return fixture.registry.invoke({
    id,
    version: '1.0.0',
    rawInput: input,
    resolveAuthority: async () => providerNeutralAuthority(channel, definition.metadata, confirmed),
    evidence: fixture.evidence,
  })
}

describe('FUMA-088 provider-neutral capability contract', () => {
  test('registers nine strict TypeBox definitions with exact export adapter versions', () => {
    const fixture = createProviderNeutralFixture()
    const definitions = createProviderNeutralPublicationCapabilities(fixture.adapter)
    expect(definitions).toHaveLength(9)
    for (const definition of definitions) {
      expect(definition.metadata.version).toBe('1.0.0')
      expect(definition.metadata.channels).toEqual(['site-ai', 'mcp', 'imported-runtime', 'export-adapter'])
      expect(definition.metadata.exportAdapter).toEqual({ id: `${definition.metadata.id}.adapter`, version: '1.0.0' })
      expect(() => assertStrictCapabilitySchema(definition.inputSchema, `${definition.metadata.id}.input`)).not.toThrow()
      expect(() => assertStrictCapabilitySchema(definition.outputSchema, `${definition.metadata.id}.output`)).not.toThrow()
    }
    expect(() => assertStrictCapabilitySchema(SavePublicationDraftInputSchema, 'draft')).not.toThrow()
  })

  test('gives Site AI and MCP invocation parity through the same reviewed definition and sanitized output', async () => {
    const fixture = createProviderNeutralFixture()
    const siteAi = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, 'site-ai', LIST_INPUT)
    const mcp = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, 'mcp', LIST_INPUT)
    expect(siteAi.output).toEqual(mcp.output)
    expect(siteAi.receipt).toMatchObject({ capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, channel: 'site-ai', metered: true, audited: true })
    expect(mcp.receipt).toMatchObject({ capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, channel: 'mcp', metered: true, audited: true })
    const wire = JSON.stringify([siteAi, mcp])
    expect(wire).not.toContain('private@example.test')
    expect(wire).not.toContain('organization-088')
    expect(wire).not.toContain('owner-088')
    expect(wire).not.toContain('session-site-ai')
    expect(fixture.calls).toEqual(['store.listContent', 'store.listContent'])
    expect(fixture.evidenceEvents).toHaveLength(4)
  })

  test('maps bounded draft/SEO writes to canonical editorial authority and requires owner confirmation to publish', async () => {
    const fixture = createProviderNeutralFixture()
    const saved = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.saveDraft, 'site-ai', DRAFT_INPUT)
    expect(saved.output).toMatchObject({ item: {
      title: DRAFT_INPUT.title,
      workflowVersion: 2,
      seoDescription: DRAFT_INPUT.seoDescription,
      redirects: DRAFT_INPUT.redirects,
      openGraph: DRAFT_INPUT.openGraph,
      social: DRAFT_INPUT.social,
      primaryTagId: DRAFT_INPUT.primaryTagId,
    } })
    expect(fixture.calls).toEqual(['store.getContent', 'editorial.save'])

    const request = { contentId: 'post-088', from: 'draft', to: 'published', expectedVersion: 2, scheduledAt: null, note: 'Owner reviewed.' }
    await expect(invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.requestPublication, 'site-ai', request))
      .rejects.toMatchObject({ code: 'confirmation' })
    expect(fixture.calls).not.toContain('editorial.transition')
    const published = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.requestPublication, 'site-ai', request, true)
    expect(published.output).toMatchObject({ item: { status: 'published', workflowVersion: 3 } })
    expect(fixture.calls.at(-1)).toBe('editorial.transition')
  })

  test('delegates every active read/access adapter with minimized output and server-derived member identity', async () => {
    const fixture = createProviderNeutralFixture()
    const content = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.getContent, 'site-ai', { contentId: 'post-088' })
    expect(content.output).toMatchObject({ item: {
      contentId: 'post-088',
      primaryTagId: 'tag-088',
      openGraph: { type: 'article' },
      social: { card: 'summary-large-image' },
    } })

    const taxonomy = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.listTaxonomy, 'site-ai', {})
    expect(taxonomy.output).toEqual({
      authors: [{ authorId: 'author-088', displayName: 'Fixture Author', image: null }],
      tags: [{ tagId: 'tag-088', name: 'Reviewed', slug: 'reviewed', description: '' }],
    })
    const settings = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.getSettings, 'site-ai', {})
    expect(settings.output).toMatchObject({ settings: { publicationId: 'publication-088', timezone: 'Africa/Nairobi' } })
    const newsletters = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.listNewsletters, 'site-ai', { limit: 10 })
    expect(newsletters.output).toMatchObject({ items: [{ newsletterId: 'newsletter-088', status: 'active' }] })
    const access = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.evaluateAccess, 'site-ai', {
      contentId: 'post-088', mode: 'public', origin: 'https://site.example.test', requestedPath: '/provider-neutral-publishing',
    })
    expect(access.output).toEqual({ member: false, paid: false, accessState: 'anonymous', delivery: 'render', statusCode: 200, reason: 'published' })
    expect(fixture.inputs).toEqual([{
      memberIdentityId: null,
      contentId: 'post-088',
      mode: 'public',
      origin: 'https://site.example.test',
      requestedPath: '/provider-neutral-publishing',
      evaluatedAt: PROVIDER_NEUTRAL_NOW,
    }])
    const analytics = await invoke(fixture, PROVIDER_NEUTRAL_CAPABILITY_IDS.analyticsReport, 'site-ai', { from: '2026-07-01', to: '2026-07-31' })
    expect(analytics.output).toEqual({ siteReads: 4, postReads: 3, publicReads: 6, memberReads: 1, newsletterOpens: 2, newsletterClicks: 1, subscriptions: 1, unsubscriptions: 0 })
    expect(fixture.calls).toEqual([
      'store.getContent', 'store.listAuthors', 'store.listTags', 'identity.get',
      'store.listNewsletters', 'memberAccess.evaluate', 'privacyAnalytics.report',
    ])
    expect(JSON.stringify([content, taxonomy, settings, newsletters, access, analytics])).not.toContain('private@example.test')
  })

  test('denies SQL, scope, credential, arbitrary predicate, and caller member identity before authority contact', async () => {
    const fixture = createProviderNeutralFixture()
    let authorityCalls = 0
    const definition = fixture.registry.definition(PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, '1.0.0')!
    for (const hostile of [
      { ...LIST_INPUT, sql: 'select * from data_rows' },
      { ...LIST_INPUT, table: 'fuma_publication_members' },
      { ...LIST_INPUT, organizationId: 'other' },
      { ...LIST_INPUT, databaseUrl: 'postgres://credential' },
      { ...LIST_INPUT, where: { arbitrary: true } },
      { ...LIST_INPUT, memberIdentityId: 'victim' },
    ]) {
      await expect(fixture.registry.invoke({
        id: definition.metadata.id,
        version: definition.metadata.version,
        rawInput: hostile,
        resolveAuthority: async () => { authorityCalls += 1; return providerNeutralAuthority('site-ai', definition.metadata) },
        evidence: fixture.evidence,
      })).rejects.toMatchObject({ code: 'invalid-contract' })
    }
    expect(authorityCalls).toBe(0)
    expect(fixture.calls).toHaveLength(0)
  })

  test('covers every requested family and returns deterministic blocking diagnostics instead of shadow backends', () => {
    expect(PROVIDER_NEUTRAL_COVERAGE_MATRIX).toHaveLength(21)
    const active = PROVIDER_NEUTRAL_COVERAGE_MATRIX.filter((row) => row.state === 'active')
    expect(active).toHaveLength(9)
    expect(new Set(active.map((row) => row.capabilityId))).toEqual(new Set(Object.values(PROVIDER_NEUTRAL_CAPABILITY_IDS)))
    for (const family of ['content', 'media', 'member', 'newsletter', 'subscription', 'podcast', 'forms', 'lead', 'navigation', 'search', 'agency', 'landing', 'conversion', 'ecommerce']) {
      expect(PROVIDER_NEUTRAL_COVERAGE_MATRIX.some((row) => row.function.includes(family))).toBe(true)
    }
    expect(providerNeutralBlockingDiagnostic('podcast/audio feed')).toStartWith('CAPABILITY_AUTHORITY_MISSING')
    expect(providerNeutralBlockingDiagnostic('forms submission')).toStartWith('CAPABILITY_BROWSER_CHALLENGE_REQUIRED')
    expect(providerNeutralBlockingDiagnostic('ecommerce/catalog/cart/order/inventory/checkout')).toStartWith('CAPABILITY_DEFERRED_ECOMMERCE')
    expect(providerNeutralBlockingDiagnostic('publishing/blogging/content list')).toBeNull()
    expect(providerNeutralBlockingDiagnostic('publishing/blogging/content read')).toBeNull()
    expect(PROVIDER_NEUTRAL_CONTENT.document).toEqual({ format: 'markdown', value: '# Provider neutral' })
  })
})
