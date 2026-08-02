import {
  PUBLIC_PROJECTION_RESOURCES,
  PublicComponentsPageSchema,
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
import { QUOTA_CLASSES, type PriceBook, type PricedPlan } from '../entitlements/contracts'
import { evidenceSha256, toPublicPricingPlan } from '../entitlements/economics'
import { METER_CLASSES } from '../metering/contracts'
import { PublicProjectionInvalidRequestError, PublicProjectionUnavailableError } from './authority'
import { createPublicProjectionBoundary, type PublicProjectionCoordination } from './boundary'
import { createHostedPublicProjectionAuthorityCatalog } from './registeredAuthorities'

const TOKEN = 'projection-service-token-0000000001'
const HOST = 'studio-internal.service:3001'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const COST_MODEL_VERSION = `cost-model:sha256:${HASH_A}`

const pricingQuotas = Object.freeze(Object.fromEntries(
  QUOTA_CLASSES.map((key, index) => [key, index + 1]),
)) as PricedPlan['quotas']
const pricingAssumptions = Object.freeze(Object.fromEntries(
  METER_CLASSES.map((meter) => [meter, 1]),
)) as PricedPlan['workloadAssumptions']
const pricingInputs = Object.freeze(METER_CLASSES.map((meter) => Object.freeze({
  meter, version: 'cost-v1', source: 'invoice' as const,
})))

function pricingPlan(cadence: 'monthly' | 'annual', amountMinor: number): PricedPlan {
  const variableCostMinor = 10_000
  const fixedSharedCostMinor = 10_000
  const expectedCostMinor = variableCostMinor + fixedSharedCostMinor
  return Object.freeze({
    planId: 'launch', slug: 'launch', name: 'Launch', summary: 'A publish-approved Website plan.',
    profile: 'website', cadence, amountMinor, offeringClass: 'paid', quotas: pricingQuotas,
    workloadAssumptions: pricingAssumptions, featureKeys: Object.freeze(['pages']), promotion: null,
    checkoutAvailable: true, expiresAt: null,
    economics: Object.freeze({
      costModelVersion: COST_MODEL_VERSION, conversionVersion: 'fx-v1', variableCostMinor,
      fixedSharedCostMinor, expectedCostMinor,
      marginBasisPoints: Math.floor(((amountMinor - expectedCostMinor) * 10_000) / amountMinor),
      variableCogsBasisPoints: Math.ceil((variableCostMinor * 10_000) / amountMinor),
      inputs: pricingInputs,
    }),
  })
}

function publishedPricingBook(): PriceBook {
  const effectiveAt = '2026-07-01T00:00:00.000Z'
  const plans = Object.freeze([pricingPlan('monthly', 250_000), pricingPlan('annual', 2_500_000)])
  return Object.freeze({
    version: 'price-book-7', currency: 'KES', effectiveAt, publishedAt: '2026-07-01T00:00:01.000Z',
    costModelVersion: COST_MODEL_VERSION, plans,
    publicJson: Object.freeze({ items: Object.freeze(plans.map((plan) => toPublicPricingPlan(plan, effectiveAt))) }),
  })
}

function pricingRow(value: PriceBook = publishedPricingBook()): Record<string, unknown> {
  return {
    version: value.version, currency: value.currency, public_json: value.publicJson,
    effective_at: value.effectiveAt, published_at: value.publishedAt,
    cost_model_version: value.costModelVersion, evidence_sha256: evidenceSha256(value), private_json: value,
  }
}

const showcase = Object.freeze({
  id: 'showcase_acacia',
  slug: 'acacia-publication',
  title: 'Acacia Publication',
  summary: 'An approved public release with dual attribution consent.',
  profiles: ['publication'],
  industries: ['publishing'],
  previewUrl: 'https://acacia.preview.trimly.co.ke/releases/release_public_1/',
  imageUrl: '/images/showcase-acacia.webp',
  expertIds: ['expert_nairobi_designer'],
  approvedAt: '2026-07-20T00:00:00.000Z',
})

const expertPublic = Object.freeze({
  id: 'expert_nairobi_designer',
  slug: 'nairobi-designer',
  publicName: 'Nairobi Designer',
  summary: 'Approved public design and development work.',
  expertType: 'designer',
  location: 'Nairobi',
  skills: ['design'],
  services: ['web-design'],
  showcaseIds: ['showcase_acacia'],
  mediatedInquiryAvailable: true,
  imageUrl: null,
  approvedAt: '2026-07-20T00:00:00.000Z',
})

const expertDomain = Object.freeze({
  expertId: 'expert-domain-1',
  organizationId: 'organization-public-1',
  sourceScope: {
    platformId: 'platform-1', organizationId: 'organization-public-1', workspaceId: 'workspace-1',
    siteId: 'site-1', ownerKey: 'owner-1', ownerGeneration: 3,
  },
  supportedProfiles: ['website', 'publication'],
  public: expertPublic,
  availability: 'available',
  approvedReleaseId: 'release-public-1',
  optedIn: true,
  consentVersion: 4,
  publicRevision: 7,
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
})

const expertDocument = Object.freeze({
  domain: expertDomain,
  public: {
    id: expertPublic.id,
    slug: expertPublic.slug,
    summary: expertPublic.summary,
    location: expertPublic.location,
    skills: expertPublic.skills,
    services: expertPublic.services,
    showcaseIds: expertPublic.showcaseIds,
    mediatedInquiryAvailable: expertPublic.mediatedInquiryAvailable,
    imageUrl: expertPublic.imageUrl,
    showcases: [showcase],
  },
})

function reviewedArtifactRow(kind: 'plugin' | 'component-pack') {
  const plugin = kind === 'plugin'
  const packageId = plugin ? 'fuma.forms' : 'fuma.hero-pack'
  const artifactId = plugin ? 'artifact-plugin-1' : 'artifact-component-1'
  const submissionId = plugin ? 'submission-plugin-1' : 'submission-component-1'
  const decisionId = plugin ? 'decision-plugin-1' : 'decision-component-1'
  const name = plugin ? 'Forms' : 'Hero Pack'
  const slug = plugin ? 'reviewed-forms' : 'reviewed-hero-pack'
  const permissions = plugin ? ['forms.write'] : []
  const submittedAt = '2026-07-21T00:00:00.000Z'
  const decidedAt = '2026-07-21T01:00:00.000Z'
  const submission = {
    schemaVersion: 1,
    submissionId,
    artifact: {
      schemaVersion: 1, artifactId, kind, packageId, exactVersion: '1.2.3',
      executionPolicy: plugin ? 'plugin-sandbox-worker' : 'component-declarative',
      objectKey: `artifacts/${kind}/${packageId}/1.2.3/package.${plugin ? 'zip' : 'json'}`,
      mimeType: plugin ? 'application/zip' : 'application/json',
      contentHashSha256: HASH_A, sizeBytes: 1024, permissions,
      provenance: { sourceHashSha256: HASH_B, lockHashSha256: HASH_C, builderId: 'builder-1' },
      createdAt: submittedAt,
    },
    submitterId: 'publisher-user-1', baselineSubmissionId: null,
    metadata: {
      dependencies: [], schemas: [],
      evidence: {
        provenanceHashSha256: HASH_B,
        license: { spdx: 'MIT', evidenceHashSha256: HASH_C },
        accessibility: { standard: plugin ? 'not-applicable' : 'WCAG2.2-AA', evidenceHashSha256: HASH_B },
        runtimeCompatibility: { runtime: 'fuma-site-runtime', minimumVersion: '1.0.0', evidenceHashSha256: HASH_C },
      },
      public: {
        id: plugin ? 'plugin_reviewed_forms' : 'component_reviewed_hero', slug, name,
        summary: plugin ? 'A reviewed form workflow plugin.' : 'A reviewed declarative hero component pack.',
        categories: plugin ? ['forms'] : ['layout'], publisherName: 'Fuma Labs', publisherVerified: true,
        permissionLabels: plugin ? ['Store submissions'] : [], imageUrl: null,
      },
    },
    metadataHashSha256: HASH_A,
    diff: { permissions: [], dependencies: [], schemas: [] },
    scanState: 'clean', submittedAt,
  }
  const decision = {
    decisionId, submissionId, artifactId, contentHashSha256: HASH_A, reviewerId: 'reviewer-1',
    decision: 'approved', reason: 'All review evidence is current.',
    signature: { algorithm: 'ed25519', keyId: 'review-key-1', payloadHashSha256: HASH_B, value: 's'.repeat(64) },
    decidedAt,
  }
  return {
    artifact_kind: kind, package_id: packageId, exact_version: '1.2.3', content_hash_sha256: HASH_A,
    submission_json: submission, decision_json: decision, decided_at: decidedAt,
    publisher_name: 'Fuma Labs', publisher_memberships: 1,
  }
}

type FixtureRows = Readonly<{
  pricing?: readonly Record<string, unknown>[]
  experts?: readonly Record<string, unknown>[]
  artifacts?: readonly Record<string, unknown>[]
}>

type MutableFixture = {
  pricing: Record<string, unknown>[]
  experts: Record<string, unknown>[]
  artifacts: Record<string, unknown>[]
  sql: string[]
}

function fixtureRows(input: FixtureRows = {}): MutableFixture {
  return {
    pricing: [...(input.pricing ?? [pricingRow()])],
    experts: [...(input.experts ?? [{ expert_id: expertDomain.expertId, profile_json: expertDocument, approved_at: expertPublic.approvedAt }])],
    artifacts: [...(input.artifacts ?? [reviewedArtifactRow('plugin'), reviewedArtifactRow('component-pack')])],
    sql: [],
  }
}

function fakeDb(fixture: MutableFixture): DbClient {
  const query = (async <Row>(strings: TemplateStringsArray): Promise<DbResult<Row>> => {
    const sql = strings.join(' ').replace(/\s+/g, ' ').trim()
    fixture.sql.push(sql)
    const rows = sql.includes('from fuma_price_books')
      ? fixture.pricing
      : sql.includes('from fuma_expert_profiles')
        ? fixture.experts
        : sql.includes('from fuma_artifact_review_submissions_v2')
          ? fixture.artifacts
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
    const fixture = fixtureRows()
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixture))
    const schemas = {
      'product-facts': PublicProductFactsPageSchema,
      pricing: PublicPricingCatalogPageSchema,
      templates: PublicTemplatesPageSchema,
      showcases: PublicShowcasesPageSchema,
      experts: PublicExpertsPageSchema,
      plugins: PublicPluginsPageSchema,
      components: PublicComponentsPageSchema,
    } as const

    for (const resource of PUBLIC_PROJECTION_RESOURCES) {
      const result = await catalog.read({ resource, query: {} }) as { datasetVersion: string; data: unknown }
      expect(result.datasetVersion).toMatch(new RegExp(`^${resource}:sha256:[a-f0-9]{64}$`))
      expect(Value.Check(schemas[resource], result.data)).toBe(true)
      const serialized = JSON.stringify(result.data)
      expect(serialized).not.toMatch(/organization-public|workspace-1|site-1|owner-1|publisher-user|reviewer-1/)
      if (['experts', 'showcases', 'plugins', 'components'].includes(resource)) {
        expect(serialized).not.toMatch(/email|recipient|member|payment|transfer|margin|cogs/i)
      }
    }
  })

  test('queries current canonical lifecycle authority and excludes private, transferred, suspended, withdrawn, or revoked state', async () => {
    const fixture = fixtureRows()
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixture))
    await catalog.read({ resource: 'experts', query: {} })
    await catalog.read({ resource: 'plugins', query: {} })
    const expertSql = fixture.sql.find((sql) => sql.includes('from fuma_expert_profiles')) ?? ''
    expect(expertSql).toContain('release.withdrawn_at is null')
    expect(expertSql).toContain('expert_consent.revoked_at is null')
    expect(expertSql).toContain('site_consent.revoked_at is null')
    expect(expertSql).toContain("organization.status='active'")
    expect(expertSql).toContain("owner.state='active'")
    expect(expertSql).toContain('owner.transfer_id is null')
    expect(expertSql).toContain('owner.transfer_lock_id is null')
    expect(expertSql).toContain('owner.transfer_fence is null')
    expect(expertSql).toContain('profile.opted_in and not profile.suspended')
    expect(expertSql).toContain("latest_moderation.event='suspended'")
    const artifactSql = fixture.sql.find((sql) => sql.includes('from fuma_artifact_review_submissions_v2')) ?? ''
    expect(artifactSql).toContain("submission.scan_state='clean'")
    expect(artifactSql).toContain("decision.decision='approved'")
    expect(artifactSql).toContain('signature_key_id is not null')
    expect(artifactSql).toContain('fuma_artifact_review_revocations_v2')
    expect(artifactSql).toContain("profile.status='active'")
    expect(artifactSql).toContain("latest_moderation.event='suspended'")
  })

  test('re-reads no-store lifecycle state so opt-out, transfer, suspension, withdrawal, and revocation remove records immediately', async () => {
    const fixture = fixtureRows()
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixture))
    const beforeExperts = await catalog.read({ resource: 'experts', query: {} }) as { datasetVersion: string; data: { items: unknown[] } }
    const beforePlugins = await catalog.read({ resource: 'plugins', query: {} }) as { datasetVersion: string; data: { items: unknown[] } }
    const beforeComponents = await catalog.read({ resource: 'components', query: {} }) as { datasetVersion: string; data: { items: unknown[] } }
    expect(beforeExperts.data.items).toHaveLength(1)
    expect(beforePlugins.data.items).toHaveLength(1)
    expect(beforeComponents.data.items).toHaveLength(1)

    fixture.experts.length = 0
    fixture.artifacts.length = 0
    const afterExperts = await catalog.read({ resource: 'experts', query: {} }) as typeof beforeExperts
    const afterShowcases = await catalog.read({ resource: 'showcases', query: {} }) as typeof beforeExperts
    const afterPlugins = await catalog.read({ resource: 'plugins', query: {} }) as typeof beforePlugins
    const afterComponents = await catalog.read({ resource: 'components', query: {} }) as typeof beforeComponents
    expect(afterExperts.data.items).toEqual([])
    expect(afterShowcases.data.items).toEqual([])
    expect(afterPlugins.data.items).toEqual([])
    expect(afterComponents.data.items).toEqual([])
    expect(afterExperts.datasetVersion).not.toBe(beforeExperts.datasetVersion)
    expect(afterPlugins.datasetVersion).not.toBe(beforePlugins.datasetVersion)
    expect(afterComponents.datasetVersion).not.toBe(beforeComponents.datasetVersion)
  })

  test('uses source-owned exact detail/search filters and keeps plugin/component-pack kinds separate', async () => {
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixtureRows()))
    const experts = await catalog.read({ resource: 'experts', query: { query: 'design Nairobi', slug: 'nairobi-designer' } }) as { data: { items: Array<{ slug: string }> } }
    const showcases = await catalog.read({ resource: 'showcases', query: { industry: 'publishing', slug: 'acacia-publication' } }) as { data: { items: Array<{ slug: string }> } }
    const plugins = await catalog.read({ resource: 'plugins', query: { category: 'forms', slug: 'reviewed-forms' } }) as { data: { items: Array<{ artifactKind: string }> } }
    const components = await catalog.read({ resource: 'components', query: { category: 'layout', slug: 'reviewed-hero-pack' } }) as { data: { items: Array<{ artifactKind: string }> } }
    expect(experts.data.items.map((item) => item.slug)).toEqual(['nairobi-designer'])
    expect(showcases.data.items.map((item) => item.slug)).toEqual(['acacia-publication'])
    expect(plugins.data.items.map((item) => item.artifactKind)).toEqual(['plugin'])
    expect(components.data.items.map((item) => item.artifactKind)).toEqual(['component-pack'])
    const absent = await catalog.read({ resource: 'experts', query: { slug: 'private-expert' } }) as { data: { items: unknown[] } }
    expect(absent.data.items).toEqual([])
  })

  test('rejects private price-book fields and stale or forged cursors', async () => {
    const fixture = fixtureRows({
      pricing: [{ ...pricingRow(), public_json: { items: publishedPricingBook().publicJson.items.map((item) => ({ ...item, marginBasisPoints: 7500 })) } }],
    })
    const catalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixture))
    await expect(catalog.read({ resource: 'pricing', query: {} })).rejects.toBeInstanceOf(PublicProjectionUnavailableError)

    const safeCatalog = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixtureRows()))
    await expect(safeCatalog.read({ resource: 'product-facts', query: { cursor: 'forged' } })).rejects.toBeInstanceOf(PublicProjectionInvalidRequestError)
    const boundary = createPublicProjectionBoundary({ host: HOST, serviceToken: TOKEN, authority: safeCatalog, coordination: coordination() })
    const response = await boundary.handle(new Request(
      `http://${HOST}/_fuma/private/public/v1/product-facts?cursor=forged`,
      { headers: { authorization: `Bearer ${TOKEN}`, 'x-fuma-audience': 'fuma-public-web', 'x-fuma-request-id': crypto.randomUUID() } },
    ))
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: { code: 'invalid_request', message: 'Invalid public projection filters.' } })
  })

  test('serves a successful validated product envelope from the private runtime boundary', async () => {
    const authority = createHostedPublicProjectionAuthorityCatalog(fakeDb(fixtureRows()))
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
})
