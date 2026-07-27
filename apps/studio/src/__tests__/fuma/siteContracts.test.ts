import { describe, expect, it } from 'bun:test'
import {
  FumaRegistryError,
  createFumaRegistry,
  type CapabilityDefinition,
  type FumaRegistryErrorCode,
} from '@core/fuma'
import { Value } from '@core/utils/typeboxHelpers'
import {
  SiteArchiveInputSchema,
  SiteCreateInputSchema,
  SiteIdSchema,
  SiteOrganizationIdSchema,
  SiteRecordSchema,
  SiteRestoreInputSchema,
  SiteSlugSchema,
  SiteStatusSchema,
  SiteUpdateInputSchema,
  SiteWorkspaceIdSchema,
  normalizeSiteSlug,
  type SiteProfileAssignment,
} from '../../../server/fuma/sites/contracts'
import {
  RESERVED_LAUNCH_SITE_SLUGS,
  SiteProfilePolicyError,
  createSiteProfileAssignment,
  isReservedLaunchSiteSlug,
  updateSiteProfileAssignment,
  validateLaunchSiteSlug,
  validateSiteProfileAssignment,
} from '../../../server/fuma/sites/profileAssignment'

const NOW = '2026-07-24T19:21:16.685Z'
const EMPTY_OVERRIDES = { grant: [], revoke: [] } as const

function assignment(
  profileId = 'website',
  capabilityOverrides: SiteProfileAssignment['capabilityOverrides'] = EMPTY_OVERRIDES,
): SiteProfileAssignment {
  return { profileId, capabilityOverrides }
}

function expectRegistryError(run: () => unknown, code: FumaRegistryErrorCode): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(FumaRegistryError)
    if (!(error instanceof FumaRegistryError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected FumaRegistryError with code ${code}`)
}

function capability(
  id: string,
  extra: Partial<CapabilityDefinition> = {},
): CapabilityDefinition {
  return { id, ...extra }
}

const baseCreate = {
  id: 'site-one',
  organizationId: 'organization-one',
  workspaceId: 'workspace-one',
  slug: 'site-one',
  name: 'Site One',
  profileId: 'website',
  capabilityOverrides: EMPTY_OVERRIDES,
}

const mutationScope = {
  organizationId: 'organization-one',
  workspaceId: 'workspace-one',
  siteId: 'site-one',
}

describe('FUMA-016 site contracts and profile policy', () => {
  it('defines scoped IDs, lower-kebab slugs, lifecycle status, strict commands, and records', () => {
    for (const schema of [SiteOrganizationIdSchema, SiteWorkspaceIdSchema, SiteIdSchema]) {
      expect(Value.Check(schema, 'tenant-id')).toBe(true)
      expect(Value.Check(schema, '')).toBe(false)
    }

    expect(Value.Check(SiteSlugSchema, 'launch-site-2')).toBe(true)
    expect(Value.Check(SiteSlugSchema, 'Launch Site')).toBe(false)
    expect(Value.Check(SiteStatusSchema, 'active')).toBe(true)
    expect(Value.Check(SiteStatusSchema, 'archived')).toBe(true)
    expect(Value.Check(SiteStatusSchema, 'deleted')).toBe(false)

    expect(Value.Check(SiteCreateInputSchema, baseCreate)).toBe(true)
    expect(Value.Check(SiteUpdateInputSchema, { ...mutationScope, name: 'Renamed' })).toBe(true)
    expect(Value.Check(SiteUpdateInputSchema, {
      ...mutationScope,
      capabilityOverrides: { grant: ['website.analytics'], revoke: [] },
    })).toBe(true)
    expect(Value.Check(SiteUpdateInputSchema, mutationScope)).toBe(false)
    expect(Value.Check(SiteUpdateInputSchema, {
      ...mutationScope,
      profileId: 'publication',
    })).toBe(false)
    expect(Value.Check(SiteArchiveInputSchema, mutationScope)).toBe(true)
    expect(Value.Check(SiteRestoreInputSchema, mutationScope)).toBe(true)

    expect(Value.Check(SiteRecordSchema, {
      ...baseCreate,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    })).toBe(true)
    expect(Value.Check(SiteCreateInputSchema, { ...baseCreate, unexpected: true })).toBe(false)
  })

  it('normalizes site slugs and blocks every reserved infrastructure/admin launch slug', () => {
    expect(normalizeSiteSlug('  Café & NEWS  ')).toBe('cafe-news')
    expect(validateLaunchSiteSlug('  Café & NEWS  ')).toBe('cafe-news')

    for (const slug of RESERVED_LAUNCH_SITE_SLUGS) {
      expect(isReservedLaunchSiteSlug(slug.toUpperCase())).toBe(true)
      expect(() => validateLaunchSiteSlug(`  ${slug.toUpperCase()}  `)).toThrow(
        expect.objectContaining({
          name: 'SiteProfilePolicyError',
          code: 'reserved-slug',
        }),
      )
    }
    expect(() => validateLaunchSiteSlug(' --- ')).toThrow(
      expect.objectContaining({ code: 'invalid-slug' }),
    )
  })

  it('delegates unknown profiles and malformed, unknown, and conflicting overrides to the registry', () => {
    expectRegistryError(
      () => validateSiteProfileAssignment(assignment('unknown-profile')),
      'unknown-profile',
    )
    expectRegistryError(
      () => validateSiteProfileAssignment(assignment('website', {
        grant: ['unknown.capability'],
        revoke: [],
      })),
      'invalid-capability-override',
    )
    expectRegistryError(
      () => validateSiteProfileAssignment(assignment('website', {
        grant: ['website.design'],
        revoke: ['website.design'],
      })),
      'invalid-capability-override',
    )

    const malformedAssignment = {
      profileId: 'website',
      capabilityOverrides: { grant: [] },
    }
    expectRegistryError(
      // @ts-expect-error This deliberately exercises the untyped persistence boundary.
      () => validateSiteProfileAssignment(malformedAssignment),
      'invalid-capability-override',
    )

    const registry = createFumaRegistry({
      capabilities: [
        capability('base', { conflictsWith: ['optional'] }),
        capability('optional'),
      ],
      profiles: [{
        id: 'custom-profile',
        label: 'Custom profile',
        capabilityPreset: ['base'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    expectRegistryError(
      () => validateSiteProfileAssignment(assignment('custom-profile', {
        grant: ['optional'],
        revoke: [],
      }), registry),
      'dependency-collision',
    )
  })

  it('accepts an injected non-launch profile without branching on launch profile IDs', () => {
    const registry = createFumaRegistry({
      capabilities: [capability('custom.capability')],
      profiles: [{
        id: 'custom-profile',
        label: 'Custom profile',
        capabilityPreset: ['custom.capability'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })

    const composed = validateSiteProfileAssignment(
      assignment('custom-profile'),
      registry,
    )
    expect(composed.profile.id).toBe('custom-profile')
    expect(composed.capabilities.map(({ id }) => id)).toEqual(['custom.capability'])
  })

  it('freezes assignments, permits override replacement, and rejects profile changes after creation', () => {
    const created = createSiteProfileAssignment(assignment())
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.capabilityOverrides)).toBe(true)
    expect(Object.isFrozen(created.capabilityOverrides.grant)).toBe(true)

    const updated = updateSiteProfileAssignment(created, 'website', {
      grant: [],
      revoke: ['website.analytics'],
    })
    expect(updated).toEqual({
      profileId: 'website',
      capabilityOverrides: { grant: [], revoke: ['website.analytics'] },
    })

    expect(() => updateSiteProfileAssignment(
      created,
      'publication',
      EMPTY_OVERRIDES,
    )).toThrow(expect.objectContaining({
      name: 'SiteProfilePolicyError',
      code: 'immutable-profile-assignment',
    }))
    try {
      updateSiteProfileAssignment(created, 'publication', EMPTY_OVERRIDES)
    } catch (error) {
      expect(error).toBeInstanceOf(SiteProfilePolicyError)
      expect((error as SiteProfilePolicyError).message).toContain('website')
      expect((error as SiteProfilePolicyError).message).toContain('publication')
    }
  })

  it('contains no profile-name branching or duplicate override resolution in the policy', async () => {
    const source = await Bun.file(new URL(
      '../../../server/fuma/sites/profileAssignment.ts',
      import.meta.url,
    )).text()

    expect(source).not.toMatch(/profileId\s*={2,3}\s*['"](?:website|publication)['"]/)
    expect(source).not.toMatch(/switch\s*\(\s*(?:assignment\.)?profileId\s*\)/)
    expect(source.match(/\.compose\(/g)).toHaveLength(1)
  })
})
