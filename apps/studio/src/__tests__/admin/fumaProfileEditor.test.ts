import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  CORE_EDITOR_SURFACE_CONTRIBUTIONS,
  EditorAccessSchema,
  resolveProfileEditorSurfaces,
  type EditorSurfaceContribution,
} from '@admin/fuma/profileEditor'
import {
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityDefinition,
  type CapabilityOverrides,
  type FumaRegistry,
  type PermissionDecision,
} from '@core/fuma'

const EMPTY_OVERRIDES: CapabilityOverrides = Object.freeze({ grant: [], revoke: [] })
const SITE_SCOPE = Object.freeze({
  kind: 'site' as const,
  platformId: 'platform-a',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
})

function allow(permissionId: string): PermissionDecision {
  return {
    permissionId,
    scope: SITE_SCOPE,
    decision: 'allow',
    precedence: 'launch-persona',
    source: {
      kind: 'launch-persona-assignment',
      assignmentId: 'assignment-a',
      persona: 'owner',
    },
  }
}

function deny(permissionId: string): PermissionDecision {
  return {
    permissionId,
    scope: SITE_SCOPE,
    decision: 'deny',
    precedence: 'explicit-deny',
    source: {
      kind: 'permission-override',
      overrideId: 'override-a',
    },
  }
}

function decisionsFor(
  registry: FumaRegistry,
  profileId: string,
  capabilityOverrides: CapabilityOverrides = EMPTY_OVERRIDES,
  denied: readonly string[] = [],
): readonly PermissionDecision[] {
  const deniedIds = new Set(denied)
  return registry.compose(profileId, capabilityOverrides).permissions.map(({ id }) => (
    deniedIds.has(id) ? deny(id) : allow(id)
  ))
}

function resolve(
  registry: FumaRegistry,
  profileId: string,
  capabilityOverrides: CapabilityOverrides = EMPTY_OVERRIDES,
  denied: readonly string[] = [],
  contributions: readonly EditorSurfaceContribution[] = CORE_EDITOR_SURFACE_CONTRIBUTIONS,
) {
  return resolveProfileEditorSurfaces({
    profileId,
    capabilityOverrides,
    permissionDecisions: decisionsFor(registry, profileId, capabilityOverrides, denied),
    contributions,
  }, registry)
}

function ids(values: readonly { readonly id: string }[]): string[] {
  return values.map(({ id }) => id)
}

describe('FUMA-027 profile editor surface resolution', () => {
  it('resolves Website and Publication shared capabilities through the same capability path', async () => {
    const website = resolve(fumaLaunchRegistry, 'website')
    const publication = resolve(fumaLaunchRegistry, 'publication')
    const sharedSurfaceIds = [
      'editor.pages',
      'editor.design',
      'editor.settings',
      'editor.import',
      'editor.publish',
    ]

    expect(ids(website.visible).filter((id) => sharedSurfaceIds.includes(id)))
      .toEqual(sharedSurfaceIds)
    expect(ids(publication.visible)).toEqual(sharedSurfaceIds)
    expect(publication.surfaces.map(({ capabilityId }) => capabilityId)).toEqual([
      'content.pages',
      'website.design',
      'site.settings',
      'site.settings',
      'content.pages',
    ])

    const resolverSource = await Bun.file(new URL(
      '../../admin/fuma/profileEditor/resolver.ts',
      import.meta.url,
    )).text()
    expect(resolverSource).not.toMatch(/profile\.id\s*===|profileId\s*===/)
    expect(resolverSource).not.toMatch(/['"](?:website|publication)['"]/)
  })

  it('derives surfaces from capability grants and revokes', () => {
    const mediaGrant: CapabilityOverrides = {
      grant: ['website.media'],
      revoke: [],
    }
    const designRevoke: CapabilityOverrides = {
      grant: [],
      revoke: ['website.design'],
    }

    expect(ids(resolve(fumaLaunchRegistry, 'publication').visible))
      .not.toContain('editor.media')
    expect(ids(resolve(fumaLaunchRegistry, 'publication', mediaGrant).visible))
      .toContain('editor.media')
    expect(ids(resolve(fumaLaunchRegistry, 'website', designRevoke).surfaces))
      .not.toContain('editor.design')
  })

  it('keeps readable surfaces visible while denied writes make them immutable', () => {
    const deniedWrites = [
      'content.pages.write',
      'website.design.write',
      'site.settings.write',
    ]
    const resolution = resolve(
      fumaLaunchRegistry,
      'website',
      EMPTY_OVERRIDES,
      deniedWrites,
    )

    expect(ids(resolution.visible)).toEqual([
      'editor.pages',
      'editor.design',
      'editor.settings',
      'editor.media',
      'editor.import',
      'editor.publish',
    ])
    expect(resolution.mutable).toEqual([])
    expect(resolution.surfaces.every(({ access }) => Value.Check(EditorAccessSchema, access)))
      .toBe(true)
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.surfaces)).toBe(true)
    expect(Object.isFrozen(resolution.surfaces[0].access)).toBe(true)
  })

  it('hides read-denied surfaces without treating another permission as a substitute', () => {
    const resolution = resolve(
      fumaLaunchRegistry,
      'website',
      EMPTY_OVERRIDES,
      ['website.media.read'],
    )
    const media = resolution.surfaces.find(({ id }) => id === 'editor.media')

    expect(media?.access).toEqual({ visible: false, mutable: false })
    expect(ids(resolution.visible)).not.toContain('editor.media')
  })

  it('accepts an extension capability surface without changing the core resolver or catalog', () => {
    const extensionCapability: CapabilityDefinition = {
      id: 'extension.seo',
      navigation: [{
        id: 'nav.seo',
        order: 45,
        label: 'SEO',
        path: '/admin/seo',
        permission: 'extension.seo.read',
      }],
      permissions: [
        { id: 'extension.seo.read', label: 'View SEO', description: 'View SEO audits.' },
        { id: 'extension.seo.write', label: 'Edit SEO', description: 'Edit SEO settings.' },
      ],
      routes: [{
        id: 'route.seo',
        method: 'GET',
        path: '/admin/seo',
        permission: 'extension.seo.read',
      }],
    }
    const extensionSurface: EditorSurfaceContribution = {
      id: 'extension.editor.seo',
      surface: 'seo.audit',
      capabilityId: 'extension.seo',
      order: 45,
      label: 'SEO',
      route: { kind: 'navigation', navigationId: 'nav.seo' },
      viewPermission: 'extension.seo.read',
      writePermission: 'extension.seo.write',
    }
    const registry = createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, extensionCapability],
      profiles: LAUNCH_PROFILES,
    })
    const extensionGrant: CapabilityOverrides = {
      grant: ['extension.seo'],
      revoke: [],
    }
    const contributions = [
      ...CORE_EDITOR_SURFACE_CONTRIBUTIONS,
      extensionSurface,
    ]
    const resolution = resolve(
      registry,
      'website',
      extensionGrant,
      [],
      contributions,
    )
    const seo = resolution.surfaces.find(({ id }) => id === extensionSurface.id)

    expect(CORE_EDITOR_SURFACE_CONTRIBUTIONS.some(({ id }) => id === extensionSurface.id))
      .toBe(false)
    expect(seo).toEqual({
      id: 'extension.editor.seo',
      surface: 'seo.audit',
      capabilityId: 'extension.seo',
      order: 45,
      label: 'SEO',
      route: {
        kind: 'navigation',
        navigation: extensionCapability.navigation?.[0],
      },
      access: { visible: true, mutable: true },
    })
    expect(ids(resolution.visible)).toContain(extensionSurface.id)
    expect(ids(resolution.mutable)).toContain(extensionSurface.id)
  })
})
