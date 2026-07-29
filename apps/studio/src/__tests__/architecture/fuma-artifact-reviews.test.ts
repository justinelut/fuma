import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('FUMA-068 architecture boundaries', () => {
  test('mounts customer marketplace routes inside the one existing scoped API boundary', () => {
    const hosted = source('apps/studio/server/auth/hosted/runtime.ts')
    const server = source('apps/studio/server/index.ts')
    expect(hosted).toContain('marketplaceRoutes?: readonly FumaScopedRouteDeclaration[]')
    expect(hosted).toContain('...(input.marketplaceRoutes ?? [])')
    expect(server).toContain('createArtifactMarketplaceScopedRoutes(hostedArtifactReviewRuntime.service)')
    expect(server).toContain('marketplaceRoutes: artifactMarketplaceRoutes')
    expect(server.match(/createHostedFumaScopedApi\(/g)).toHaveLength(1)
  })

  test('derives all installation coordinates and generation from repository scope', () => {
    const routes = source('apps/studio/server/fuma/artifactReviews/routes.ts')
    for (const coordinate of ['platformId', 'organizationId', 'workspaceId', 'siteId', 'ownerKey']) expect(routes).toContain(`${coordinate}: input.repositoryScope.${coordinate}`)
    expect(routes).toContain('ownerGeneration: input.repositoryScope.generation')
    expect(routes).toContain("input.repositoryScope.state !== 'active'")
    expect(routes).toContain("'/marketplace/artifacts', 'plugins.read'")
    expect(routes).toContain("'/marketplace/artifacts/:artifactId/install', 'plugins.install'")
    expect(routes).not.toMatch(/command\.(?:platformId|organizationId|workspaceId|siteId|ownerKey|ownerGeneration)/)
  })

  test('keeps internal review metadata bounded and unmounted for FUMA-071', () => {
    const contribution = source('apps/studio/server/fuma/artifactReviews/consoleContribution.ts')
    expect(contribution).toContain("contributionId: 'artifact-review'")
    expect(contribution).toContain("ownerTicket: 'FUMA-068'")
    expect(contribution).toContain("requiredAuthorities: Object.freeze(['internal.plugins.review'])")
    expect(contribution).toContain('mounted: false')
    expect(source('apps/studio/server/index.ts')).not.toContain('artifactReviewConsoleContribution')
  })

  test('uses the unified v2 signed review source for public plugins and no legacy marketplace tables', () => {
    const projection = source('apps/studio/server/fuma/publicProjections/registeredAuthorities.ts')
    expect(projection).toContain('fuma_artifact_review_submissions_v2')
    expect(projection).toContain('fuma_artifact_review_decisions_v2')
    expect(projection).toContain('fuma_artifact_review_revocations_v2')
    expect(projection).not.toContain('fuma_plugin_artifacts')
    expect(projection).not.toContain('fuma_plugin_reviews')
  })

  test('keeps protected signing unavailable by default and the marketplace UI fail closed', () => {
    const runtime = source('apps/studio/server/fuma/artifactReviews/runtime.ts')
    const catalog = source('apps/control-surfaces/app/marketplace/catalog.tsx')
    expect(runtime).toContain('input.signer ?? new UnavailableArtifactReviewSigner()')
    expect(catalog).toContain("Review or signature authority is unavailable. Installation is disabled.")
    expect(catalog).toContain('artifact.permissions.every')
    expect(catalog).toContain("reviewState: Type.Literal('signed-current')")
    expect(catalog).not.toMatch(/from ['"](?:@?\/|\.\.\/).*studio/)
  })

  test('makes review evidence append-only and binds it to FUMA-067 releases', () => {
    const migration = source('apps/studio/server/fuma/db/migrations/000071_artifact_review_marketplace.ts')
    expect(migration).toContain('references fuma_artifact_releases_v2(artifact_id) on delete restrict')
    expect(migration.match(/execute function fuma_artifact_review_immutable_v2\(\)/g)?.length).toBe(5)
    expect(migration).toContain('Artifact submitter cannot review own release')
    expect(migration).toContain("decision='approved' and signature_key_id is not null")
    expect(migration).toContain('Rejected or missing scans cannot be approved')
  })
})
