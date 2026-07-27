import {
  fumaLaunchRegistry,
  type ComposedProductProfile,
  type FumaRegistry,
} from '@core/fuma'
import { Value } from '@core/utils/typeboxHelpers'
import {
  SiteSlugSchema,
  normalizeSiteSlug,
  type SiteCapabilityOverrides,
  type SiteProfileAssignment,
  type SiteProfileId,
  type SiteProfilePolicyErrorCode,
  type SiteSlug,
} from './contracts'

export const RESERVED_LAUNCH_SITE_SLUGS = Object.freeze([
  'admin',
  'api',
  'assets',
  'health',
  'instatic',
  'uploads',
] as const)

const RESERVED_LAUNCH_SITE_SLUG_SET: ReadonlySet<string> = new Set(
  RESERVED_LAUNCH_SITE_SLUGS,
)

export class SiteProfilePolicyError extends Error {
  readonly code: SiteProfilePolicyErrorCode

  constructor(code: SiteProfilePolicyErrorCode, message: string) {
    super(message)
    this.name = 'SiteProfilePolicyError'
    this.code = code
  }
}

export function isReservedLaunchSiteSlug(value: string): boolean {
  return RESERVED_LAUNCH_SITE_SLUG_SET.has(normalizeSiteSlug(value))
}

export function validateLaunchSiteSlug(value: string): SiteSlug {
  const slug = normalizeSiteSlug(value)
  if (!Value.Check(SiteSlugSchema, slug)) {
    throw new SiteProfilePolicyError(
      'invalid-slug',
      'site slug must normalize to a non-empty lower-kebab value',
    )
  }
  if (RESERVED_LAUNCH_SITE_SLUG_SET.has(slug)) {
    throw new SiteProfilePolicyError(
      'reserved-slug',
      `site slug "${slug}" is reserved for Fuma infrastructure or administration`,
    )
  }
  return slug
}

export function validateSiteProfileAssignment(
  assignment: SiteProfileAssignment,
  registry: FumaRegistry = fumaLaunchRegistry,
): ComposedProductProfile {
  return registry.compose(assignment.profileId, assignment.capabilityOverrides)
}

export function createSiteProfileAssignment(
  assignment: SiteProfileAssignment,
  registry: FumaRegistry = fumaLaunchRegistry,
): SiteProfileAssignment {
  validateSiteProfileAssignment(assignment, registry)
  const created: SiteProfileAssignment = {
    profileId: assignment.profileId,
    capabilityOverrides: {
      grant: [...assignment.capabilityOverrides.grant],
      revoke: [...assignment.capabilityOverrides.revoke],
    },
  }
  Object.freeze(created.capabilityOverrides.grant)
  Object.freeze(created.capabilityOverrides.revoke)
  Object.freeze(created.capabilityOverrides)
  return Object.freeze(created)
}

export function updateSiteProfileAssignment(
  current: SiteProfileAssignment,
  requestedProfileId: SiteProfileId,
  capabilityOverrides: SiteCapabilityOverrides,
  registry: FumaRegistry = fumaLaunchRegistry,
): SiteProfileAssignment {
  if (requestedProfileId !== current.profileId) {
    throw new SiteProfilePolicyError(
      'immutable-profile-assignment',
      `site profile assignment cannot change from "${current.profileId}" to "${requestedProfileId}"`,
    )
  }
  return createSiteProfileAssignment({
    profileId: current.profileId,
    capabilityOverrides,
  }, registry)
}
