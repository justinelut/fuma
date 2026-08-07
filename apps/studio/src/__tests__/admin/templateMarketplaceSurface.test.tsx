/**
 * The marketplace surface: what a buyer is offered, and what they are told when they are not.
 */
import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import {
  TemplateMarketplaceSurface,
  type MarketplaceRow,
} from '@admin/fuma/marketplace/TemplateMarketplaceSurface'
import type { TemplateLicence, TemplateListing } from '@core/fuma/templateMarketplace'

function listing(over: Partial<TemplateListing> = {}): TemplateListing {
  return {
    listingId: 'listing-1',
    sellerOrganizationId: 'seller',
    templateName: 'Studio Portfolio',
    state: 'listed',
    currency: 'KES',
    priceMinor: 250_000,
    roundTripVerified: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  }
}

function row(over: Partial<MarketplaceRow> = {}): MarketplaceRow {
  return { listing: listing(), reviewed: true, ...over }
}

const licence: TemplateLicence = {
  licenceId: 'lic-1',
  listingId: 'listing-1',
  buyerOrganizationId: 'buyer',
  currency: 'KES',
  paidMinor: 250_000,
  purchasedAt: '2026-03-01T00:00:00.000Z',
  refundedAt: null,
}

describe('a purchasable listing', () => {
  it('offers a buy action with the price', () => {
    render(<TemplateMarketplaceSurface rows={[row()]} licences={[]} organizationId="buyer" />)
    expect(screen.getByText('Studio Portfolio')).toBeTruthy()
    expect(screen.getByText(/KES 2,500\.00/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Buy' }).hasAttribute('disabled')).toBe(false)
  })

  it('says Free and Get for a zero-priced template rather than showing 0.00', () => {
    render(<TemplateMarketplaceSurface
      rows={[row({ listing: listing({ priceMinor: 0 }) })]}
      licences={[]}
      organizationId="buyer"
    />)
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get' })).toBeTruthy()
  })
})

describe('an owned template', () => {
  it('states the licence instead of offering a second sale', () => {
    // Offering a buy button to somebody who already paid invites a duplicate charge.
    render(<TemplateMarketplaceSurface rows={[row()]} licences={[licence]} organizationId="buyer" />)
    expect(screen.getByText('Licensed to your organization')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull()
  })

  it('and a refunded licence is not treated as owned', () => {
    render(<TemplateMarketplaceSurface
      rows={[row()]}
      licences={[{ ...licence, refundedAt: '2026-03-09T00:00:00.000Z' }]}
      organizationId="buyer"
    />)
    expect(screen.getByRole('button', { name: 'Buy' })).toBeTruthy()
  })

  it('and another organization\'s licence does not mark it owned', () => {
    render(<TemplateMarketplaceSurface
      rows={[row()]}
      licences={[{ ...licence, buyerOrganizationId: 'someone-else' }]}
      organizationId="buyer"
    />)
    expect(screen.getByRole('button', { name: 'Buy' })).toBeTruthy()
  })
})

describe('a listing that cannot be sold', () => {
  it('disables the action AND renders the reason', () => {
    // A disabled button with no explanation reads as the product being broken.
    render(<TemplateMarketplaceSurface
      rows={[row({ reviewed: false })]}
      licences={[]}
      organizationId="buyer"
    />)
    expect(screen.getByRole('button', { name: 'Buy' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/has not passed artifact review/i)).toBeTruthy()
  })

  it('reports the packaging problem in the buyer\'s view too', () => {
    render(<TemplateMarketplaceSurface
      rows={[row({ listing: listing({ roundTripVerified: false }) })]}
      licences={[]}
      organizationId="buyer"
    />)
    expect(screen.getByText(/empty canvas/i)).toBeTruthy()
  })

  it('and a delisted listing with no model problem still says why nothing can be bought', () => {
    render(<TemplateMarketplaceSurface
      rows={[row({ listing: listing({ state: 'delisted' }) })]}
      licences={[]}
      organizationId="buyer"
    />)
    expect(screen.getByText(/not on sale at the moment/i)).toBeTruthy()
  })
})

describe('empty and no-match are different facts', () => {
  it('an empty marketplace says nothing has been listed', () => {
    render(<TemplateMarketplaceSurface rows={[]} licences={[]} organizationId="buyer" />)
    expect(screen.getByText(/No templates have been listed yet/i)).toBeTruthy()
  })

  it('and an incomplete catalogue states its reason rather than looking broken', () => {
    render(<TemplateMarketplaceSurface
      rows={[]}
      licences={[]}
      organizationId="buyer"
      incompleteReason="Template review is not yet available, so no template can be listed."
    />)
    expect(screen.getByRole('status').textContent).toContain('not yet available')
  })
})

describe('the surface carries no stylesheet', () => {
  it('so it meets the shadcn-only acceptance property', async () => {
    const source = await Bun.file(
      new URL('../../admin/fuma/marketplace/TemplateMarketplaceSurface.tsx', import.meta.url).pathname,
    ).text()
    expect(source).not.toContain('module.css')
    expect(source).toContain('RHYTHM')
  })
})
