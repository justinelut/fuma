import { describe, expect, test } from 'bun:test'
import type { PublicPricingCatalogEnvelope } from '@fuma/public-contracts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { PricingCatalog } from '../components/pricing-catalog'
import { pricingEnvelope } from './fixtures/public-web'

const NOW = new Date('2026-07-26T08:00:00.000Z')

function render(envelope: PublicPricingCatalogEnvelope | null): string {
  return renderToStaticMarkup(
    <PricingCatalog cadence="monthly" envelope={envelope} now={NOW} />,
  )
}

describe('responsive accessible authoritative pricing presentation', () => {
  test('renders authority-backed amount, cadence, features, quotas, promotion and version-bound CTA', () => {
    const promoted = {
      ...pricingEnvelope,
      data: {
        ...pricingEnvelope.data,
        items: pricingEnvelope.data.items.map((item) => ({
          ...item,
          promotion: {
            label: 'Launch window',
            startsAt: '2026-07-20T00:00:00.000Z',
            endsAt: '2026-07-30T00:00:00.000Z',
          },
        })),
      },
    } satisfies PublicPricingCatalogEnvelope
    const html = render(promoted)
    expect(html).toMatch(/KES(?:&nbsp;|\s)*2,500/)
    expect(html).toContain('per month, billed monthly')
    expect(html).toContain('Included features')
    expect(html).toContain('Published allowances')
    expect(html).toContain('Launch window')
    expect(html).toContain('priceBookVersion=ke-2026-07-v1')
    expect(html).toContain('cadence=monthly')
  })

  test('uses semantic headings, lists, descriptions, a labelled comparison and keyboard-scrollable table', () => {
    const html = render(pricingEnvelope as PublicPricingCatalogEnvelope)
    expect(html).toContain('<article aria-labelledby="pricing-plan_launch_monthly"')
    expect(html).toContain('<ul')
    expect(html).toContain('<dl')
    expect(html).toContain('<caption class="sr-only">')
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-current="page"')
  })

  test('suppresses amounts, comparison and purchase CTAs for withdrawn, stale or unavailable authority', () => {
    const withdrawn = {
      ...pricingEnvelope,
      data: { effectiveVersion: null, items: [], page: { hasMore: false, nextCursor: null } },
    } satisfies PublicPricingCatalogEnvelope
    const stale = {
      ...pricingEnvelope,
      data: {
        ...pricingEnvelope.data,
        items: pricingEnvelope.data.items.map((item) => ({ ...item, expiresAt: '2026-07-26T08:00:00.000Z' })),
      },
    } satisfies PublicPricingCatalogEnvelope
    for (const html of [render(withdrawn), render(stale), render(null)]) {
      expect(html).toContain('Current publish-approved pricing is unavailable')
      expect(html).not.toMatch(/KES(?:&nbsp;|\s)*[0-9]/)
      expect(html).not.toContain('Choose Launch')
      expect(html).not.toContain('Compare published allowances')
    }
  })

  test('keeps responsive behavior in app-local Tailwind and no private authority imports or custom CSS', () => {
    const source = readFileSync(path.join(import.meta.dir, '../components/pricing-catalog.tsx'), 'utf8')
    expect(source).toContain('sm:grid-cols-2')
    expect(source).toContain('xl:grid-cols-3')
    expect(source).toContain('overflow-x-auto')
    expect(source).toContain('min-w-[42rem]')
    expect(source).not.toMatch(/\.module\.css|@studio|apps\/studio|zod/)
  })

  test('demo: a version switch changes display data and withdrawal removes commerce without Web edits', () => {
    const switched = {
      ...pricingEnvelope,
      data: {
        ...pricingEnvelope.data,
        effectiveVersion: 'ke-2026-08-v2',
        items: pricingEnvelope.data.items.map((item) => ({ ...item, amountMinor: 300_000 })),
      },
    } satisfies PublicPricingCatalogEnvelope
    const before = render(pricingEnvelope as PublicPricingCatalogEnvelope)
    const after = render(switched)
    expect(before).toMatch(/2,500/)
    expect(after).toMatch(/3,000/)
    expect(after).toContain('ke-2026-08-v2')
    expect(render({ ...switched, data: { effectiveVersion: null, items: [], page: { hasMore: false, nextCursor: null } } })).not.toContain('Choose Launch')
  })
})
