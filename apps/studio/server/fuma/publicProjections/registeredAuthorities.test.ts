import { describe, expect, test } from 'bun:test'
import {
  PUBLIC_PROJECTION_RESOURCES,
  PublicExpertsPageSchema,
  PublicPluginsPageSchema,
  PublicPricingCatalogPageSchema,
  PublicProductFactsEnvelopeSchema,
  PublicProductFactsPageSchema,
  PublicShowcasesPageSchema,
  PublicTemplatesPageSchema,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import type { DbClient, DbResult } from '../../db/client'
import { PublicProjectionInvalidRequestError, PublicProjectionUnavailableError } from './authority'
import { createPublicProjectionBoundary, type PublicProjectionCoordination } from './boundary'
import { createHostedPublicProjectionAuthorityCatalog } from './registeredAuthorities'

const TOKEN = 'projection-service-token-0000000001'
const HOST = 'studio-internal.service:3001'

const pricingItem = Object.freeze({
  id: 'plan_launch_monthly',
  slug: 'launch-monthly',
  name: 'Launch',
  summary: 'A publish-approved Website plan.',
  profile: 'website',
  currency: 'KES',
  cadence: 'monthly',
  amountMinor: 250000,
  featureKeys: ['pages'],
  quotas: [{ key: 'sites', label: 'Sites', limit: 1, unit: 'count' }],
  promotion: null,
  checkoutAvailable: true,
  effectiveAt: '2026-07-01T00:00:00.000Z',
  expiresAt: null,
})

const expertPublic = Object.freeze({
  id: 'expert_nairobi_designer',
  slug: 'nairobi-designer',
  summary: 'Approved public design and development work.',
  location: 'Nairobi',
  skills: ['design'],
  services: ['web-design'],
  showcaseIds: ['showcase_acacia'],
  mediatedInquiryAvailable: true,
  imageUrl: null,
  showcases: [{
    id: 'showcase_acacia',
    slug: 'acacia-publication',
    title: 'Acacia Publication',
    summary: 'An approved public release with dual attribution consent.',
    profiles: ['publication'],
    industries: ['publishing'],
    previewUrl: 'https://acacia.preview.fuma.co.ke/releases/release_public_1/',
    imageUrl: '/images/showcase-acacia.webp',
    expertIds: ['expert_nairobi_designer'],
    approvedAt: '2026-07-20T00:00:00.000Z',
  }],
})

const pluginPublic = Object.freeze({
  id: 'plugin_forms',
  slug: 'forms',
  name: 'Forms',
  summary: 'A reviewed form workflow plugin.',
  categories: ['forms'],
  publisherName: 'Fuma Labs',
  publisherVerified: true,
  permissionLabels: ['Store submissions'],
  imageUrl: null,
})

type FixtureRows = Readonly<{
  pricing?: readonly Record<string, unknown>[]
  experts?: readonly Record<string, unknown>[]
  plugins?: readonly Record<string, unknown>[]
}>

function fakeDb(fixture: FixtureRows = {}): DbClient {
  const query = (async <Row>(strings: TemplateStringsArray): Promise<DbResult<Row>> => {
    const sql = strings.join(' ').replace(/\s+/g, ' ').trim()
    const rows = sql.includes('from fuma_price_books')
      ? fixture.pricing ?? [{ version: 'price-book-7', public_json: { items: [pricingItem] }, effective_at: '2026-07-01T00:00:00.000Z', published_at: '2026-07-01T00:00:00.000Z' }]
      : sql.includes('from fuma_expert_profiles')
        ? fixture.experts ?? [{ expert_id: 'private-expert-row', kind: 'designer', display_name: 'Nairobi Designer', profile_json: { public: expertPublic, privateEmail: 'never-selected@example.test' }, public_revision: 7, approved_at: '2026-07-20T00:00:00.000Z' }]
        : sql.includes('from fuma_plugin_artifacts')
          ? fixture.plugins ?? [{ plugin_id: 'private-plugin-row', version: '1.2.3', permissions_json: ['forms.write'], provenance_json: { public: pluginPublic, sourceSha: 'private' }, decided_at: '2026-07-21T00:00:00.000Z' }]
          : []
    return { rows: structuredClone(rows) as Row[], rowCount: rows.length }
  }) as DbClient
  query.unsafe = async () => ({ rows: [], rowCount: 0 })
  query.transaction = async (work) => work(query)
  return Object.assign(query, { dialect: 'postgres' as const })
}

function coordination(): PublicProjectionCoordination {
  return {
    consumeLimit: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    cacheGet: async () => null,
    cacheSet: async () => true,
  }
}

describe('hosted public projection authority registrations', () => {
  test('registers every resource and returns only strict display-safe pages', async () => {
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb())
    const schemas = {
      'product-facts': PublicProductFactsPageSchema,
      pricing: PublicPricingCatalogPageSchema,
      templates: PublicTemplatesPageSchema,
      showcases: PublicShowcasesPageSchema,
      experts: PublicExpertsPageSchema,
      plugins: PublicPluginsPageSchema,
    } as const

    for (const resource of PUBLIC_PROJECTION_RESOURCES) {
      const result = await catalog.read({ resource, query: {} }) as { datasetVersion: string; data: unknown }
      expect(result.datasetVersion).toMatch(new RegExp(`^${resource}:sha256:[a-f0-9]{64}$`))
      expect(Value.Check(schemas[resource], result.data)).toBe(true)
      expect(JSON.stringify(result.data)).not.toContain('private-expert-row')
      expect(JSON.stringify(result.data)).not.toContain('private-plugin-row')
      expect(JSON.stringify(result.data)).not.toContain('never-selected@example.test')
    }
  })

  test('uses stable product IDs and server-owned filters without tenant authority', async () => {
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb())
    const first = await catalog.read({ resource: 'product-facts', query: { profile: 'website' } }) as { datasetVersion: string; data: { items: Array<{ id: string; profiles: string[] }> } }
    const second = await catalog.read({ resource: 'product-facts', query: { profile: 'website' } }) as typeof first
    expect(first.datasetVersion).toBe(second.datasetVersion)
    expect(first.data.items.map(({ id }) => id)).toEqual(['product_website'])
    expect(first.data.items[0]?.profiles).toEqual(['website'])
  })

  test('applies pricing, expert, showcase and plugin filters inside their authorities', async () => {
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb())
    const pricing = await catalog.read({ resource: 'pricing', query: { profile: 'publication' } }) as { data: { items: unknown[] } }
    const experts = await catalog.read({ resource: 'experts', query: { skill: 'development' } }) as { data: { items: unknown[] } }
    const showcases = await catalog.read({ resource: 'showcases', query: { industry: 'other' } }) as { data: { items: unknown[] } }
    const plugins = await catalog.read({ resource: 'plugins', query: { category: 'commerce' } }) as { data: { items: unknown[] } }
    expect(pricing.data.items).toEqual([])
    expect(experts.data.items).toEqual([])
    expect(showcases.data.items).toEqual([])
    expect(plugins.data.items).toEqual([])
  })

  test('rejects private price-book fields and stale or forged cursors', async () => {
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb({
      pricing: [{ version: 'bad', public_json: { items: [{ ...pricingItem, marginBasisPoints: 7500 }] }, effective_at: '2026-07-01T00:00:00.000Z', published_at: '2026-07-01T00:00:00.000Z' }],
    }))
    await expect(catalog.read({ resource: 'pricing', query: {} })).rejects.toBeInstanceOf(PublicProjectionUnavailableError)

    const safeCatalog = createHostedPublicProjectionAuthorityCatalog(fakeDb())
    await expect(safeCatalog.read({ resource: 'product-facts', query: { cursor: 'forged' } })).rejects.toBeInstanceOf(PublicProjectionInvalidRequestError)
    const boundary = createPublicProjectionBoundary({ host: HOST, serviceToken: TOKEN, authority: safeCatalog, coordination: coordination() })
    const response = await boundary.handle(new Request(
      `http://${HOST}/_fuma/private/public/v1/product-facts?cursor=forged`,
      { headers: { authorization: `Bearer ${TOKEN}`, 'x-fuma-audience': 'fuma-public-web', 'x-fuma-request-id': crypto.randomUUID() } },
    ))
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: { code: 'invalid_request', message: 'Invalid public projection filters.' } })
  })

  test('demo: serves a successful validated product envelope from the private runtime boundary', async () => {
    const authority = createHostedPublicProjectionAuthorityCatalog(fakeDb())
    const boundary = createPublicProjectionBoundary({ host: HOST, serviceToken: TOKEN, authority, coordination: coordination() })
    const request = new Request(`http://${HOST}/_fuma/private/public/v1/product-facts?profile=website`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-fuma-audience': 'fuma-public-web',
        'x-fuma-request-id': crypto.randomUUID(),
      },
    })
    const response = await boundary.handle(request)
    const envelope = await response?.json()
    expect(response?.status).toBe(200)
    expect(Value.Check(PublicProductFactsEnvelopeSchema, envelope)).toBe(true)
    expect(response?.headers.get('etag')).toBe(envelope.meta.etag)
    expect(envelope.data.items.map((item: { id: string }) => item.id)).toEqual(['product_website'])
    expect(envelope.meta.datasetVersion).toMatch(/^product-facts:sha256:[a-f0-9]{64}$/)
  })

  test('fails startup composition closed on non-PostgreSQL authority', () => {
    const db = fakeDb()
    Object.defineProperty(db, 'dialect', { value: 'sqlite' })
    expect(() => createHostedPublicProjectionAuthorityCatalog(db)).toThrow('PostgreSQL')
  })
})
