import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../jobs'
import type { FumaScopedJobHandler, FumaScopedJobHandlerContext } from '../jobs/integration'
import { domainScopeFromRepository } from '../domains/contracts'
import { CloudflareBindingSchema } from './contracts'
import type { CloudflareSaasReconciler } from './reconciler'
import type { CloudflareDomainAuthority } from './routes'

export const CLOUDFLARE_RECONCILE_JOB_KIND = 'fuma.cloudflare-reconcile' as const
const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
export const CloudflareReconcileJobPayloadSchema = Type.Object({ domainId: IdSchema, reconcileId: IdSchema }, { additionalProperties: false })

function site(context: FumaScopedJobHandlerContext) {
  if (context.job.kind !== CLOUDFLARE_RECONCILE_JOB_KIND || context.jobContext.kind !== 'site' || context.repositoryScope === null) {
    throw new TypeError('Cloudflare reconciliation requires trusted site job authority.')
  }
  return Object.freeze({ scope: domainScopeFromRepository(context.repositoryScope, context.jobContext.profile.id), repositoryScope: context.repositoryScope })
}

/** Payload contains resource/retry identity only; all tenant/profile authority is server-derived. */
export function cloudflareJobRegistration(input: Readonly<{ reconciler: CloudflareSaasReconciler; domains: CloudflareDomainAuthority }>): Readonly<Record<typeof CLOUDFLARE_RECONCILE_JOB_KIND, FumaScopedJobHandler>> {
  const handler: FumaScopedJobHandler = async (context) => {
    const authority = site(context)
    const parsed = safeParseValue(CloudflareReconcileJobPayloadSchema, context.job.payload)
    if (!parsed.ok) throw new TypeError('Cloudflare reconcile payload is invalid.')
    const domain = await input.domains.exact(authority.scope, parsed.value.domainId)
    if (!domain) throw new TypeError('Cloudflare domain authority is unavailable.')
    const effectKey = `fuma.cloudflare-reconcile:v2:${parsed.value.domainId}:${parsed.value.reconcileId}`
    const prior = await context.readDurableResult(effectKey)
    if (prior) {
      const validated = safeParseValue(CloudflareBindingSchema, prior.result)
      if (!validated.ok || validated.value.domainId !== parsed.value.domainId
        || validated.value.platformId !== authority.repositoryScope.platformId
        || validated.value.organizationId !== authority.repositoryScope.organizationId
        || validated.value.workspaceId !== authority.repositoryScope.workspaceId
        || validated.value.siteId !== authority.repositoryScope.siteId
        || validated.value.ownerKey !== authority.repositoryScope.ownerKey
        || validated.value.generation !== authority.repositoryScope.generation) {
        throw new TypeError('Durable Cloudflare reconcile result has foreign authority.')
      }
      return validated.value as FumaJobJsonValue
    }
    const result = await input.reconciler.reconcile(authority.scope, domain)
    return (await context.commitDurableResult(effectKey, structuredClone(result) as FumaJobJsonValue)).result
  }
  return Object.freeze({ [CLOUDFLARE_RECONCILE_JOB_KIND]: handler })
}
