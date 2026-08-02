import { describe, expect, test } from 'bun:test'
import {
  PublicComponentsEnvelopeSchema,
  PublicExpertsEnvelopeSchema,
  PublicPluginsEnvelopeSchema,
  PublicShowcasesEnvelopeSchema,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  fetchPublicProjection,
  handlePublicProjectionBff,
  type PublicProjectionClientConfig,
} from '../lib/public-projections'

const config: PublicProjectionClientConfig = Object.freeze({
  internalOrigin: 'http://studio-internal.service:3001',
  serviceToken: 'projection-service-token-0000000001',
  publicHosts: Object.freeze(['3002.blyss.co.ke']),
  timeoutMs: 500,
})
const reviewEvidence = Object.freeze({
  contentHashSha256: 'a'.repeat(64), signatureKeyId: 'review-key-1',
  signaturePayloadHashSha256: 'b'.repeat(64), provenanceHashSha256: 'c'.repeat(64),
  licenseSpdx: 'MIT', accessibilityStandard: 'WCAG2.2-AA', minimumRuntimeVersion: '1.0.0',
})

const items = Object.freeze({
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
})

const facets = Object.freeze({
  experts: { expertTypes: ['studio'], skills: ['accessible-design'], locations: ['Nairobi, Kenya'] },
  showcases: { profiles: ['publication'], industries: ['media'] },
  plugins: { categories: ['forms'] },
  components: { categories: ['layout'] },
})

type Resource = keyof typeof items

function envelope(resource: Resource, selected = items[resource]) {
  return {
    data: { items: structuredClone(selected), facets: structuredClone(facets[resource]), page: { hasMore: false, nextCursor: null } },
    meta: { schemaVersion: 1, datasetVersion: `${resource}:sha256:${'d'.repeat(64)}`, etag: `"${resource}-v1"` },
  }
}

function upstream(resource: Resource, selected = items[resource]): Response {
  const value = envelope(resource, selected)
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', etag: value.meta.etag, 'set-cookie': 'forbidden=1' },
  })
}

describe('FUMA-WEB-011 public discovery integration', () => {
  test('accepts only strict PII-free expert, showcase, plugin and component-pack envelopes', () => {
    const schemas = {
      experts: PublicExpertsEnvelopeSchema,
      showcases: PublicShowcasesEnvelopeSchema,
      plugins: PublicPluginsEnvelopeSchema,
      components: PublicComponentsEnvelopeSchema,
    } as const
    for (const resource of Object.keys(schemas) as Resource[]) {
      const value = envelope(resource)
      expect(Value.Check(schemas[resource], value)).toBe(true)
      const first = value.data.items[0] as Record<string, unknown>
      for (const leaked of [
        { email: 'member@example.test' }, { recipient: 'private' }, { organizationId: 'org-private' },
        { workspaceId: 'workspace-private' }, { siteId: 'site-private' }, { ownerKey: 'owner-private' },
        { memberId: 'member-private' }, { paymentState: 'paid' }, { transferId: 'transfer-private' },
        { internalId: 'row-private' },
      ]) {
        expect(Value.Check(schemas[resource], {
          ...value,
          data: { ...value.data, items: [{ ...first, ...leaked }] },
        })).toBe(false)
      }
    }
  })

  test('serves every moderation-sensitive dataset no-store and strips upstream credentials/cookies', async () => {
    for (const resource of Object.keys(items) as Resource[]) {
      const response = await fetchPublicProjection(resource, new URLSearchParams(), null, {
        config,
        fetchImpl: async () => upstream(resource),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('x-fuma-dataset-version')).toStartWith(`${resource}:sha256:`)
    }
  })

  test('uses exact authority-filtered slug reads and never forwards visitor authority', async () => {
    let captured: Request | null = null
    const response = await handlePublicProjectionBff(new Request(
      'https://3002.blyss.co.ke/api/public/v1/components?slug=reviewed-hero-pack&limit=1',
      { headers: { cookie: 'member=private', authorization: 'Bearer visitor-private' } },
    ), {
      config,
      fetchImpl: async (input, init) => {
        captured = new Request(input, init)
        return upstream('components')
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(captured?.url).toBe('http://studio-internal.service:3001/_fuma/private/public/v1/components?limit=1&slug=reviewed-hero-pack')
    expect(captured?.headers.get('authorization')).toBe(`Bearer ${config.serviceToken}`)
    expect(captured?.headers.get('cookie')).toBeNull()
  })

  test('turns removed or malformed records into empty/tombstoned reads without stale fallback', async () => {
    for (const resource of Object.keys(items) as Resource[]) {
      const empty = await fetchPublicProjection(resource, new URLSearchParams({ slug: items[resource][0]!.slug, limit: '1' }), null, {
        config,
        fetchImpl: async () => upstream(resource, []),
      })
      expect(empty.status).toBe(200)
      expect(empty.headers.get('cache-control')).toBe('no-store')
      expect((await empty.json()).data.items).toEqual([])

      const leaked = envelope(resource)
      ;(leaked.data.items[0] as Record<string, unknown>).recipientEmail = 'private@example.test'
      const rejected = await fetchPublicProjection(resource, new URLSearchParams(), null, {
        config,
        fetchImpl: async () => new Response(JSON.stringify(leaked), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: leaked.meta.etag },
        }),
      })
      expect(rejected.status).toBe(503)
      expect(await rejected.text()).not.toContain('private@example.test')
    }
  })

  test('keeps detail routes dynamic, exact-slug, noindex-on-absence, and free of Studio/private authority imports', () => {
    const root = path.join(import.meta.dir, '..')
    const routePairs = [
      ['experts', 'experts'], ['showcase', 'showcases'], ['plugins', 'plugins'], ['components', 'components'],
    ] as const
    for (const [directory, resource] of routePairs) {
      const list = readFileSync(path.join(root, 'app', directory, 'page.tsx'), 'utf8')
      const detail = readFileSync(path.join(root, 'app', directory, '[slug]', 'page.tsx'), 'utf8')
      expect(list).toContain("export const dynamic = 'force-dynamic'")
      expect(detail).toContain("export const dynamic = 'force-dynamic'")
      expect(detail).toContain(`readPublicItem('${resource}', slug)`)
      expect(detail).toContain('notFound()')
      expect(detail).toMatch(/publicMetadata\([\s\S]*!item/)
      expect(`${list}\n${detail}`).not.toMatch(/apps\/studio|server\/fuma|zod|recipientEmail|organizationId|workspaceId|ownerKey|memberId/)
    }
    const plugin = readFileSync(path.join(root, 'app/plugins/page.tsx'), 'utf8')
    const component = readFileSync(path.join(root, 'app/components/page.tsx'), 'utf8')
    expect(plugin).toContain("readPublicData('plugins'")
    expect(component).toContain("readPublicData('components'")
    expect(plugin).toContain('Backend extensions')
    expect(component).toContain('client-side presentation')
  })
})
