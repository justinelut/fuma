const PORT = 3991
const TOKEN = 'projection-service-token-0000000001'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const reviewEvidence = {
  contentHashSha256: HASH_A, signatureKeyId: 'review-key-1',
  signaturePayloadHashSha256: HASH_B, provenanceHashSha256: HASH_C,
  licenseSpdx: 'MIT', accessibilityStandard: 'WCAG2.2-AA', minimumRuntimeVersion: '1.0.0',
}
const records = {
  experts: [{
    id: 'expert_nairobi_1', slug: 'amani-studio', publicName: 'Amani Studio',
    summary: 'An approved Nairobi studio focused on accessible editorial websites.', expertType: 'studio',
    location: 'Nairobi, Kenya', skills: ['accessible-design'], services: ['website-design'],
    showcaseIds: ['showcase_amani_1'], mediatedInquiryAvailable: true, imageUrl: null,
    approvedAt: '2026-07-27T11:00:00.000Z',
  }],
  showcases: [{
    id: 'showcase_amani_1', slug: 'amani-journal', title: 'Amani Journal',
    summary: 'An approved public editorial project.', profiles: ['publication'], industries: ['media'],
    previewUrl: 'https://example.invalid/work', imageUrl: '/social/fuma-social-v1.png',
    expertIds: ['expert_nairobi_1'], approvedAt: '2026-07-27T11:00:00.000Z',
  }],
  plugins: [{
    id: 'plugin_forms_1', slug: 'reviewed-forms', name: 'Reviewed Forms',
    summary: 'Reviewed form workflow metadata.', categories: ['forms'], publisherName: 'Fuma Labs',
    publisherVerified: true, version: '1.0.0', permissionLabels: ['Store submissions'], imageUrl: null,
    reviewEvidence, reviewedAt: '2026-07-27T12:00:00.000Z', artifactKind: 'plugin',
  }],
  components: [{
    id: 'component_hero_1', slug: 'reviewed-hero-pack', name: 'Reviewed Hero Pack',
    summary: 'Reviewed declarative component-pack metadata.', categories: ['layout'], publisherName: 'Fuma Labs',
    publisherVerified: true, version: '1.0.0', permissionLabels: [], imageUrl: null,
    reviewEvidence, reviewedAt: '2026-07-27T12:30:00.000Z', artifactKind: 'component-pack',
  }],
} as const
const facets = {
  experts: { expertTypes: ['studio'], skills: ['accessible-design'], locations: ['Nairobi, Kenya'] },
  showcases: { profiles: ['publication'], industries: ['media'] },
  plugins: { categories: ['forms'] },
  components: { categories: ['layout'] },
} as const

type Resource = keyof typeof records

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch(request) {
    const url = new URL(request.url)
    const resource = url.pathname.split('/').at(-1) as Resource
    if (request.method !== 'GET'
      || request.headers.get('authorization') !== `Bearer ${TOKEN}`
      || request.headers.get('x-fuma-audience') !== 'fuma-public-web'
      || !(resource in records)) {
      return Response.json({ error: { code: 'not_found', message: 'Resource not found.' } }, { status: 404, headers: { 'cache-control': 'no-store' } })
    }
    const slug = url.searchParams.get('slug')
    const items = slug ? records[resource].filter((item) => item.slug === slug) : records[resource]
    const etag = `"${resource}-fixture-v1"`
    return Response.json({
      data: { items, facets: facets[resource], page: { hasMore: false, nextCursor: null } },
      meta: { schemaVersion: 1, datasetVersion: `${resource}:sha256:${'d'.repeat(64)}`, etag },
    }, { headers: { 'cache-control': 'no-store', etag } })
  },
})

console.log(`FUMA-WEB-011 private projection fixture listening on ${PORT}`)
