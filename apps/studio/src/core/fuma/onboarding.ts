import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  CapabilityOverridesSchema,
  OnboardingStepContributionSchema,
  type ComposedProductProfile,
  type OnboardingStepContribution,
} from './contracts'
import type { FumaRegistry } from './registry'

const RegistryIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})

const OwnedSiteScopeSchema = {
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
}

export const ProfileOnboardingAssignmentSchema = Type.Object({
  ...OwnedSiteScopeSchema,
  profileId: RegistryIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
}, { additionalProperties: false })
export type ProfileOnboardingAssignment = Static<typeof ProfileOnboardingAssignmentSchema>

export const ProfileOnboardingProgressSchema = Type.Object({
  ...OwnedSiteScopeSchema,
  profileId: RegistryIdSchema,
  compositionFingerprint: Type.String({ minLength: 1 }),
  completedStepIds: Type.Array(RegistryIdSchema, { uniqueItems: true }),
  cursor: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
export type ProfileOnboardingProgress = Static<typeof ProfileOnboardingProgressSchema>

export const CompleteProfileOnboardingStepCommandSchema = Type.Object({
  ...OwnedSiteScopeSchema,
  profileId: RegistryIdSchema,
  compositionFingerprint: Type.String({ minLength: 1 }),
  stepId: RegistryIdSchema,
}, { additionalProperties: false })
export type CompleteProfileOnboardingStepCommand = Static<typeof CompleteProfileOnboardingStepCommandSchema>

export const ProfileOnboardingStateSchema = Type.Object({
  steps: Type.Array(OnboardingStepContributionSchema),
  progress: ProfileOnboardingProgressSchema,
  currentStepId: Type.Union([RegistryIdSchema, Type.Null()]),
  complete: Type.Boolean(),
}, { additionalProperties: false })
export type ProfileOnboardingState = Static<typeof ProfileOnboardingStateSchema>

export const ProfileOnboardingErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('site-mismatch'),
  Type.Literal('profile-switch'),
  Type.Literal('composition-drift'),
  Type.Literal('invalid-progress'),
  Type.Literal('unavailable-step'),
  Type.Literal('out-of-order-step'),
])
export type ProfileOnboardingErrorCode = Static<typeof ProfileOnboardingErrorCodeSchema>

export class ProfileOnboardingError extends Error {
  readonly code: ProfileOnboardingErrorCode

  constructor(code: ProfileOnboardingErrorCode, message: string) {
    super(message)
    this.name = 'ProfileOnboardingError'
    this.code = code
  }
}

function firstValidationError(schema: TSchema, value: unknown): string {
  const error = Value.Errors(schema, value).First()
  return error ? `${error.path || '/'} ${error.message}` : 'unknown schema error'
}

function assertContract(schema: TSchema, value: unknown, subject: string): void {
  if (!Value.Check(schema, value)) {
    throw new ProfileOnboardingError(
      'invalid-contract',
      `${subject} does not match its TypeBox contract: ${firstValidationError(schema, value)}`,
    )
  }
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function fingerprintComposition(composed: ComposedProductProfile): string {
  return JSON.stringify({
    capabilities: composed.capabilities.map(({ id }) => id),
    onboarding: composed.onboarding.map(({ id, order, title, description }) => ({
      id,
      order,
      title,
      description,
    })),
  })
}

function composeOnboarding(
  registry: FumaRegistry,
  assignment: ProfileOnboardingAssignment,
): {
  fingerprint: string
  steps: readonly OnboardingStepContribution[]
} {
  assertContract(ProfileOnboardingAssignmentSchema, assignment, 'profile onboarding assignment')
  const composed = registry.compose(assignment.profileId, assignment.capabilityOverrides)
  return {
    fingerprint: fingerprintComposition(composed),
    steps: composed.onboarding,
  }
}

function assertProgressScope(
  assignment: ProfileOnboardingAssignment,
  compositionFingerprint: string,
  progress: ProfileOnboardingProgress,
): void {
  if (progress.organizationId !== assignment.organizationId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding progress belongs to organization "${progress.organizationId}", not "${assignment.organizationId}"`,
    )
  }
  if (progress.workspaceId !== assignment.workspaceId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding progress belongs to workspace "${progress.workspaceId}", not "${assignment.workspaceId}"`,
    )
  }
  if (progress.siteId !== assignment.siteId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding progress belongs to site "${progress.siteId}", not "${assignment.siteId}"`,
    )
  }
  if (progress.profileId !== assignment.profileId) {
    throw new ProfileOnboardingError(
      'profile-switch',
      `onboarding cannot switch profile from "${progress.profileId}" to "${assignment.profileId}"`,
    )
  }
  if (progress.compositionFingerprint !== compositionFingerprint) {
    throw new ProfileOnboardingError(
      'composition-drift',
      'onboarding capability composition changed after progress was created',
    )
  }
}

function assertProgressSequence(
  steps: readonly OnboardingStepContribution[],
  progress: ProfileOnboardingProgress,
): void {
  if (progress.cursor > steps.length) {
    throw new ProfileOnboardingError(
      'invalid-progress',
      `onboarding cursor ${progress.cursor} exceeds ${steps.length} available steps`,
    )
  }

  const expectedCompleted = steps
    .slice(0, progress.cursor)
    .map(({ id }) => id)
  if (
    progress.completedStepIds.length !== expectedCompleted.length
    || progress.completedStepIds.some((id, index) => id !== expectedCompleted[index])
  ) {
    throw new ProfileOnboardingError(
      'invalid-progress',
      'completed onboarding steps must be the ordered prefix ending at the current cursor',
    )
  }
}

function stateFrom(
  steps: readonly OnboardingStepContribution[],
  progress: ProfileOnboardingProgress,
): ProfileOnboardingState {
  const state: ProfileOnboardingState = {
    steps: [...steps],
    progress: {
      ...progress,
      completedStepIds: [...progress.completedStepIds],
    },
    currentStepId: steps[progress.cursor]?.id ?? null,
    complete: progress.cursor === steps.length,
  }
  return immutable(state)
}

export function resolveProfileOnboarding(
  registry: FumaRegistry,
  assignment: ProfileOnboardingAssignment,
  persistedProgress?: ProfileOnboardingProgress,
): ProfileOnboardingState {
  const { fingerprint, steps } = composeOnboarding(registry, assignment)

  if (!persistedProgress) {
    return stateFrom(steps, {
      organizationId: assignment.organizationId,
      workspaceId: assignment.workspaceId,
      siteId: assignment.siteId,
      profileId: assignment.profileId,
      compositionFingerprint: fingerprint,
      completedStepIds: [],
      cursor: 0,
    })
  }

  assertContract(ProfileOnboardingProgressSchema, persistedProgress, 'profile onboarding progress')
  assertProgressScope(assignment, fingerprint, persistedProgress)
  assertProgressSequence(steps, persistedProgress)
  return stateFrom(steps, persistedProgress)
}

function assertCommandScope(
  progress: ProfileOnboardingProgress,
  command: CompleteProfileOnboardingStepCommand,
): void {
  if (command.organizationId !== progress.organizationId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding completion belongs to organization "${command.organizationId}", not "${progress.organizationId}"`,
    )
  }
  if (command.workspaceId !== progress.workspaceId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding completion belongs to workspace "${command.workspaceId}", not "${progress.workspaceId}"`,
    )
  }
  if (command.siteId !== progress.siteId) {
    throw new ProfileOnboardingError(
      'site-mismatch',
      `onboarding completion belongs to site "${command.siteId}", not "${progress.siteId}"`,
    )
  }
  if (command.profileId !== progress.profileId) {
    throw new ProfileOnboardingError(
      'profile-switch',
      `onboarding completion cannot switch profile from "${progress.profileId}" to "${command.profileId}"`,
    )
  }
  if (command.compositionFingerprint !== progress.compositionFingerprint) {
    throw new ProfileOnboardingError(
      'composition-drift',
      'onboarding completion targets a different capability composition',
    )
  }
}

export function completeProfileOnboardingStep(
  registry: FumaRegistry,
  assignment: ProfileOnboardingAssignment,
  persistedProgress: ProfileOnboardingProgress,
  command: CompleteProfileOnboardingStepCommand,
): ProfileOnboardingState {
  assertContract(
    CompleteProfileOnboardingStepCommandSchema,
    command,
    'complete profile onboarding step command',
  )
  const resolved = resolveProfileOnboarding(registry, assignment, persistedProgress)
  assertCommandScope(resolved.progress, command)

  if (!resolved.steps.some(({ id }) => id === command.stepId)) {
    throw new ProfileOnboardingError(
      'unavailable-step',
      `onboarding step "${command.stepId}" is not available in the active capability composition`,
    )
  }
  if (resolved.progress.completedStepIds.includes(command.stepId)) return resolved

  if (resolved.currentStepId !== command.stepId) {
    throw new ProfileOnboardingError(
      'out-of-order-step',
      `onboarding step "${command.stepId}" cannot complete while current step is "${resolved.currentStepId ?? 'none'}"`,
    )
  }

  return stateFrom(resolved.steps, {
    ...resolved.progress,
    completedStepIds: [...resolved.progress.completedStepIds, command.stepId],
    cursor: resolved.progress.cursor + 1,
  })
}
