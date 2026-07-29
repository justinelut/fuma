const PAGE_ROUTES = [
  '/', '/about', '/admin', '/admin/broadcast', '/admin/calendar', '/archive', '/article/[slug]',
  '/article/[slug]/print', '/author/[slug]', '/brand-guideline', '/category/[slug]', '/contact',
  '/contributors', '/feeds', '/global-brief', '/global-brief/[city]', '/legal/[slug]', '/letters',
  '/member', '/member/account', '/member/billing', '/member/reading-list', '/member/submissions',
  '/member/submissions/[id]/edit', '/membership', '/membership/callback', '/membership/initialise',
  '/membership/pay-by-transfer', '/newsletter/unsubscribe', '/newsletters', '/pillar/[slug]', '/podcast',
  '/podcast/[slug]', '/search', '/sign-in', '/sign-up', '/submit', '/submit/guidelines', '/submit/thanks', '/topics',
] as const
const API_ROUTES = [
  '/api/auth/magic-link', '/api/bookmarks', '/api/brand-review', '/api/comments/[postId]', '/api/health',
  '/api/health/ready', '/api/member/signout', '/api/member/update-account', '/api/newsletter/preview',
  '/api/newsletter/send', '/api/newsletter/subscribe', '/api/og', '/api/paystack/webhook', '/api/revalidate',
  '/api/search/preview', '/api/submissions', '/api/submissions/[id]', '/api/track',
] as const
const FEED_ROUTES = [
  '/author/[slug]/feed.xml', '/category/[slug]/feed.xml', '/feed.xml', '/podcast/feed.xml', '/robots.txt', '/sitemap.xml',
] as const
const SYSTEM_ROUTES = ['/_global-error', '/_not-found', '/apple-icon', '/auth/verify', '/icon.svg'] as const

export const FUMA076_ROUTES = Object.freeze([
  ...PAGE_ROUTES.map((route) => ({ route, kind: 'page' as const, source: `src/app${route === '/' ? '/page.tsx' : route}/page.tsx`, access: route.startsWith('/admin') ? 'staff' as const : route === '/member' || route.startsWith('/member/') ? 'member' as const : 'public' as const })),
  ...API_ROUTES.map((route) => ({ route, kind: 'api' as const, source: `src/app${route}/route.ts`, access: route.includes('/health') || route.includes('/og') ? 'public' as const : 'service' as const })),
  ...FEED_ROUTES.map((route) => ({ route, kind: 'feed' as const, source: `src/app${route}/route.ts`, access: 'public' as const })),
  ...SYSTEM_ROUTES.map((route) => ({ route, kind: 'system' as const, source: `src/app${route}`, access: route === '/auth/verify' ? 'service' as const : 'public' as const })),
])

const ARTICLE_SLUGS = [
  'the-constitutional-pivot', 'third-party-funding-class-action', 'ma-outlook-consolidation',
  'ai-liability-error-in-machine', 'transfer-pricing-2026', 'karen-trust', 'esg-litigation-greenwashing',
  'the-trust-that-vanished-investigation', 'from-the-bench-judicial-review-original-tradition',
  'the-practitioner-first-hearing', 'off-the-record-workload-not-competence', 'the-reader-ai-letters',
  'central-bank-cap-relief-banking', 'termination-without-cause-employment', 'white-collar-prosecutions-criminal',
  'succession-act-2026-family', 'nairobi-as-arbitration-seat', 'carbon-credits-environment',
] as const
const BRIEF_SLUGS = Array.from({ length: 10 }, (_, index) => `brief-${String(index + 1).padStart(2, '0')}`)
const CASE_SLUGS = ['case-pet-12-of-2026', 'case-ca-47-of-2024', 'case-hcc-88-of-2025', 'case-crim-14-of-2026', 'case-tt-73-of-2025', 'case-jr-8-of-2026'] as const
const EPISODE_SLUGS = [
  'podcast-25-constitutional-review', 'podcast-24-ouko-reform', 'podcast-23-ai-in-practice',
  'podcast-22-tax-tribunal', 'global-brief-london-silk-and-the-african-firm',
  'global-brief-dubai-arbitration-boom', 'global-brief-lagos-two-markets-one-language',
  'global-brief-dc-constitutional-debate-african-eyes',
] as const
const POST_SLUGS = [...ARTICLE_SLUGS, ...BRIEF_SLUGS, ...CASE_SLUGS, ...EPISODE_SLUGS]

const RESERVED_EXCERPT = [
  '_folio', '_quote-of-the-week', '_print-edition', '_morning-brief-report', '_morning-brief-job',
  '_socials', '_theme', '_contact-info',
] as const
const RESERVED_CODE = [
  '_pillars', '_global-brief', '_audience-segments', '_verticals', '_home-labels', '_menu', '_footer', '_paystack-config',
] as const
const PUBLIC_PAGES = ['about', 'privacy', 'terms', 'cookies', 'ethics'] as const
const PAGE_SLUGS = [...RESERVED_EXCERPT, ...RESERVED_CODE, ...PUBLIC_PAGES]

const SECTION_TAGS = [
  'section-cover-story', 'section-featured', 'section-lead', 'section-lead-secondary', 'section-brief',
  'section-in-depth', 'section-most-read', 'section-case-law', 'section-podcast', 'section-col-from-the-bench',
  'section-col-practitioner', 'section-col-off-the-record', 'section-col-reader',
] as const
const OTHER_TAGS = [
  'constitutional', 'litigation', 'corporate', 'tax', 'land', 'tech-ip', 'banking-finance', 'employment',
  'criminal', 'family', 'arbitration', 'environment', 'pillar-emerging-trends', 'pillar-jurisprudence',
  'pillar-law-politics', 'pillar-human-stories', 'pillar-judiciary', 'pillar-global-brief', 'city-london',
  'city-dubai', 'city-lagos', 'city-dc', 'submission-pending', 'submission-reviewing', 'submission-declined',
] as const
const TAG_SLUGS = [...SECTION_TAGS, ...OTHER_TAGS]
const AUTHORS = ['author-editor', 'author-reporter', 'author-columnist', 'author-correspondent'] as const

function excerptFor(index: number, section: string): string {
  if (index === 1) return '{"byline":"Malformed fixture"'
  if (section === 'section-brief') return JSON.stringify({ time: '12:14', source: 'Fixture Court' })
  if (section === 'section-case-law') return JSON.stringify({ court: 'Fixture Court', date: '25 Jul', caseRef: `Fixture ${index}`, status: 'Allowed' })
  if (section === 'section-podcast') return JSON.stringify({ episodeNumber: index, guest: 'Fixture Guest', duration: '40 min', hasTranscript: true })
  if (section.startsWith('section-col-')) return JSON.stringify({ byline: `Fixture Columnist ${index}`, credential: 'KC', column: 'Fixture Column', excerpt: 'Sanitized fixture excerpt.' })
  return JSON.stringify({ byline: `Fixture Author ${index}`, credential: 'KC', role: 'Fixture Desk', excerpt: 'Sanitized local-shaped article excerpt.' })
}

const tagRows = TAG_SLUGS.map((slug, index) => ({ id: `tag-${index + 1}`, name: slug.replaceAll('-', ' '), slug, visibility: slug.startsWith('submission-') ? 'internal' : 'public' }))
const tagIdBySlug = new Map(tagRows.map((tag) => [tag.slug, tag.id]))
const postRows = POST_SLUGS.map((slug, index) => {
  const section = SECTION_TAGS[index % SECTION_TAGS.length]!
  return {
    id: `post-${index + 1}`,
    type: 'post',
    title: `Sanitized Lawyer item ${index + 1}`,
    slug,
    html: `<p>Sanitized Lawyer article ${index + 1}.</p>`,
    custom_excerpt: excerptFor(index, section),
    status: 'published',
    visibility: index % 5 === 0 ? 'paid' : index % 5 === 1 ? 'members' : 'public',
    feature_image: `https://media.example.test/lawyer-${index % 2}.jpg`,
    published_at: '2026-07-20T08:00:00Z',
    created_at: '2026-07-19T08:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
  }
})
const pageRows = PAGE_SLUGS.map((slug, index) => {
  const excerptConfig = JSON.stringify({ fixture: slug, ordinal: index + 1 })
  const codeConfig = `<script type="application/json" id="lawyer-config">${JSON.stringify({ fixture: slug, entries: [{ id: `entry-${index + 1}` }] })}</script>`
  return {
    id: `page-${index + 1}`,
    type: 'page',
    title: `Sanitized page ${slug}`,
    slug,
    html: '<p>Sanitized page.</p>',
    custom_excerpt: RESERVED_EXCERPT.includes(slug as never) ? excerptConfig : `Sanitized description for ${slug}.`,
    ...(RESERVED_CODE.includes(slug as never) ? { codeinjection_head: codeConfig } : {}),
    status: 'published',
    visibility: 'public',
    created_at: '2026-07-18T08:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
  }
})
const allContent = [...postRows, ...pageRows]
const authorRelations = allContent.map((row, index) => ({ post_id: row.id, author_id: AUTHORS[index % AUTHORS.length] }))
const tagRelations = postRows.flatMap((row, index) => {
  const section = SECTION_TAGS[index % SECTION_TAGS.length]!
  const vertical = OTHER_TAGS[index % 12]!
  return [
    { post_id: row.id, tag_id: tagIdBySlug.get(section)! },
    { post_id: row.id, tag_id: tagIdBySlug.get(vertical)! },
  ]
})

const SCOPE = {
  platformId: 'fuma-platform', organizationId: 'lawyer-org', workspaceId: 'lawyer-workspace',
  siteId: 'lawyer-site', ownerKey: 'lawyer-owner', ownerGeneration: 1,
} as const
function metadata(memberId: string, tierId: string, amountMinor: number, purchaseId: string) {
  return {
    purchaseId, ...SCOPE, memberId, tierId, credentialId: 'merchant-credential', credentialVersion: 1,
    amountMinor, currency: 'KES' as const, periodDays: 30, graceDays: 7, channel: 'card' as const,
    mobileProvider: null, renewalOfMembershipId: null, renewalConfirmationId: null,
  }
}
function transaction(reference: string, providerTransactionId: string, amountMinor: number) {
  return {
    scope: 'customer_merchant' as const, reference, status: 'success' as const,
    money: { amountMinor, currency: 'KES' }, channel: 'card', channelDetail: 'visa', customerCode: null,
    authorizationCode: null, reusableAuthorization: false, providerTransactionId,
  }
}

const fixture = {
  schemaVersion: 1,
  snapshotId: 'lawyer-sanitized-2026-07-28',
  sourceSystem: 'the-lawyer-ghost-next',
  collectedAt: '2026-07-28T12:00:00Z',
  ghostExport: {
    meta: { version: '5.82.0' },
    data: {
      posts: allContent,
      users: AUTHORS.map((author, index) => ({ id: author, name: `Sanitized Author ${index + 1}`, slug: author, email: `author-${index + 1}@example.test`, bio: 'Sanitized fixture author.' })),
      tags: tagRows,
      posts_authors: authorRelations,
      posts_tags: tagRelations,
      settings: [
        { key: 'title', value: 'The Lawyer Sanitized Fixture' },
        { key: 'resend_api_key', value: 'excluded-before-generic-import' },
        { key: 'smtp_password', value: 'excluded-before-generic-import' },
      ],
      members: [
        { id: 'member-a', email: 'reader-a@example.test', name: 'Reader A', labels: ['paystack-active', 'paystack-practitioner', 'paystack-monthly'], note: 'Paystack KES monthly — ref lawyer_ref_verified_0001' },
        { id: 'member-b', email: 'reader-b@example.test', name: 'Reader B', labels: ['paystack-active', 'paystack-chambers', 'paystack-annual'], note: 'Paystack KES annual — ref lawyer_ref_missing_00002' },
        { id: 'member-c', email: 'reader-c@example.test', name: 'Reader C', labels: ['paystack-active', 'paystack-practitioner', 'paystack-annual'], note: 'Paystack KES annual — ref lawyer_ref_mismatch_0003' },
        { id: 'member-d', email: 'reader-d@example.test', name: 'Reader D', labels: [], note: null },
      ],
      newsletters: [{ id: 'newsletter-morning-brief', name: 'Morning Brief', description: 'Sanitized daily digest.', status: 'active', sender_name: 'The Lawyer', sender_email: 'news@example.test', subscribe_on_signup: true }],
    },
  },
  routes: FUMA076_ROUTES,
  expectedCounts: { routes: 69, posts: 42, pages: 21, authors: 4, tags: 38, relations: 147, members: 4, newsletters: 1 },
  paymentClaims: [
    { claimId: 'claim-a', memberSourceId: 'member-a', labels: ['paystack-active', 'paystack-practitioner', 'paystack-monthly'], note: 'Paystack KES monthly — ref lawyer_ref_verified_0001', expectedTierId: 'practitioner', expectedCadence: 'monthly', expectedAmountMinor: 95000 },
    { claimId: 'claim-b', memberSourceId: 'member-b', labels: ['paystack-active', 'paystack-chambers', 'paystack-annual'], note: 'Paystack KES annual — ref lawyer_ref_missing_00002', expectedTierId: 'chambers', expectedCadence: 'annual', expectedAmountMinor: 4800000 },
    { claimId: 'claim-c', memberSourceId: 'member-c', labels: ['paystack-active', 'paystack-practitioner', 'paystack-annual'], note: 'Paystack KES annual — ref lawyer_ref_mismatch_0003', expectedTierId: 'chambers', expectedCadence: 'annual', expectedAmountMinor: 4800000 },
    { claimId: 'claim-d', memberSourceId: 'member-d', labels: [], note: null, expectedTierId: 'practitioner', expectedCadence: 'monthly', expectedAmountMinor: 95000 },
  ],
  verifiedPaymentEvidence: [
    { evidenceId: 'verified-a', memberSourceId: 'member-a', merchantScope: SCOPE, metadata: metadata('member-a', 'practitioner', 95000, 'purchase-a'), transaction: transaction('lawyer_ref_verified_0001', 'provider-tx-a', 95000) },
    { evidenceId: 'verified-c', memberSourceId: 'member-c', merchantScope: SCOPE, metadata: metadata('member-c', 'chambers', 4800000, 'purchase-c'), transaction: transaction('lawyer_ref_mismatch_0003', 'provider-tx-c', 4800000) },
    { evidenceId: 'orphan-d', memberSourceId: 'member-d', merchantScope: SCOPE, metadata: metadata('member-d', 'practitioner', 95000, 'purchase-d'), transaction: transaction('lawyer_ref_orphan_000004', 'provider-tx-d', 95000) },
  ],
  commitments: {
    storage: { launchDiskGiB: 40, backupEstimateGiBMin: 2, backupEstimateGiBMax: 5, utilizationWatchPercent: 70, retention: '30 daily / 12 weekly / 12 monthly / 2 yearly' },
    traffic: { launchTopology: 'single-vps', launchVcpu: 2, launchMemoryGiB: 4, horizontalScaleReady: true, analyticsPolicy: 'anonymous-opt-in' },
    email: { legacyDeliveryPaths: ['resend', 'smtp', 'ghost-native'], destinationProvider: 'oci-email-delivery', workloads: ['member-reauthentication', 'transactional', 'newsletter', 'staff-notification'] },
    support: { annualMaintenanceKes: 5000, bestEffortResponseHours: 48, included: ['Security patches', 'Backup verification', 'Restore support'], excluded: ['New features', 'Design changes', 'Content migration changes'] },
  },
  evidence: [
    { evidenceId: 'routes', kind: 'route-manifest', sourceLocation: '.next/app-path-routes-manifest.json', sourceSha256: '1'.repeat(64) },
    { evidenceId: 'ghost', kind: 'ghost-export', sourceLocation: 'sanitized/fuma-076/ghost.json', sourceSha256: '2'.repeat(64) },
    { evidenceId: 'members', kind: 'member-export', sourceLocation: 'sanitized/fuma-076/members.json', sourceSha256: '3'.repeat(64) },
    { evidenceId: 'ops', kind: 'operations-document', sourceLocation: 'sanitized/fuma-076/operations.md', sourceSha256: '4'.repeat(64) },
    { evidenceId: 'payments', kind: 'provider-verification', sourceLocation: 'injected/fuma-058/verified-transactions', sourceSha256: '5'.repeat(64) },
  ],
}

export function createFUMA076LawyerSnapshot(): unknown {
  return structuredClone(fixture)
}

export const FUMA076_SCOPE = Object.freeze({ ...SCOPE, generation: 1, state: 'active' as const, transferFence: null, profileId: 'publication' })
export const FUMA076_PROOF = Object.freeze({
  realm: 'staff' as const,
  purpose: 'member-import' as const,
  staffUserId: 'staff-owner',
  staffSessionId: 'staff-session',
  scope: FUMA076_SCOPE,
  authenticatedAt: '2026-07-28T12:00:00Z',
  expiresAt: '2026-07-28T12:10:00Z',
  proofId: 'proof-fuma-076',
})
