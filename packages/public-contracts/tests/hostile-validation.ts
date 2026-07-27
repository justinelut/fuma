import { Type, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  CursorPageRequestSchema,
  PublicAcquisitionEventSchema,
  PublicExpertsEnvelopeSchema,
  PublicHandoffIntentSchema,
  PublicHandoffRequestSchema,
  PublicPricingCatalogEnvelopeSchema,
  PublicProductFactsEnvelopeSchema,
  PublicProductFactsQuerySchema,
  PublicTemplatesQuerySchema,
  SafeErrorEnvelopeSchema,
  createCursorPageSchema,
  createPublicReadEnvelopeSchema,
} from '../src/index'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function accepts(schema: TSchema, value: unknown): boolean {
  return Value.Check(schema, value)
}

const safeError = {
  error: {
    code: 'rate_limited',
    message: 'Try again shortly.',
    retryAfterSeconds: 30,
  },
}
assert(accepts(SafeErrorEnvelopeSchema, safeError), 'safe error should validate')
assert(!accepts(SafeErrorEnvelopeSchema, {
  ...safeError,
  stack: 'private stack',
}), 'safe errors must reject envelope extras')
assert(!accepts(SafeErrorEnvelopeSchema, {
  error: { ...safeError.error, internalDetails: 'private detail' },
}), 'safe errors must reject private detail fields')
assert(!accepts(SafeErrorEnvelopeSchema, {
  error: { code: 'invalid_request', message: 'line one\nline two' },
}), 'safe errors must reject control characters')
assert(!accepts(SafeErrorEnvelopeSchema, {
  error: { code: 'rate_limited', message: 'Wait.', retryAfterSeconds: 3_601 },
}), 'safe retry intervals must be bounded')

assert(accepts(CursorPageRequestSchema, { cursor: 'cursor_01', limit: 100 }), 'bounded cursor request should validate')
for (const hostileRequest of [
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { cursor: 'contains spaces' },
  { limit: 10, offset: 10 },
]) {
  assert(!accepts(CursorPageRequestSchema, hostileRequest), 'hostile cursor request should fail')
}

const itemSchema = Type.Object({ id: Type.String({ minLength: 1, maxLength: 16 }) }, { additionalProperties: false })
const pageSchema = createCursorPageSchema(itemSchema)
assert(accepts(pageSchema, {
  items: [{ id: 'item-1' }],
  page: { hasMore: true, nextCursor: 'cursor_02' },
}), 'bounded cursor page should validate')
assert(!accepts(pageSchema, {
  items: Array.from({ length: 101 }, (_, index) => ({ id: `item-${index}` })),
  page: { hasMore: false, nextCursor: null },
}), 'cursor pages must reject oversized item sets')
assert(!accepts(pageSchema, {
  items: [],
  page: { hasMore: true, nextCursor: null },
}), 'hasMore must require a next cursor')
assert(!accepts(pageSchema, {
  items: [{ id: 'item-1', secret: 'no' }],
  page: { hasMore: false, nextCursor: null },
}), 'page items must retain their strict schema')

assert(accepts(PublicHandoffRequestSchema, {
  kind: 'use_template',
  source: 'template',
  templateId: 'portfolio-v2',
}), 'allowlisted handoff should validate')
for (const hostileHandoff of [
  { kind: 'use_template', source: 'template', templateId: 'portfolio-v2', redirectUrl: 'https://attacker.invalid' },
  { kind: 'choose_plan', source: 'pricing', planId: 'starter', email: 'person@example.test' },
  { kind: 'create_site', source: 'home', profile: 'commerce' },
  { kind: 'admin', source: 'direct' },
  { kind: 'contact_expert', source: 'expert', expertId: '../private' },
]) {
  assert(!accepts(PublicHandoffRequestSchema, hostileHandoff), 'hostile handoff should fail')
}

const opaqueIntent = {
  intent: 'A'.repeat(32),
  correlation: 'opaque_correlation_01',
  expiresAt: '2026-07-25T14:15:00Z',
}
assert(accepts(PublicHandoffIntentSchema, opaqueIntent), 'opaque handoff intent should validate')
assert(!accepts(PublicHandoffIntentSchema, {
  ...opaqueIntent,
  audience: 'admin',
}), 'handoff intent must reject audience escalation')
assert(!accepts(PublicHandoffIntentSchema, {
  ...opaqueIntent,
  intent: 'short',
}), 'handoff intent token must be bounded')

const productReadSchema = createPublicReadEnvelopeSchema(Type.Object({
  id: Type.String({ minLength: 1, maxLength: 32 }),
}, { additionalProperties: false }))
const productRead = {
  data: { id: 'product-1' },
  meta: { schemaVersion: 1, datasetVersion: 'products:42', etag: '"products-42"' },
}
assert(accepts(productReadSchema, productRead), 'versioned public read should validate')
assert(!accepts(productReadSchema, {
  ...productRead,
  repository: 'private',
}), 'public reads must reject envelope extras')
assert(!accepts(productReadSchema, {
  ...productRead,
  meta: { ...productRead.meta, generatedBy: 'internal-worker' },
}), 'public read metadata must reject private extras')
assert(!accepts(productReadSchema, {
  ...productRead,
  data: { ...productRead.data, secret: 'private' },
}), 'public read data must retain its strict schema')

const acquisitionEvent = {
  version: 1,
  kind: 'handoff_started',
  routeClass: 'pricing',
  timestamp: '2026-07-25T14:00:00Z',
  consent: 'granted',
  campaignSource: 'organic',
  planId: 'starter',
  handoffCorrelation: 'opaque_correlation_01',
}
assert(accepts(PublicAcquisitionEventSchema, acquisitionEvent), 'privacy-minimized event should validate')
for (const privateField of ['email', 'name', 'staffId', 'tenantId', 'paymentData', 'freeText', 'ipAddress']) {
  assert(!accepts(PublicAcquisitionEventSchema, {
    ...acquisitionEvent,
    [privateField]: 'forbidden',
  }), `public events must reject ${privateField}`)
}
assert(!accepts(PublicAcquisitionEventSchema, {
  ...acquisitionEvent,
  routeClass: '/organizations/private-site',
}), 'events must reject unbounded routes')
assert(!accepts(PublicAcquisitionEventSchema, {
  ...acquisitionEvent,
  campaignSource: 'utm payload with free text',
}), 'events must reject unbounded attribution')


const publicProductEnvelope = {
  data: {
    items: [{
      id: 'product_website',
      slug: 'website',
      name: 'Website',
      summary: 'A public product description.',
      profiles: ['website'],
      available: true,
      featureKeys: ['visual-editor'],
      updatedAt: '2026-07-25T20:00:00Z',
    }],
    page: { hasMore: false, nextCursor: null },
  },
  meta: { schemaVersion: 1, datasetVersion: 'product-facts:7', etag: '"product-facts-7"' },
}
assert(accepts(PublicProductFactsEnvelopeSchema, publicProductEnvelope), 'public product projection should validate')
for (const privateField of ['organizationId', 'tenantId', 'staffEmail', 'secret', 'internalGrant']) {
  assert(!accepts(PublicProductFactsEnvelopeSchema, {
    ...publicProductEnvelope,
    data: {
      ...publicProductEnvelope.data,
      items: [{ ...publicProductEnvelope.data.items[0], [privateField]: 'forbidden' }],
    },
  }), `product projection must reject ${privateField}`)
}
assert(!accepts(PublicProductFactsEnvelopeSchema, {
  ...publicProductEnvelope,
  data: { ...publicProductEnvelope.data, items: [{ ...publicProductEnvelope.data.items[0], id: '../internal-row' }] },
}), 'public IDs must reject path-like internal selectors')
assert(!accepts(PublicProductFactsEnvelopeSchema, {
  ...publicProductEnvelope,
  meta: { ...publicProductEnvelope.meta, schemaVersion: 2 },
}), 'unknown projection schema versions must fail closed')

const publicPricingEnvelope = {
  data: {
    items: [{
      id: 'plan_publication_monthly',
      slug: 'publication-monthly',
      name: 'Publication monthly',
      summary: 'A publish-approved public plan.',
      profile: 'publication',
      currency: 'KES',
      cadence: 'monthly',
      amountMinor: 1,
      featureKeys: [],
      quotas: [],
      promotion: null,
      checkoutAvailable: false,
      effectiveAt: '2026-07-25T20:00:00Z',
      expiresAt: null,
    }],
    page: { hasMore: false, nextCursor: null },
  },
  meta: { schemaVersion: 1, datasetVersion: 'pricing:3', etag: '"pricing-3"' },
}
assert(accepts(PublicPricingCatalogEnvelopeSchema, publicPricingEnvelope), 'published pricing projection should validate')
for (const privateField of ['privateOffer', 'setupNegotiation', 'internalGrant', 'providerPlanId', 'providerCost', 'cogs', 'grossMargin', 'paymentState', 'transferState']) {
  assert(!accepts(PublicPricingCatalogEnvelopeSchema, {
    ...publicPricingEnvelope,
    data: {
      ...publicPricingEnvelope.data,
      items: [{ ...publicPricingEnvelope.data.items[0], [privateField]: 'forbidden' }],
    },
  }), `pricing projection must reject ${privateField}`)
}

assert(accepts(PublicProductFactsQuerySchema, { profile: 'website', cursor: 'next_1', limit: 100 }), 'bounded product filters should validate')
for (const query of [
  { limit: 101 },
  { profile: 'private' },
  { organizationId: 'org_private' },
  { cursor: 'not a cursor' },
]) {
  assert(!accepts(PublicProductFactsQuerySchema, query), 'hostile product filter must fail')
}
assert(accepts(PublicTemplatesQuerySchema, { profile: 'publication', industry: 'news', style: 'editorial' }), 'bounded template filters should validate')
assert(!accepts(PublicTemplatesQuerySchema, { industry: 'news', ownerId: 'private' }), 'template filters must reject owner substitution')

assert(!accepts(PublicExpertsEnvelopeSchema, {
  data: {
    items: [{
      id: 'expert_public_1', slug: 'public-expert', publicName: 'Public expert', summary: 'Approved profile.', expertType: 'designer',
      location: 'Nairobi', skills: [], services: [], showcaseIds: [], mediatedInquiryAvailable: true, imageUrl: null,
      approvedAt: '2026-07-25T20:00:00Z', email: 'private@example.test',
    }],
    page: { hasMore: false, nextCursor: null },
  },
  meta: { schemaVersion: 1, datasetVersion: 'experts:2', etag: '"experts-2"' },
}), 'expert projections must reject direct PII')
