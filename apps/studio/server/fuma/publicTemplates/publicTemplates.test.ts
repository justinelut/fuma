import { describe, expect, test } from 'bun:test'
import { PublicHandoffRequestSchema, PublicTemplatesPageSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { createTemplatePreviewBoundary } from './previewBoundary'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../db/migrationPolicy'
import { publicTemplateReleasesMigration } from './migration'
import { ApprovedTemplatesProjectionSource } from './projection'
import {
  PublicTemplateCatalogService,
  TEMPLATE_PREVIEW_HOST,
  type PublicTemplateCatalogRepository,
  type TemplateReleaseInspector,
} from './service'
import type { ApprovableTemplateRelease, StoredPublicTemplateRelease, TemplateReleaseAuthority as TemplateReleaseCoordinates } from './contracts'

const HASH = 'a'.repeat(64)
const IMAGE_HASH = 'b'.repeat(64)
const RELEASE_ID = 'release_portfolio_7'
const RELEASE_AUTHORITY = Object.freeze({
  platformId: 'platform_fuma',
  ownerKey: 'owner_templates',
  organizationId: 'organization_fuma',
  workspaceId: 'workspace_templates',
  siteId: 'site_template_portfolio',
  releaseId: RELEASE_ID,
})
const APPROVED_AT = '2026-07-27T10:00:00.000Z'
const WITHDRAWN_AT = '2026-07-27T11:00:00.000Z'

class MemoryRepository implements PublicTemplateCatalogRepository {
  records = new Map<string, StoredPublicTemplateRelease>()
  async list() { return [...this.records.values()].map((value) => structuredClone(value)) }
  async get(id: string) { return structuredClone(this.records.get(id) ?? null) }
  async save(record: StoredPublicTemplateRelease, expectedVersion: number | null) {
    const current = this.records.get(record.template.id)
    if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) return false
    this.records.set(record.template.id, structuredClone(record))
    return true
  }
}

class MemoryReleases implements TemplateReleaseInspector {
  value: ApprovableTemplateRelease | null = {
    releaseId: RELEASE_ID,
    manifestHashSha256: HASH,
    status: 'ready',
    retained: true,
    artifacts: [
      { logicalPath: '/index.html', contentHashSha256: HASH, sizeBytes: 31, mimeType: 'text/html' },
      { logicalPath: '/assets/cover.webp', contentHashSha256: IMAGE_HASH, sizeBytes: 120_000, mimeType: 'image/webp' },
    ],
  }
  async inspect(authority: TemplateReleaseCoordinates) {
    return JSON.stringify(authority) === JSON.stringify(RELEASE_AUTHORITY) ? structuredClone(this.value) : null
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      id: 'template_portfolio',
      slug: 'editorial-portfolio',
      name: 'Editorial Portfolio',
      summary: 'A restrained portfolio with accessible navigation and publication-ready article layouts.',
      profiles: ['website', 'publication'],
      capabilities: ['blog', 'forms'],
      industries: ['creative-services'],
      styles: ['editorial', 'minimal'],
      accessibility: {
        standard: 'WCAG 2.2 AA',
        keyboardChecked: true,
        reducedMotionChecked: true,
        highContrastChecked: true,
        notes: ['Landmarks and heading order were reviewed.', 'Visible focus remains available at every breakpoint.'],
      },
      image: {
        url: `https://${TEMPLATE_PREVIEW_HOST}/releases/${RELEASE_ID}/assets/cover.webp`,
        alt: 'Editorial portfolio home page with project cards.',
        width: 1_600,
        height: 900,
        byteSize: 120_000,
        logicalPath: '/assets/cover.webp',
      },
    },
    releaseAuthority: RELEASE_AUTHORITY,
    expectedManifestHashSha256: HASH,
    expectedVersion: null,
    approvedAt: APPROVED_AT,
    ...overrides,
  }
}

function harness() {
  const repository = new MemoryRepository()
  const releases = new MemoryReleases()
  return { repository, releases, service: new PublicTemplateCatalogService(repository, releases) }
}

describe('public template release authority', () => {
  test('schema contribution is additive and checksum-stable for conductor registration', () => {
    expect(() => assertHostedMigrationIsAdditive(publicTemplateReleasesMigration)).not.toThrow()
    expect(hostedMigrationChecksum(publicTemplateReleasesMigration.sql)).toMatch(/^[a-f0-9]{64}$/)
    expect(publicTemplateReleasesMigration.sql).not.toMatch(/\b(?:drop|truncate|delete\s+from)\b/i)
  })
    expect(publicTemplateReleasesMigration.sql).toContain("tg_op = 'DELETE'")
    expect(publicTemplateReleasesMigration.sql).toContain('before update or delete')

  test('demo: approves one strict exact release and projects canonical metadata filters', async () => {
    const { service } = harness()
    const approved = await service.approve(command() as never)
    expect(approved.template.previewUrl).toBe(`https://${TEMPLATE_PREVIEW_HOST}/releases/${RELEASE_ID}/`)
    expect(approved.template.capabilities).toEqual(['blog', 'forms'])
    expect(approved.template.accessibility.standard).toBe('WCAG 2.2 AA')

    const source = new ApprovedTemplatesProjectionSource(service)
    const page = await source.readApprovedDisplayPage({ profile: 'publication', capability: 'blog', industry: 'creative-services', style: 'minimal' })
    expect(Value.Check(PublicTemplatesPageSchema, page.data)).toBe(true)
    expect(page.data.items.map((item) => item.id)).toEqual(['template_portfolio'])
    expect((await source.readApprovedDisplayPage({ capability: 'commerce' })).data.items).toEqual([])
  })

  test('rejects extra private metadata, oversized images, missing artifacts and stale releases', async () => {
    const first = harness()
    await expect(first.service.approve(command({ privateOwnerId: 'owner_private' }) as never)).rejects.toMatchObject({ code: 'invalid-contract' })

    const oversized = command() as ReturnType<typeof command>
    ;(oversized.metadata as Record<string, unknown>).image = {
      ...(oversized.metadata as { image: Record<string, unknown> }).image,
      byteSize: 300_001,
    }
    await expect(first.service.approve(oversized as never)).rejects.toMatchObject({ code: 'invalid-contract' })

    const missing = harness()
    missing.releases.value = { ...missing.releases.value!, artifacts: missing.releases.value!.artifacts.slice(0, 1) }
    await expect(missing.service.approve(command() as never)).rejects.toMatchObject({ code: 'release-unavailable' })

    const stale = harness()
    stale.releases.value = { ...stale.releases.value!, manifestHashSha256: 'c'.repeat(64) }
    await expect(stale.service.approve(command() as never)).rejects.toMatchObject({ code: 'release-stale' })

    const unretained = harness()
    unretained.releases.value = { ...unretained.releases.value!, retained: false as never }
    await expect(unretained.service.approve(command() as never)).rejects.toMatchObject({ code: 'invalid-contract' })
  })

  test('withdrawal removes discovery and sitemap material, emits a slug tombstone, and revokes preview/install', async () => {
    const { service } = harness()
    await service.approve(command() as never)
    expect((await service.versionMaterial()).items).toHaveLength(1)
    await service.withdraw({ templateId: 'template_portfolio', expectedVersion: 1, withdrawnAt: WITHDRAWN_AT })
    expect((await service.discover()).items).toEqual([])
    expect((await service.versionMaterial()).items).toEqual([])
    expect((await service.discover({ slug: 'editorial-portfolio' })).tombstones).toEqual([{ id: 'template_portfolio', slug: 'editorial-portfolio', withdrawnAt: WITHDRAWN_AT }])
    await expect(service.authorizePreview(RELEASE_ID)).rejects.toMatchObject({ code: 'withdrawn' })
    await expect(service.resolveInstallIntent('template_portfolio')).rejects.toMatchObject({ code: 'withdrawn' })
  })

  test('product install handoff accepts only a stable ID and revalidates release staleness without returning bytes', async () => {
    const { service, releases } = harness()
    await service.approve(command() as never)
    expect(Value.Check(PublicHandoffRequestSchema, { kind: 'use_template', source: 'template', templateId: 'template_portfolio' })).toBe(true)
    expect(Value.Check(PublicHandoffRequestSchema, { kind: 'use_template', source: 'template', templateId: 'template_portfolio', releaseId: 'forged' })).toBe(false)
    const resolution = await service.resolveInstallIntent('template_portfolio')
    expect(resolution).toEqual({ templateId: 'template_portfolio', releaseAuthority: RELEASE_AUTHORITY, manifestHashSha256: HASH, profiles: ['website', 'publication'], authorityVersion: 1 })
    expect(JSON.stringify(resolution)).not.toContain('artifact')
    releases.value = { ...releases.value!, manifestHashSha256: 'd'.repeat(64) }
    expect((await service.discover()).items).toEqual([])
    expect((await service.versionMaterial()).items).toEqual([])
    await expect(service.resolveInstallIntent('template_portfolio')).rejects.toMatchObject({ code: 'release-stale' })
  })

  test('isolated preview host serves only approved exact paths with no credentials and fails closed after withdrawal', async () => {
    const { service } = harness()
    await service.approve(command() as never)
    const reader = {
      readExact: async (authority: TemplateReleaseCoordinates, path: string) => JSON.stringify(authority) === JSON.stringify(RELEASE_AUTHORITY) && path === '/'
        ? { bytes: new TextEncoder().encode('<main>Exact preview</main>'), hashSha256: HASH, mimeType: 'text/html' }
        : null,
    }
    const boundary = createTemplatePreviewBoundary({ host: TEMPLATE_PREVIEW_HOST, catalog: service, reader })
    const request = (path: string, headers: HeadersInit = {}) => new Request(`https://${TEMPLATE_PREVIEW_HOST}${path}`, { headers: { host: TEMPLATE_PREVIEW_HOST, ...headers } })
    const ok = await boundary.handle(request(`/releases/${RELEASE_ID}/`))
    expect(ok?.status).toBe(200)
    expect(ok?.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(ok?.headers.get('cache-control')).toBe('private, no-store')
    expect(await ok?.text()).toContain('Exact preview')
    expect(await boundary.handle(request(`/releases/${RELEASE_ID}/?draft=1`))).toHaveProperty('status', 404)
    expect(await boundary.handle(request(`/releases/${RELEASE_ID}/`, { authorization: 'Bearer forbidden' }))).toHaveProperty('status', 404)
    expect(boundary.handles(new Request(`https://trimly.co.ke/releases/${RELEASE_ID}/`, { headers: { host: 'trimly.co.ke' } }))).toBe(false)
    await service.withdraw({ templateId: 'template_portfolio', expectedVersion: 1, withdrawnAt: WITHDRAWN_AT })
    expect(await boundary.handle(request(`/releases/${RELEASE_ID}/`))).toHaveProperty('status', 404)
  })
})
