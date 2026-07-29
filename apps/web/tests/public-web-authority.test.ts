import { describe, expect, test } from 'bun:test'
import { PublicHandoffRequestSchema, PublicPricingCatalogEnvelopeSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import {
  activePromotion,
  formatKes,
  formatPricingQuota,
  isImmutableTemplatePreview,
  pricingPlanIntentHref,
  visiblePricing,
} from '../lib/public-data'
import { expiredPricingEnvelope, pricingEnvelope } from './fixtures/public-web'

describe('authoritative public commerce presentation', () => {
  test('accepts only strict display-safe versioned pricing envelopes', () => {
    expect(Value.Check(PublicPricingCatalogEnvelopeSchema, pricingEnvelope)).toBe(true)
    expect(Value.Check(PublicPricingCatalogEnvelopeSchema, { ...pricingEnvelope, privateOffer: true })).toBe(false)
    expect(Value.Check(PublicPricingCatalogEnvelopeSchema, {
      ...pricingEnvelope,
      data: {
        ...pricingEnvelope.data,
        items: [{ ...pricingEnvelope.data.items[0], providerPlanId: 'forbidden' }],
      },
    })).toBe(false)
    expect(Value.Check(PublicPricingCatalogEnvelopeSchema, {
      ...pricingEnvelope,
      data: { ...pricingEnvelope.data, effectiveVersion: 'bad version' },
    })).toBe(false)
  })

  test('suppresses expired, withdrawn and invalid-clock plans rather than retaining amounts', () => {
    expect(visiblePricing(pricingEnvelope, new Date('2026-07-26T08:00:00Z'))).toHaveLength(1)
    expect(visiblePricing(expiredPricingEnvelope, new Date('2026-07-26T08:00:00Z'))).toHaveLength(0)
    expect(visiblePricing({ ...pricingEnvelope, data: { ...pricingEnvelope.data, effectiveVersion: null } }, new Date('2026-07-26T08:00:00Z'))).toEqual([])
    expect(visiblePricing(pricingEnvelope, new Date(Number.NaN))).toEqual([])
    expect(visiblePricing(null)).toEqual([])
  })

  test('formats projected KES minor units and finite quotas without floating authority', () => {
    expect(formatKes(250_000)).toMatch(/KES\s*2,500/)
    expect(formatKes(250_050)).toMatch(/2,500\.5/)
    expect(() => formatKes(1.5)).toThrow(RangeError)
    expect(formatPricingQuota(1_500_000_000, 'bytes')).toBe('1.5 GB')
    expect(formatPricingQuota(75, 'minutes')).toBe('75 minutes')
  })

  test('suppresses inactive promotions at exact half-open boundaries', () => {
    const plan = {
      ...pricingEnvelope.data.items[0],
      promotion: {
        label: 'Window',
        startsAt: '2026-07-01T00:00:00Z',
        endsAt: '2026-07-20T00:00:00Z',
      },
    }
    expect(activePromotion(plan, new Date('2026-06-30T23:59:59Z'))).toBeNull()
    expect(activePromotion(plan, new Date('2026-07-20T00:00:00Z'))).toBeNull()
  })

  test('creates only a version-and-cadence-bound plan intent for app re-resolution', () => {
    const plan = pricingEnvelope.data.items[0]
    const href = pricingPlanIntentHref(plan, pricingEnvelope.data.effectiveVersion)
    expect(href).toBe('/start?kind=choose_plan&source=pricing&planId=plan_launch&priceBookVersion=ke-2026-07-v1&cadence=monthly')
    const params = Object.fromEntries(new URL(href, 'https://fuma.co.ke').searchParams)
    expect(Value.Check(PublicHandoffRequestSchema, params)).toBe(true)
    expect(href).not.toMatch(/amount|provider|offer|grant|margin|cogs|payment|transfer/i)
  })

  test('requires isolated immutable template previews', () => {
    expect(isImmutableTemplatePreview('https://templates.preview.fuma.co.ke/releases/release_1/')).toBe(true)
    expect(isImmutableTemplatePreview('https://fuma.co.ke/templates/live')).toBe(false)
    expect(isImmutableTemplatePreview('https://sample.preview.fuma.co.ke/draft')).toBe(false)
  })
})
