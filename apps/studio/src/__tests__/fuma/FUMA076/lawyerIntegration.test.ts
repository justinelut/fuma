import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { planLawyerImport } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot, FUMA076_ROUTES } from './lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

describe('FUMA-076 Lawyer inventory and mapping integration', () => {
  it('preserves the complete sanitized route, content, relation, member, newsletter, and commitment inventory', async () => {
    const first = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-076-demo', dryRun: true, digest })
    const second = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-076-demo', dryRun: true, digest })

    expect(second).toEqual(first)
    expect(first.report.routes).toEqual([...FUMA076_ROUTES].sort((left, right) => left.route.localeCompare(right.route)))
    expect(first.report.routes.reduce<Record<string, number>>((counts, route) => ({
      ...counts,
      [route.access]: (counts[route.access] ?? 0) + 1,
    }), {})).toEqual({ public: 44, member: 6, staff: 3, service: 16 })
    const contentObjects = first.genericPlan.objects.filter(({ kind }) => kind === 'post' || kind === 'page')
    expect(contentObjects).toHaveLength(63)
    expect(contentObjects.every(({ value }) => Array.isArray(value.authorIds) && value.authorIds.length === 1)).toBe(true)
    expect(contentObjects.filter(({ kind }) => kind === 'post').every(({ value }) => Array.isArray(value.tagIds) && value.tagIds.length === 2)).toBe(true)
    expect(contentObjects.reduce((count, { value }) => count
      + (Array.isArray(value.authorIds) ? value.authorIds.length : 0)
      + (Array.isArray(value.tagIds) ? value.tagIds.length : 0), 0)).toBe(147)
    expect(first.report.counts.publicContent + first.report.counts.memberContent + first.report.counts.paidContent).toBe(63)
    expect(first.report.counts).toEqual({
      routes: 69, pageRoutes: 40, apiRoutes: 18, feedRoutes: 6, systemRoutes: 5,
      posts: 42, pages: 21, authors: 4, tags: 38, relations: 147, members: 4, newsletters: 1,
      settings: 17, media: 2, sectionTags: 13, reservedPages: 16,
      publicContent: 45, memberContent: 9, paidContent: 9,
    })
    expect(first.report.routes[0]?.route).toBe('/')
    expect(first.report.routes.at(-1)?.route).toBe('/topics')
    expect(first.report.sectionPlacements).toHaveLength(42)
    expect(new Set(first.report.sectionPlacements.flatMap(({ tagSlugs }) => tagSlugs))).toEqual(new Set([
      'section-cover-story', 'section-featured', 'section-lead', 'section-lead-secondary', 'section-brief',
      'section-in-depth', 'section-most-read', 'section-case-law', 'section-podcast', 'section-col-from-the-bench',
      'section-col-practitioner', 'section-col-off-the-record', 'section-col-reader',
    ]))
    expect(first.report.reservedPages).toHaveLength(16)
    expect(first.report.reservedPages.every(({ state }) => state === 'mapped')).toBe(true)
    expect(new Set(first.report.envelopes.map(({ schema }) => schema))).toEqual(new Set(['byline', 'brief', 'case-law', 'podcast', 'column', 'reserved-config']))
    expect(first.report.quarantine).toEqual([expect.objectContaining({ sourceId: 'post-2', field: 'custom_excerpt', reason: 'malformed-json' })])
    expect(first.report.reauthentication.staffSourceIds).toHaveLength(4)
    expect(first.report.reauthentication.memberSourceIds).toEqual(['member-a', 'member-b', 'member-c', 'member-d'])
    expect(first.genericPlan.objects.filter(({ requiresReauthentication }) => requiresReauthentication)).toHaveLength(8)
    expect(first.report.mailMigration).toEqual({
      destinationProvider: 'oci-email-delivery',
      legacyPathsExcluded: ['ghost-native', 'resend', 'smtp'],
      providerCredentialsImported: false,
    })
    expect(first.report.commitments).toMatchObject({
      storage: { launchDiskGiB: 40, utilizationWatchPercent: 70 },
      traffic: { launchVcpu: 2, launchMemoryGiB: 4, horizontalScaleReady: true },
      support: { annualMaintenanceKes: 5000, bestEffortResponseHours: 48 },
    })
    expect(Object.values(first.report.hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true)
    expect(first.report.excludedKinds).toEqual(['passwords', 'sessions', 'cookies', 'api-keys', 'provider-secrets'])
    expect(first.report.designConversion).toBe('deferred-to-FUMA-077-and-FUMA-SITE-006')

    console.log('FUMA-076_DEMO', JSON.stringify({
      inventory: first.report.counts,
      reportSha256: first.report.hashes.reportSha256,
      manifestSha256: first.genericPlan.manifestHashSha256,
      quarantined: first.report.quarantine.length,
      paymentClassifications: first.report.payments.map(({ claimId, classification }) => ({ claimId, classification })),
      mail: first.report.mailMigration,
    }))
  })
})
