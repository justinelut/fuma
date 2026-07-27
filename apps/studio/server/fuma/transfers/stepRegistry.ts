import type { TransferContribution } from '@core/fuma'
import type {
  TransferManifest,
  TransferReceipt,
} from './contracts'

export const BASE_OWNERSHIP_TRANSFER_STEP_ID = 'transfer.base-ownership'
export const BASE_OWNERSHIP_TRANSFER_STEP_ORDER = 40

export type TransferSagaFence = Readonly<{
  transferId: string
  lockId: string
  fence: number
}>

export type TransferStepExecutionInput = Readonly<{
  manifest: TransferManifest
  saga: TransferSagaFence
  receipt: TransferReceipt | null
}>

export type TransferStepVerification = Readonly<
  | { status: 'not-applied'; receipt: null }
  | { status: 'verified'; receipt: TransferReceipt }
>

export type TransferStepCompensation = Readonly<
  | { status: 'not-applied'; receipt: null }
  | { status: 'compensated'; receipt: TransferReceipt }
>

export type TransferStepDefinition = Readonly<{
  id: string
  order: number
  dependsOn: readonly string[]
  mandatory?: boolean
  apply(input: TransferStepExecutionInput): Promise<TransferReceipt>
  compensate(input: TransferStepExecutionInput): Promise<TransferStepCompensation>
  verify(input: TransferStepExecutionInput): Promise<TransferStepVerification>
}>

export type ComposedTransferStep = Readonly<{
  id: string
  order: number
  dependsOn: readonly string[]
  mandatory: boolean
  contribution: TransferContribution | null
  apply: TransferStepDefinition['apply']
  compensate: TransferStepDefinition['compensate']
  verify: TransferStepDefinition['verify']
}>

export type TransferStepRegistryErrorCode =
  | 'duplicate-step-id'
  | 'duplicate-step-order'
  | 'missing-dependency'
  | 'cyclic-dependency'
  | 'nondeterministic-composition'
  | 'missing-base-ownership-step'
  | 'duplicate-contribution-id'
  | 'contribution-collision'
  | 'unknown-contribution-step'
  | 'invalid-definition'

export class TransferStepRegistryError extends Error {
  readonly code: TransferStepRegistryErrorCode
  readonly path: string

  constructor(code: TransferStepRegistryErrorCode, message: string, path: string) {
    super(message)
    this.name = 'TransferStepRegistryError'
    this.code = code
    this.path = path
  }
}

function registryError(
  code: TransferStepRegistryErrorCode,
  message: string,
  path: string,
): never {
  throw new TransferStepRegistryError(code, message, path)
}

function assertDefinitionShape(step: TransferStepDefinition, index: number): void {
  const path = `steps[${index}]`
  if (!step || typeof step !== 'object') {
    registryError('invalid-definition', 'A transfer step must be an object.', path)
  }
  if (typeof step.id !== 'string' || step.id.length === 0) {
    registryError('invalid-definition', 'A transfer step requires a non-empty ID.', `${path}.id`)
  }
  if (!Number.isSafeInteger(step.order) || step.order < 1) {
    registryError(
      'invalid-definition',
      'A transfer step order must be a positive safe integer.',
      `${path}.order`,
    )
  }
  if (!Array.isArray(step.dependsOn)
    || step.dependsOn.some((dependency) => typeof dependency !== 'string' || !dependency)) {
    registryError(
      'invalid-definition',
      'Transfer step dependencies must be non-empty step IDs.',
      `${path}.dependsOn`,
    )
  }
  if (step.mandatory !== undefined && typeof step.mandatory !== 'boolean') {
    registryError('invalid-definition', 'mandatory must be a boolean.', `${path}.mandatory`)
  }
  for (const handler of ['apply', 'compensate', 'verify'] as const) {
    if (typeof step[handler] !== 'function') {
      registryError(
        'invalid-definition',
        `Transfer step "${step.id}" requires a ${handler} handler.`,
        `${path}.${handler}`,
      )
    }
  }
  if (new Set(step.dependsOn).size !== step.dependsOn.length) {
    registryError(
      'nondeterministic-composition',
      `Transfer step "${step.id}" repeats a dependency.`,
      `${path}.dependsOn`,
    )
  }
}

function assertAcyclic(
  definitions: ReadonlyMap<string, TransferStepDefinition>,
): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, lineage: readonly string[]): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      registryError(
        'cyclic-dependency',
        `Transfer step dependency cycle: ${[...lineage, id].join(' -> ')}.`,
        `steps.${id}.dependsOn`,
      )
    }
    visiting.add(id)
    const step = definitions.get(id)
    if (!step) return
    for (const dependency of step.dependsOn) visit(dependency, [...lineage, id])
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of definitions.keys()) visit(id, [])
}

function immutableDefinition(step: TransferStepDefinition): TransferStepDefinition {
  return Object.freeze({
    id: step.id,
    order: step.order,
    dependsOn: Object.freeze([...step.dependsOn]),
    mandatory: step.mandatory === true,
    apply: step.apply,
    compensate: step.compensate,
    verify: step.verify,
  })
}

function immutableContribution(contribution: TransferContribution): TransferContribution {
  return Object.freeze({ ...contribution })
}

export class TransferStepRegistry {
  readonly steps: readonly TransferStepDefinition[]
  readonly #stepsById: ReadonlyMap<string, TransferStepDefinition>

  constructor(input: readonly TransferStepDefinition[]) {
    if (!Array.isArray(input)) {
      registryError('invalid-definition', 'Transfer step definitions must be an array.', 'steps')
    }

    const ids = new Map<string, number>()
    const orders = new Map<number, string>()
    input.forEach((step, index) => {
      assertDefinitionShape(step, index)
      const previousIndex = ids.get(step.id)
      if (previousIndex !== undefined) {
        registryError(
          'duplicate-step-id',
          `Transfer step ID "${step.id}" is declared more than once.`,
          `steps[${index}].id`,
        )
      }
      const previousId = orders.get(step.order)
      if (previousId !== undefined) {
        registryError(
          'duplicate-step-order',
          `Transfer steps "${previousId}" and "${step.id}" share order ${step.order}.`,
          `steps[${index}].order`,
        )
      }
      ids.set(step.id, index)
      orders.set(step.order, step.id)
    })

    const definitions = new Map(input.map((step) => [step.id, step]))
    for (const step of input) {
      for (const dependency of step.dependsOn) {
        if (!definitions.has(dependency)) {
          registryError(
            'missing-dependency',
            `Transfer step "${step.id}" depends on missing step "${dependency}".`,
            `steps.${step.id}.dependsOn`,
          )
        }
      }
    }
    assertAcyclic(definitions)

    for (const step of input) {
      for (const dependencyId of step.dependsOn) {
        const dependency = definitions.get(dependencyId)
        if (dependency && dependency.order >= step.order) {
          registryError(
            'nondeterministic-composition',
            `Dependency "${dependencyId}" must have a lower order than "${step.id}".`,
            `steps.${step.id}.dependsOn`,
          )
        }
      }
    }

    const base = definitions.get(BASE_OWNERSHIP_TRANSFER_STEP_ID)
    if (!base
      || base.mandatory !== true
      || base.order !== BASE_OWNERSHIP_TRANSFER_STEP_ORDER
      || base.dependsOn.length !== 0) {
      registryError(
        'missing-base-ownership-step',
        `The mandatory ${BASE_OWNERSHIP_TRANSFER_STEP_ID} step must be registered at order ${BASE_OWNERSHIP_TRANSFER_STEP_ORDER} without dependencies.`,
        'steps',
      )
    }

    this.steps = Object.freeze(
      input
        .map(immutableDefinition)
        .toSorted((left, right) => left.order - right.order),
    )
    this.#stepsById = new Map(this.steps.map((step) => [step.id, step]))
  }

  get(id: string): TransferStepDefinition | undefined {
    return this.#stepsById.get(id)
  }

  compose(contributions: readonly TransferContribution[]): readonly ComposedTransferStep[] {
    if (!Array.isArray(contributions)) {
      registryError('invalid-definition', 'Transfer contributions must be an array.', 'contributions')
    }

    const contributionIds = new Set<string>()
    const stepContributions = new Map<string, TransferContribution>()
    contributions.forEach((contribution, index) => {
      const path = `contributions[${index}]`
      if (!contribution
        || typeof contribution !== 'object'
        || typeof contribution.id !== 'string'
        || !contribution.id
        || typeof contribution.stepId !== 'string'
        || !contribution.stepId
        || typeof contribution.permission !== 'string'
        || !contribution.permission) {
        registryError('invalid-definition', 'Transfer contribution is malformed.', path)
      }
      if (contributionIds.has(contribution.id)) {
        registryError(
          'duplicate-contribution-id',
          `Transfer contribution ID "${contribution.id}" is repeated.`,
          `${path}.id`,
        )
      }
      contributionIds.add(contribution.id)

      const step = this.#stepsById.get(contribution.stepId)
      if (!step) {
        registryError(
          'unknown-contribution-step',
          `Transfer contribution "${contribution.id}" names unregistered step "${contribution.stepId}".`,
          `${path}.stepId`,
        )
      }
      if (step.mandatory) {
        registryError(
          'contribution-collision',
          `Mandatory step "${step.id}" cannot also be selected by a profile contribution.`,
          `${path}.stepId`,
        )
      }
      const previous = stepContributions.get(step.id)
      if (previous) {
        registryError(
          'contribution-collision',
          `Contributions "${previous.id}" and "${contribution.id}" select the same step "${step.id}".`,
          `${path}.stepId`,
        )
      }
      stepContributions.set(step.id, immutableContribution(contribution))
    })

    const selected = new Set(
      this.steps.filter(({ mandatory }) => mandatory).map(({ id }) => id),
    )
    const include = (id: string): void => {
      if (selected.has(id)) return
      const step = this.#stepsById.get(id)
      if (!step) {
        registryError(
          'unknown-contribution-step',
          `No runtime transfer step is registered for "${id}".`,
          `steps.${id}`,
        )
      }
      for (const dependency of step.dependsOn) include(dependency)
      selected.add(id)
    }
    for (const stepId of stepContributions.keys()) include(stepId)

    const composed = this.steps
      .filter(({ id }) => selected.has(id))
      .map((step): ComposedTransferStep => Object.freeze({
        id: step.id,
        order: step.order,
        dependsOn: step.dependsOn,
        mandatory: step.mandatory === true,
        contribution: stepContributions.get(step.id) ?? null,
        apply: step.apply,
        compensate: step.compensate,
        verify: step.verify,
      }))

    const positions = new Map(composed.map(({ id }, index) => [id, index]))
    for (const step of composed) {
      const stepPosition = positions.get(step.id) as number
      if (step.dependsOn.some((id) => (positions.get(id) ?? Number.MAX_SAFE_INTEGER) >= stepPosition)) {
        registryError(
          'nondeterministic-composition',
          `Composed dependencies for "${step.id}" do not precede the step.`,
          `composition.${step.id}`,
        )
      }
    }

    return Object.freeze(composed)
  }
}

export function createTransferStepRegistry(
  definitions: readonly TransferStepDefinition[],
): TransferStepRegistry {
  return new TransferStepRegistry(definitions)
}
