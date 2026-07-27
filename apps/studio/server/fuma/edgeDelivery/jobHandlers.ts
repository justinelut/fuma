import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../jobs'
import type { FumaScopedJobHandler, FumaScopedJobHandlerContext } from '../jobs/integration'
import type { FumaRepositoryScope } from '../tenancy'
import type { EdgeDeliveryService, EdgeRequestContext } from './service'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const PathSchema = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/[A-Za-z0-9._/-]*$' })
const EdgePurgePayloadSchema = Type.Object({
  releaseId: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false })
const EdgeWarmPayloadSchema = Type.Object({
  releaseId: IdSchema,
  paths: Type.Array(PathSchema, { minItems: 1, maxItems: 100, uniqueItems: true }),
}, { additionalProperties: false })
const EdgeRollbackPayloadSchema = Type.Object({
  currentReleaseId: IdSchema,
  targetReleaseId: IdSchema,
  warmPaths: Type.Array(PathSchema, { maxItems: 100, uniqueItems: true }),
}, { additionalProperties: false })

export const EDGE_PURGE_JOB_KIND = 'fuma.edge-purge' as const
export const EDGE_WARM_JOB_KIND = 'fuma.edge-warm' as const
export const EDGE_ROLLBACK_JOB_KIND = 'fuma.edge-rollback' as const
export type EdgeJobKind = typeof EDGE_PURGE_JOB_KIND | typeof EDGE_WARM_JOB_KIND | typeof EDGE_ROLLBACK_JOB_KIND
export type EdgePurgePayload = Static<typeof EdgePurgePayloadSchema>
export type EdgeWarmPayload = Static<typeof EdgeWarmPayloadSchema>
export type EdgeRollbackPayload = Static<typeof EdgeRollbackPayloadSchema>

export interface EdgeHostAuthority {
  exact(scope: FumaRepositoryScope): Promise<string>
}

function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const result = safeParseValue(schema, value)
  if (!result.ok) throw new TypeError('Edge job payload is invalid.')
  return result.value
}
function publicFingerprint(): string { return new Bun.CryptoHasher('sha256').update('fuma-edge-public-v1').digest('hex') }
function edgeContext(scope: FumaRepositoryScope, host: string, releaseId: string, path: string): EdgeRequestContext {
  return Object.freeze({
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    ownerGeneration: scope.generation,
    host,
    releaseId,
    path,
    memberId: null,
    accessFingerprint: publicFingerprint(),
    requestClaims: Object.freeze({ audience: 'anonymous' }),
  })
}
function siteContext(context: FumaScopedJobHandlerContext): FumaRepositoryScope {
  if (context.jobContext.kind !== 'site' || context.repositoryScope === null) throw new TypeError('Edge jobs require trusted site authority.')
  return context.repositoryScope
}
async function once(
  context: FumaScopedJobHandlerContext,
  effectKey: string,
  operation: () => Promise<FumaJobJsonValue>,
): Promise<FumaJobJsonValue> {
  const prior = await context.readDurableResult(effectKey)
  if (prior) return prior.result
  const result = await operation()
  return (await context.commitDurableResult(effectKey, result)).result
}

/** Complete-ticket job registration; payloads contain no tenant authority or host. */
export function edgeDeliveryJobRegistration(input: Readonly<{
  service: EdgeDeliveryService
  hosts: EdgeHostAuthority
}>): Readonly<Record<EdgeJobKind, FumaScopedJobHandler>> {
  const purge: FumaScopedJobHandler = async (context) => {
    const scope = siteContext(context)
    const payload = parse(EdgePurgePayloadSchema, context.job.payload)
    const host = await input.hosts.exact(scope)
    return await once(context, `fuma.edge-purge:v1:${payload.releaseId ?? 'site'}`, async () => ({
      purged: await input.service.purge(host, scope.siteId, payload.releaseId ?? undefined),
      releaseId: payload.releaseId,
    }))
  }
  const warm: FumaScopedJobHandler = async (context) => {
    const scope = siteContext(context)
    const payload = parse(EdgeWarmPayloadSchema, context.job.payload)
    const host = await input.hosts.exact(scope)
    return await once(context, `fuma.edge-warm:v1:${payload.releaseId}:${digestPaths(payload.paths)}`, async () => ({
      etags: [...await input.service.warm(payload.paths.map((path) => edgeContext(scope, host, payload.releaseId, path)))],
      releaseId: payload.releaseId,
    }))
  }
  const rollback: FumaScopedJobHandler = async (context) => {
    const scope = siteContext(context)
    const payload = parse(EdgeRollbackPayloadSchema, context.job.payload)
    if (payload.currentReleaseId === payload.targetReleaseId) throw new TypeError('Rollback target must differ from current release.')
    const host = await input.hosts.exact(scope)
    return await once(context, `fuma.edge-rollback:v1:${payload.currentReleaseId}:${payload.targetReleaseId}`, async () => {
      await input.service.rollback({ context: edgeContext(scope, host, payload.currentReleaseId, '/'), targetReleaseId: payload.targetReleaseId })
      const etags = payload.warmPaths.length === 0
        ? []
        : await input.service.warm(payload.warmPaths.map((path) => edgeContext(scope, host, payload.targetReleaseId, path)))
      return { currentReleaseId: payload.currentReleaseId, targetReleaseId: payload.targetReleaseId, etags: [...etags] }
    })
  }
  return Object.freeze({ [EDGE_PURGE_JOB_KIND]: purge, [EDGE_WARM_JOB_KIND]: warm, [EDGE_ROLLBACK_JOB_KIND]: rollback })
}

function digestPaths(paths: readonly string[]): string {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify([...paths].toSorted())).digest('hex')
}
