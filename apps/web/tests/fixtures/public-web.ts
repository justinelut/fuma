export const pricingEnvelope = {
  data: {
    effectiveVersion: 'ke-2026-07-v1',
    items: [{
      id: 'plan_launch_monthly',
      planId: 'plan_launch',
      slug: 'launch',
      name: 'Launch',
      summary: 'A publish-approved launch plan.',
      profile: 'website',
      currency: 'KES',
      cadence: 'monthly',
      amountMinor: 250_000,
      featureKeys: ['pages'],
      quotas: [{ key: 'sites', label: 'Sites', limit: 1, unit: 'count' }],
      promotion: null,
      checkoutAvailable: true,
      effectiveAt: '2026-07-01T00:00:00Z',
      expiresAt: '2026-08-01T00:00:00Z',
    }],
    page: { hasMore: false, nextCursor: null },
  },
  meta: { schemaVersion: 1, datasetVersion: 'pricing:1', etag: '"pricing-1"' },
} as const

export const expiredPricingEnvelope = {
  ...pricingEnvelope,
  data: {
    ...pricingEnvelope.data,
    items: pricingEnvelope.data.items.map((item) => ({ ...item, expiresAt: '2026-07-02T00:00:00Z' })),
  },
}

export const editorialSource = `---
title: Safe entry
description: A safe public editorial entry.
slug: safe-entry
collection: docs
author: Fuma Docs
category: Foundations
publishedAt: 2026-07-26T00:00:00Z
updatedAt: 2026-07-26T00:00:00Z
reviewAt: 2026-10-26T00:00:00Z
draft: false
version: 1.0
redirects: []
components: []
owner: Documentation
audience: public
---
## Safe heading

Public copy.`
