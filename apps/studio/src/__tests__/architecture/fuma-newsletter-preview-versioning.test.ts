import { describe, expect, test } from 'bun:test'

const root = new URL('../../../', import.meta.url)
const read = async (path: string) => Bun.file(new URL(path, root)).text()

describe('FUMA-045 newsletter preview/versioning architecture', () => {
  test('keeps fixture and comparison contracts strict TypeBox-only', async () => {
    const contracts = await read('src/core/fuma/publication/emailCampaignContracts.ts')
    expect(contracts).toContain('NewsletterFixtureKindSchema = Type.Union')
    expect(contracts).toContain('NewsletterVersionComparisonSchema = Type.Object')
    expect(contracts).toContain('{ additionalProperties: false }')
    expect(contracts).not.toMatch(/from ['"]zod|z\.(?:object|string|array)/)
  })

  test('keeps fixtures server-owned and test sends bounded through OCI only', async () => {
    const policy = await read('server/fuma/publication/newsletterPreview.ts')
    const service = await read('server/fuma/publication/services.ts')
    expect(policy).toContain("'free-member'")
    expect(policy).toContain("'paid-member'")
    expect(policy).toContain('example.invalid')
    expect(policy).not.toContain('platform.ociPrivateKey')
    expect(service).toContain('new NewsletterTestSendLimiter()')
    expect(service).toContain("oci.kind !== 'oci-email-delivery'")
  })

  test('separates read, write, and send permissions and mounts accessible app-local controls', async () => {
    const routes = await read('server/fuma/publication/routes.ts')
    const workspace = await read('src/admin/fuma/publication/PublicationWorkspace.tsx')
    expect(routes).toContain("'/publication/newsletter-preview/:versionId', 'publication.newsletters.read'")
    expect(routes).toContain("'/publication/newsletter-versions', 'publication.newsletters.write'")
    expect(routes).toContain("'/publication/newsletter-test', 'publication.newsletters.send'")
    expect(workspace).toContain('Compare immutable versions')
    expect(workspace).toContain('Newsletter plaintext preview')
    expect(workspace).toContain('<Button')
    expect(workspace).not.toContain('<button')
  })
})
