import type { ComposedProductProfile, JobContribution } from '@core/fuma'

import {
  OBJECT_COPY_TRANSFER_STEP_ID,
  OBJECT_COPY_TRANSFER_STEP_ORDER,
} from './objectCopyStep'
import {
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
} from './objectOwnershipPolicyStep'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  createTransferStepRegistry,
  type TransferStepDefinition,
  type TransferStepRegistry,
} from './stepRegistry'
import type { FumaJobHandler } from '../jobs'
import {
  TRANSFER_COMPENSATE_JOB_KIND,
  TRANSFER_EXECUTE_JOB_KIND,
  TRANSFER_RESUME_JOB_KIND,
  TRANSFER_SAGA_JOB_KINDS,
  type TransferSagaJobKind,
} from './jobs'
import { TRANSFER_CONTROL_PERMISSION } from './service'

export const TRANSFER_SAGA_JOB_CONTRIBUTION_IDS = Object.freeze({
  [TRANSFER_EXECUTE_JOB_KIND]: 'job.transfer-execute',
  [TRANSFER_RESUME_JOB_KIND]: 'job.transfer-resume',
  [TRANSFER_COMPENSATE_JOB_KIND]: 'job.transfer-compensate',
} as const)

export type TransferSagaJobRegistrationDescriptor = Readonly<{
  contributionId: string
  kind: TransferSagaJobKind
  permission: typeof TRANSFER_CONTROL_PERMISSION
  handler: FumaJobHandler
}>

export class TransferSagaRegistrationError extends Error {
  readonly path: string

  constructor(message: string, path: string) {
    super(message)
    this.name = 'TransferSagaRegistrationError'
    this.path = path
  }
}

function transferContribution(
  jobs: readonly JobContribution[],
  kind: TransferSagaJobKind,
): JobContribution {
  const expectedId = TRANSFER_SAGA_JOB_CONTRIBUTION_IDS[kind]
  const matches = jobs.filter(({ handlerId }) => handlerId === kind)
  if (matches.length !== 1) {
    throw new TransferSagaRegistrationError(
      `Composed capability jobs must resolve exactly one ${kind} handler.`,
      `composition.jobs.${kind}`,
    )
  }
  const contribution = matches[0]
  if (contribution.id !== expectedId
    || contribution.permission !== TRANSFER_CONTROL_PERMISSION) {
    throw new TransferSagaRegistrationError(
      `${kind} must use its stable contribution ID and site transfer permission.`,
      `composition.jobs.${kind}`,
    )
  }
  return contribution
}

/** Resolves worker registrations only from composed capability contributions. */
export function composeTransferSagaJobRegistrations(
  composition: Pick<ComposedProductProfile, 'jobs'>,
  handlers: Readonly<Record<TransferSagaJobKind, FumaJobHandler>>,
): readonly TransferSagaJobRegistrationDescriptor[] {
  const descriptors = TRANSFER_SAGA_JOB_KINDS.map((kind) => {
    const contribution = transferContribution(composition.jobs, kind)
    const handler = handlers[kind]
    if (typeof handler !== 'function') {
      throw new TransferSagaRegistrationError(
        `No runtime handler was supplied for ${kind}.`,
        `handlers.${kind}`,
      )
    }
    return Object.freeze({
      contributionId: contribution.id,
      kind,
      permission: TRANSFER_CONTROL_PERMISSION,
      handler,
    })
  })
  return Object.freeze(descriptors)
}

/** Converts approved descriptors to the neutral FUMA-009 worker handler map. */
export function transferSagaJobHandlerMap(
  descriptors: readonly TransferSagaJobRegistrationDescriptor[],
): Readonly<Record<TransferSagaJobKind, FumaJobHandler>> {
  const byKind = new Map<TransferSagaJobKind, FumaJobHandler>()
  for (const descriptor of descriptors) {
    if (byKind.has(descriptor.kind)) {
      throw new TransferSagaRegistrationError(
        `Transfer job kind ${descriptor.kind} is registered more than once.`,
        `descriptors.${descriptor.kind}`,
      )
    }
    byKind.set(descriptor.kind, descriptor.handler)
  }
  for (const kind of TRANSFER_SAGA_JOB_KINDS) {
    if (!byKind.has(kind)) {
      throw new TransferSagaRegistrationError(
        `Transfer job kind ${kind} is not registered.`,
        `descriptors.${kind}`,
      )
    }
  }
  return Object.freeze({
    [TRANSFER_EXECUTE_JOB_KIND]: byKind.get(TRANSFER_EXECUTE_JOB_KIND)!,
    [TRANSFER_RESUME_JOB_KIND]: byKind.get(TRANSFER_RESUME_JOB_KIND)!,
    [TRANSFER_COMPENSATE_JOB_KIND]: byKind.get(TRANSFER_COMPENSATE_JOB_KIND)!,
  })
}

/**
 * Builds the unmounted saga registry only when the all-profile object lane is
 * complete. Capability contributions may add domain steps, but cannot select,
 * omit, rename, or reorder these mandatory definitions.
 */
export function createRegisteredTransferStepRegistry(
  definitions: readonly TransferStepDefinition[],
): TransferStepRegistry {
  const registry = createTransferStepRegistry(definitions)
  const base = registry.get(BASE_OWNERSHIP_TRANSFER_STEP_ID)
  const copy = registry.get(OBJECT_COPY_TRANSFER_STEP_ID)
  const policy = registry.get(OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID)
  if (!base || base.mandatory !== true) {
    throw new TransferSagaRegistrationError(
      'Transfer registry requires mandatory base ownership.',
      `definitions.${BASE_OWNERSHIP_TRANSFER_STEP_ID}`,
    )
  }
  if (!copy
    || copy.mandatory !== true
    || copy.order !== OBJECT_COPY_TRANSFER_STEP_ORDER
    || copy.dependsOn.length !== 1
    || copy.dependsOn[0] !== BASE_OWNERSHIP_TRANSFER_STEP_ID) {
    throw new TransferSagaRegistrationError(
      'Transfer registry requires the stable mandatory tenant-object copy definition.',
      `definitions.${OBJECT_COPY_TRANSFER_STEP_ID}`,
    )
  }
  if (!policy
    || policy.mandatory !== true
    || policy.order !== OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER
    || policy.dependsOn.length !== 1
    || policy.dependsOn[0] !== OBJECT_COPY_TRANSFER_STEP_ID) {
    throw new TransferSagaRegistrationError(
      'Transfer registry requires the final mandatory policy definition after verified copy.',
      `definitions.${OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID}`,
    )
  }
  return registry
}
