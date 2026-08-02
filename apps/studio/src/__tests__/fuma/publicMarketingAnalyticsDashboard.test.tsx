import { expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { PublicMarketingAnalyticsDashboard } from '../../admin/fuma/publicAnalytics/PublicMarketingAnalyticsDashboard'

const report = Object.freeze({
  range: { from: '2040-02-01', to: '2040-02-02' },
  retention: { rawEventDays: 30 as const, aggregateDays: 400 as const },
  totals: { pageViews: 10, ctaSelections: 4, handoffs: 2, signups: 2, sites: 1, publishes: 1, paid: 1 },
  funnel: { visits: 2, signups: 2, sites: 1, publishes: 1, paid: 1 },
  conversionBasisPoints: { visitToSignup: 10_000, signupToSite: 5_000, siteToPublish: 10_000, publishToPaid: 10_000 },
  routes: [{ routeClass: 'home' as const, pageViews: 10, handoffs: 2 }],
  campaigns: [{ campaignSource: 'organic' as const, pageViews: 6, handoffs: 1 }],
})

test('FUMA-WEB-016 dashboard exposes a labelled aggregate funnel and retention policy', async () => {
  render(<PublicMarketingAnalyticsDashboard client={{ report: async () => report }} />)
  expect(await screen.findByRole('heading', { name: 'Privacy-preserving funnel' })).toBeDefined()
  expect(screen.getByRole('form', { name: 'Marketing analytics date range' })).toBeDefined()
  expect(await screen.findByRole('table', { name: 'Opaque handoff cohort funnel' })).toBeDefined()
  expect(screen.getByRole('table', { name: 'Coarse route classes' })).toBeDefined()
  expect(screen.getByRole('table', { name: 'Coarse campaign classes' })).toBeDefined()
  expect(screen.getByRole('rowheader', { name: 'organic' })).toBeDefined()
  expect(screen.getByText('50.00%')).toBeDefined()
  expect(screen.getByText(/No IP, URL, referrer, identity, tenant, member, payment, staff, session, or fingerprint/i)).toBeDefined()
  expect(screen.getByText(/expire after 30 days/)).toBeDefined()
})
