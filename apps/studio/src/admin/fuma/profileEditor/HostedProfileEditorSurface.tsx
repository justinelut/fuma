import type { ReactNode } from 'react'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import {
  createEditorSessionTarget,
  type EditorSessionTarget,
} from '../editorSession'
import {
  fumaLaunchRegistry,
  type FumaRegistry,
  type PermissionDecision,
} from '@core/fuma'
import { Alert } from '@ui/components/Alert'
import { EmptyState } from '@ui/components/EmptyState'
import { TagPill } from '@ui/components/TagPill'
import { CORE_EDITOR_SURFACE_CONTRIBUTIONS } from './contributions'
import { resolveProfileEditorSurfaces } from './resolver'
import type { ResolvedEditorSurface } from './contracts'
import styles from './HostedProfileEditorSurface.module.css'

export type HostedProfileEditorRenderContext = Readonly<{
  shell: FumaScopedShellReadyContext
  surface: ResolvedEditorSurface
  target: EditorSessionTarget
  targetKey: string
}>

export type HostedProfileEditorRenderAdapter = (
  context: HostedProfileEditorRenderContext,
) => ReactNode

export interface HostedProfileEditorSurfaceProps {
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
  registry?: FumaRegistry
  renderAdapter?: HostedProfileEditorRenderAdapter
}

function normalizedPath(path: string): string {
  return path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
}

function surfacePath(surface: ResolvedEditorSurface): string {
  return surface.route.kind === 'navigation'
    ? surface.route.navigation.path
    : surface.route.path
}

function pathSelectsSurface(path: string, surface: ResolvedEditorSurface): boolean {
  const route = normalizedPath(surfacePath(surface))
  return path === route || path.startsWith(`${route}/`)
}

function selectSurface(
  path: string,
  surfaces: readonly ResolvedEditorSurface[],
): ResolvedEditorSurface | null {
  const normalized = normalizedPath(path)
  return surfaces
    .filter((surface) => pathSelectsSurface(normalized, surface))
    .toSorted((left, right) => (
      normalizedPath(surfacePath(right)).length
      - normalizedPath(surfacePath(left)).length
    ))[0] ?? null
}

function targetKey(target: EditorSessionTarget): string {
  return JSON.stringify([
    target.organizationId,
    target.workspaceId,
    target.siteId,
  ])
}

export function HostedProfileEditorSurface({
  shell,
  permissionDecisions,
  registry = fumaLaunchRegistry,
  renderAdapter,
}: HostedProfileEditorSurfaceProps) {
  const editor = resolveProfileEditorSurfaces({
    profileId: shell.resolution.site.profileId,
    capabilityOverrides: shell.resolution.site.capabilityOverrides,
    permissionDecisions,
    contributions: CORE_EDITOR_SURFACE_CONTRIBUTIONS,
  }, registry)
  const surface = selectSurface(
    shell.profileRelativeSubpath,
    editor.surfaces,
  )

  if (!surface?.access.visible) return null

  const target = createEditorSessionTarget({
    ...shell.resolution.selection,
    profileId: shell.resolution.site.profileId,
  })
  const fullTargetKey = targetKey(target)
  const renderContext: HostedProfileEditorRenderContext = Object.freeze({
    shell,
    surface,
    target,
    targetKey: fullTargetKey,
  })
  const accessLabel = surface.access.mutable ? 'Mutable' : 'Read only'

  return (
    <section
      className={styles.surface}
      aria-label={`${surface.label} editor surface`}
      data-editor-surface={surface.surface}
      data-editor-access={surface.access.mutable ? 'mutable' : 'read-only'}
      data-editor-target-key={fullTargetKey}
    >
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <p className={styles.eyebrow}>Editor surface</p>
          <h2 className={styles.heading}>{surface.label}</h2>
        </div>
        <TagPill
          label={accessLabel}
          colorKey={surface.access.mutable ? 'mutable' : 'read-only'}
          muted={!surface.access.mutable}
          size="xs"
        />
      </header>

      {!surface.access.mutable ? (
        <Alert title="Read-only access">
          You can view this surface, but the current permission decision does not allow changes.
        </Alert>
      ) : null}

      <div className={styles.body} key={fullTargetKey}>
        {renderAdapter ? renderAdapter(renderContext) : (
          <EmptyState
            plain
            title={`${surface.label} editor ready`}
            description="A hosted editor adapter can render this capability-owned surface."
          />
        )}
      </div>
    </section>
  )
}
