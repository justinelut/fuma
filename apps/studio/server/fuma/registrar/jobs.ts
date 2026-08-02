import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { domainScopeFromRepository } from '../domains/contracts'
import type { FumaJobJsonValue } from '../jobs'
import type { FumaScopedJobHandler, FumaScopedJobHandlerContext } from '../jobs/integration'
import type { RegistrarWorkflow } from './workflow'

export const REGISTRAR_PURCHASE_JOB_KIND = 'fuma.registrar-purchase' as const
export const REGISTRAR_RENEW_JOB_KIND = 'fuma.registrar-renew' as const
export type RegistrarJobKind = typeof REGISTRAR_PURCHASE_JOB_KIND | typeof REGISTRAR_RENEW_JOB_KIND
export const RegistrarJobPayloadSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  operationId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
}, { additionalProperties: false })

function trustedScope(context: FumaScopedJobHandlerContext) {
  if (context.jobContext.kind !== 'site' || context.repositoryScope === null) throw new TypeError('Registrar jobs require trusted exact-site authority.')
  return domainScopeFromRepository(context.repositoryScope, context.jobContext.scope.site.profileId)
}
async function reconcile(context: FumaScopedJobHandlerContext, workflow: RegistrarWorkflow, expected: 'purchase' | 'renew'): Promise<FumaJobJsonValue> {
  const parsed = safeParseValue(RegistrarJobPayloadSchema, context.job.payload)
  if (!parsed.ok) throw new TypeError('Registrar job payload is invalid.')
  const scope = trustedScope(context)
  const effectKey = `fuma.registrar-${expected}:v1:${parsed.value.operationId}`
  const prior = await context.readDurableResult(effectKey)
  if (prior) return prior.result
  const receipt = await workflow.reconcile(scope, parsed.value.operationId)
  if ((expected === 'purchase') !== ('operationId' in receipt)) throw new TypeError('Registrar job kind does not match durable operation receipt.')
  return (await context.commitDurableResult(effectKey, structuredClone(receipt) as FumaJobJsonValue)).result
}

/** Registration seam only. The conductor owns insertion into the global worker registry. */
export function registrarJobRegistration(workflow: RegistrarWorkflow): Readonly<Record<RegistrarJobKind, FumaScopedJobHandler>> {
  return Object.freeze({
    [REGISTRAR_PURCHASE_JOB_KIND]: async (context) => await reconcile(context, workflow, 'purchase'),
    [REGISTRAR_RENEW_JOB_KIND]: async (context) => await reconcile(context, workflow, 'renew'),
  })
}
