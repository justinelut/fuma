import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('FUMA-WEB-010 public template architecture', () => {
  test('registers finalized additive migration and immutable tombstones', () => {
    const index = read('server/fuma/db/migrations/index.ts')
    const migration = read('server/fuma/db/migrations/000056_public_template_releases.ts')
    expect(index).toContain("'000056_public_template_releases': 'ca89eeadaf781bd806217a5b74d58849c851372a8c838806d4953641c259789e'")
    expect(migration).toContain("id: '000056_public_template_releases'")
    expect(migration).toContain("tg_op = 'DELETE'")
    expect(migration).toContain('before update or delete')
  })

  test('replaces fail-empty projection with exact PostgreSQL release authority', () => {
    const authority = read('server/fuma/publicProjections/registeredAuthorities.ts')
    expect(authority).toContain('PostgresPublicTemplateCatalogRepository')
    expect(authority).toContain('PostgresTemplateReleaseAuthority')
    expect(authority).toContain('ApprovedTemplatesProjectionSource')
    expect(authority).not.toContain('class TemplatesSource')
  })

  test('mounts credential-free exact preview host over shared immutable storage', () => {
    const server = read('server/index.ts')
    const storage = read('server/fuma/freeHosts/runtime.ts')
    expect(server).toContain('createTemplatePreviewBoundary')
    expect(server).toContain('PostgresTemplatePreviewReader')
    expect(server.indexOf('templatePreviewBoundary?.handles(req)')).toBeLessThan(server.indexOf('freeHostRuntime.boundary.route(req)'))
    for (const mime of ['image/avif', 'image/jpeg', 'image/png', 'image/webp']) expect(storage).toContain(mime)
  })

  test('uses exact eligibility for public discovery sitemap rows', () => {
    const sitemap = read('../web/app/sitemap.ts')
    expect(sitemap).toContain('templateSitemapRows')
    expect(sitemap).not.toContain('isImmutableTemplatePreview(v.previewUrl)')
  })
})
