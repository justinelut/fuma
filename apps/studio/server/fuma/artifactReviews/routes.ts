import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { ArtifactInstallationSchema } from '../artifacts'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  ArtifactReviewError,
  MarketplaceArtifactSchema,
} from './contracts'
import type { ArtifactReviewService } from './service'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Permission = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9.:-]+$' })
const ListSchema = Type.Object({ artifacts: Type.Array(MarketplaceArtifactSchema, { maxItems: 100 }) }, { additionalProperties: false })
const InstallRequestSchema = Type.Object({
  submissionId: Id,
  installationId: Id,
  grantedPermissions: Type.Array(Permission, { maxItems: 128, uniqueItems: true }),
}, { additionalProperties: false })
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })

function response<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Marketplace route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  if (!(error instanceof ArtifactReviewError)) return response(ErrorSchema, { error: 'Artifact marketplace is temporarily unavailable.' }, 503)
  const status = error.code === 'not-found' ? 404 : error.code === 'invalid-contract' ? 400 : error.code === 'revoked' || error.code === 'signature-denied' || error.code === 'decision-denied' || error.code === 'permission-escalation' ? 403 : 409
  return response(ErrorSchema, { error: error.message }, status)
}
function assertScope(input: FumaScopedRouteHandlerInput): void {
  if (input.repositoryScope.state !== 'active' || input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null
    || input.context.profile.id !== input.context.scope.site.profileId) throw new ArtifactReviewError('decision-denied', 'Direct active staff site authority is required.')
}
async function body(input: FumaScopedRouteHandlerInput) {
  const raw = await input.request.json().catch(() => null)
  const parsed = safeParseValue(InstallRequestSchema, raw)
  if (!parsed.ok) throw new ArtifactReviewError('invalid-contract', 'Marketplace install request is invalid.')
  return parsed.value
}

export function createArtifactMarketplaceScopedRoutes(service: ArtifactReviewService, now: () => Date = () => new Date()): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => { try { return await handler(input) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/marketplace/artifacts', 'plugins.read', async (input) => {
      assertScope(input)
      return response(ListSchema, { artifacts: await service.marketplace() })
    }),
    route('POST', '/marketplace/artifacts/:artifactId/install', 'plugins.install', async (input) => {
      assertScope(input)
      const command = await body(input)
      const approved = await service.verify(command.submissionId)
      const artifact = approved.submission.artifact
      if (artifact.artifactId !== input.params.artifactId) throw new ArtifactReviewError('artifact-mutated', 'Marketplace path does not identify the approved release.')
      const at = now().toISOString()
      const installation = {
        platformId: input.repositoryScope.platformId,
        organizationId: input.repositoryScope.organizationId,
        workspaceId: input.repositoryScope.workspaceId,
        siteId: input.repositoryScope.siteId,
        ownerKey: input.repositoryScope.ownerKey,
        ownerGeneration: input.repositoryScope.generation,
        installationId: command.installationId,
        artifactId: artifact.artifactId,
        artifactKind: artifact.kind,
        packageId: artifact.packageId,
        exactVersion: artifact.exactVersion,
        contentHashSha256: artifact.contentHashSha256,
        executionPolicy: artifact.executionPolicy,
        settingsObjectKey: null,
        secret: null,
        state: 'active',
        workerGeneration: artifact.kind === 'plugin' ? 1 : null,
        quota: artifact.kind === 'plugin'
          ? { storageBytes: 104_857_600, scheduledJobs: 100, callsPerMinute: 60 }
          : { storageBytes: 10_485_760, scheduledJobs: 0, callsPerMinute: 60 },
        previousArtifactId: null,
        version: 1,
        installedAt: at,
        updatedAt: at,
      }
      return response(ArtifactInstallationSchema, await service.install({ submissionId: command.submissionId, installation, grantedPermissions: command.grantedPermissions }), 201)
    }),
  ])
}
