import { describe, expect, it } from 'bun:test'
import {
  LAUNCH_CAPABILITIES,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityDefinition,
} from '@core/fuma'
import type { FumaJobHandler } from '../../../server/fuma/jobs'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
  OBJECT_COPY_TRANSFER_STEP_ID,
  OBJECT_COPY_TRANSFER_STEP_ORDER,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
  TRANSFER_COMPENSATE_JOB_KIND,
  TRANSFER_CONTROL_PERMISSION,
  TRANSFER_EXECUTE_JOB_KIND,
  TRANSFER_RESUME_JOB_KIND,
  TransferSagaRegistrationError,
  composeTransferSagaJobRegistrations,
  createRegisteredTransferStepRegistry,
  transferSagaJobHandlerMap,
  type TransferSagaJobKind,
  type TransferStepDefinition,
} from '../../../server/fuma/transfers'

const handler: FumaJobHandler = () => Promise.resolve({ accepted: true })
const HANDLERS: Readonly<Record<TransferSagaJobKind, FumaJobHandler>> = {
  [TRANSFER_EXECUTE_JOB_KIND]: handler,
  [TRANSFER_RESUME_JOB_KIND]: handler,
  [TRANSFER_COMPENSATE_JOB_KIND]: handler,
}

function siteSettingsCapability(): CapabilityDefinition {
  const capability = LAUNCH_CAPABILITIES.find(({ id }) => id === 'site.settings')
  if (!capability) throw new Error('site.settings capability fixture is missing')
  return structuredClone(capability)
}

function step(
  id: string,
  order: number,
  dependsOn: readonly string[],
  mandatory = false,
): TransferStepDefinition {
  return {
    id,
    order,
    dependsOn,
    mandatory,
    async apply() { return { code: `${id}.applied`, details: {} } },
    async verify() { return { status: 'not-applied', receipt: null } },
    async compensate() { return { status: 'not-applied', receipt: null } },
  }
}

function registeredDefinitions(
  contributedStepIds: readonly string[] = [],
): readonly TransferStepDefinition[] {
  return [
    step(
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
      BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
      [],
      true,
    ),
    step(
      OBJECT_COPY_TRANSFER_STEP_ID,
      OBJECT_COPY_TRANSFER_STEP_ORDER,
      [BASE_OWNERSHIP_TRANSFER_STEP_ID],
      true,
    ),
    ...[...new Set(contributedStepIds)].map((id, index) => step(
      id,
      100 + index,
      [BASE_OWNERSHIP_TRANSFER_STEP_ID],
    )),
    step(
      OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
      OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
      [OBJECT_COPY_TRANSFER_STEP_ID],
      true,
    ),
  ]
}

describe('FUMA-024 transfer capability and job registration composition', () => {
  it('composes mandatory copy/policy and all job descriptors for both launch profiles', () => {
    for (const profileId of ['website', 'publication'] as const) {
      const composition = fumaLaunchRegistry.compose(profileId)
      const registry = createRegisteredTransferStepRegistry(registeredDefinitions(
        composition.transfer.map(({ stepId }) => stepId),
      ))
      const steps = registry.compose(composition.transfer)
      const registrations = composeTransferSagaJobRegistrations(composition, HANDLERS)

      expect(steps.filter(({ mandatory }) => mandatory).map(({ id, contribution }) => ({
        id,
        contribution,
      }))).toEqual([
        { id: BASE_OWNERSHIP_TRANSFER_STEP_ID, contribution: null },
        { id: OBJECT_COPY_TRANSFER_STEP_ID, contribution: null },
        { id: OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID, contribution: null },
      ])
      expect(composition.transfer.map(({ id }) => id)).not.toContain('transfer.media')
      expect(composition.transfer.map(({ id }) => id)).not.toContain('transfer.object-policy')
      expect(registrations.map(({ contributionId, kind, permission }) => ({
        contributionId,
        kind,
        permission,
      }))).toEqual([
        {
          contributionId: 'job.transfer-execute',
          kind: TRANSFER_EXECUTE_JOB_KIND,
          permission: TRANSFER_CONTROL_PERMISSION,
        },
        {
          contributionId: 'job.transfer-resume',
          kind: TRANSFER_RESUME_JOB_KIND,
          permission: TRANSFER_CONTROL_PERMISSION,
        },
        {
          contributionId: 'job.transfer-compensate',
          kind: TRANSFER_COMPENSATE_JOB_KIND,
          permission: TRANSFER_CONTROL_PERMISSION,
        },
      ])
      expect(transferSagaJobHandlerMap(registrations)).toEqual(HANDLERS)
    }
  })

  it('registers an injected profile with the same mandatory object lane and no profile-name decision', () => {
    const registry = createFumaRegistry({
      capabilities: [siteSettingsCapability()],
      profiles: [{
        id: 'fixture-profile',
        label: 'Fixture profile',
        capabilityPreset: ['site.settings'],
        navigationPreset: ['nav.settings'],
        onboardingPreset: ['onboarding.identity'],
        starterTemplatePreset: [],
      }],
    })
    const composition = registry.compose('fixture-profile')
    const transferRegistry = createRegisteredTransferStepRegistry(registeredDefinitions(
      composition.transfer.map(({ stepId }) => stepId),
    ))

    expect(transferRegistry.compose(composition.transfer)
      .filter(({ mandatory }) => mandatory)
      .map(({ id }) => id)).toEqual([
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
      OBJECT_COPY_TRANSFER_STEP_ID,
      OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
    ])
    expect(composeTransferSagaJobRegistrations(composition, HANDLERS).map(({ kind }) => kind))
      .toEqual([
        TRANSFER_EXECUTE_JOB_KIND,
        TRANSFER_RESUME_JOB_KIND,
        TRANSFER_COMPENSATE_JOB_KIND,
      ])
  })

  it('fails closed when mandatory object definitions are missing or tampered', () => {
    expect(() => createRegisteredTransferStepRegistry(registeredDefinitions().slice(0, 2)))
      .toThrow(expect.objectContaining({
        name: 'TransferSagaRegistrationError',
        path: `definitions.${OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID}`,
      }))

    const tampered = registeredDefinitions().map((definition) => (
      definition.id === OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID
        ? { ...definition, dependsOn: [BASE_OWNERSHIP_TRANSFER_STEP_ID] }
        : definition
    ))
    expect(() => createRegisteredTransferStepRegistry(tampered)).toThrow(
      TransferSagaRegistrationError,
    )
  })

  it('fails closed when capability job composition omits or tampers with a descriptor', () => {
    const composition = fumaLaunchRegistry.compose('website')
    const missing = {
      jobs: composition.jobs.filter(({ handlerId }) => handlerId !== TRANSFER_RESUME_JOB_KIND),
    }
    expect(() => composeTransferSagaJobRegistrations(missing, HANDLERS)).toThrow(
      expect.objectContaining({
        name: 'TransferSagaRegistrationError',
        path: `composition.jobs.${TRANSFER_RESUME_JOB_KIND}`,
      }),
    )

    const tampered = {
      jobs: composition.jobs.map((job) => (
        job.handlerId === TRANSFER_EXECUTE_JOB_KIND
          ? { ...job, permission: 'content.pages.write' }
          : job
      )),
    }
    expect(() => composeTransferSagaJobRegistrations(tampered, HANDLERS)).toThrow(
      expect.objectContaining({
        name: 'TransferSagaRegistrationError',
        path: `composition.jobs.${TRANSFER_EXECUTE_JOB_KIND}`,
      }),
    )
  })

  it('rejects duplicate or incomplete job descriptor maps before worker consumption', () => {
    const registrations = composeTransferSagaJobRegistrations(
      fumaLaunchRegistry.compose('website'),
      HANDLERS,
    )
    expect(() => transferSagaJobHandlerMap([
      registrations[0],
      registrations[0],
      registrations[1],
      registrations[2],
    ])).toThrow(TransferSagaRegistrationError)
    expect(() => transferSagaJobHandlerMap(registrations.slice(0, 2)))
      .toThrow(TransferSagaRegistrationError)
  })
})
