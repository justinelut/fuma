import { useId } from 'react'
import { useNavigate } from '@admin/lib/routing'
import {
  buildOrganizationSwitchTarget,
  buildSiteSwitchTarget,
  buildWorkspaceSwitchTarget,
  type AccessibleContextCatalog,
  type ReadyScopedContextResolution,
} from '@core/fuma'
import { ContextPicker } from './ContextPicker'

export type FumaContextSwitchIntent =
  | Readonly<{
      kind: 'organization'
      organizationId: string
      target: string
    }>
  | Readonly<{
      kind: 'workspace'
      organizationId: string
      workspaceId: string
      target: string
    }>
  | Readonly<{
      kind: 'site'
      organizationId: string
      workspaceId: string
      siteId: string
      target: string
    }>

export type FumaContextSwitchHandler = (intent: FumaContextSwitchIntent) => void

export interface FumaContextSwitchersProps {
  context: ReadyScopedContextResolution
  catalog: AccessibleContextCatalog
  onSwitch?: FumaContextSwitchHandler
  ariaLabel?: string
}

/**
 * The workspace a site sits in, used as the picker's secondary line.
 *
 * Two sites with the same name is ordinary once an agency runs "Marketing" for several clients, and a
 * list of identical labels is a list you cannot choose from.
 */
function workspaceNameFor(catalog: AccessibleContextCatalog, workspaceId: string): string | null {
  return catalog.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null
}

export function FumaContextSwitchers({
  context,
  catalog,
  onSwitch,
  ariaLabel = 'Organization, workspace, and site',
}: FumaContextSwitchersProps) {
  const navigate = useNavigate()
  const instanceId = useId()
  const organizationSelectId = `${instanceId}-organization`
  const workspaceSelectId = `${instanceId}-workspace`
  const siteSelectId = `${instanceId}-site`

  const organizationChoices = catalog.organizations.flatMap((organization) => {
    if (organization.status !== 'active') return []
    const target = buildOrganizationSwitchTarget(
      catalog,
      organization.id,
      context.profileRelativeSubpath,
    )
    return target ? [{ entry: organization, target }] : []
  })

  const workspaceChoices = catalog.workspaces.flatMap((workspace) => {
    if (
      workspace.organizationId !== context.selection.organizationId
      || workspace.status !== 'active'
    ) return []
    const target = buildWorkspaceSwitchTarget(
      catalog,
      context.selection.organizationId,
      workspace.id,
      context.profileRelativeSubpath,
    )
    return target ? [{ entry: workspace, target }] : []
  })

  const siteChoices = catalog.sites.flatMap((site) => {
    if (
      site.organizationId !== context.selection.organizationId
      || site.workspaceId !== context.selection.workspaceId
      || site.status !== 'active'
    ) return []
    const target = buildSiteSwitchTarget({
      organizationId: site.organizationId,
      workspaceId: site.workspaceId,
      siteId: site.id,
    }, context.profileRelativeSubpath)
    return [{ entry: site, target }]
  })

  function handleOrganizationValue(value: string) {
    const choice = organizationChoices.find(({ entry }) => entry.id === value)
    if (!choice) return
    const intent: FumaContextSwitchIntent = {
      kind: 'organization',
      organizationId: choice.entry.id,
      target: choice.target,
    }
    onSwitch?.(intent)
    navigate(choice.target)
  }

  function handleWorkspaceValue(value: string) {
    const choice = workspaceChoices.find(({ entry }) => entry.id === value)
    if (!choice) return
    const intent: FumaContextSwitchIntent = {
      kind: 'workspace',
      organizationId: choice.entry.organizationId,
      workspaceId: choice.entry.id,
      target: choice.target,
    }
    onSwitch?.(intent)
    navigate(choice.target)
  }

  function handleSiteValue(value: string) {
    const choice = siteChoices.find(({ entry }) => entry.id === value)
    if (!choice) return
    const intent: FumaContextSwitchIntent = {
      kind: 'site',
      organizationId: choice.entry.organizationId,
      workspaceId: choice.entry.workspaceId,
      siteId: choice.entry.id,
      target: choice.target,
    }
    onSwitch?.(intent)
    navigate(choice.target)
  }

  return (
    <section className="flex w-full flex-wrap gap-3" aria-label={ariaLabel}>
      <div className="grid min-w-[min(100%,14rem)] flex-1 gap-1">
        <label className="text-xs leading-none text-muted-foreground" htmlFor={organizationSelectId}>Organization</label>
        <ContextPicker
          id={organizationSelectId}
          label="Organization"
          value={context.selection.organizationId}
          choices={organizationChoices.map(({ entry }) => ({
            value: entry.id,
            label: entry.name,
          }))}
          onChange={handleOrganizationValue}
        />
      </div>

      <div className="grid min-w-[min(100%,14rem)] flex-1 gap-1">
        <label className="text-xs leading-none text-muted-foreground" htmlFor={workspaceSelectId}>Workspace</label>
        <ContextPicker
          id={workspaceSelectId}
          label="Workspace"
          value={context.selection.workspaceId}
          choices={workspaceChoices.map(({ entry }) => ({
            value: entry.id,
            label: entry.name,
          }))}
          onChange={handleWorkspaceValue}
        />
      </div>

      <div className="grid min-w-[min(100%,14rem)] flex-1 gap-1">
        <label className="text-xs leading-none text-muted-foreground" htmlFor={siteSelectId}>Site</label>
        <ContextPicker
          id={siteSelectId}
          label="Site"
          value={context.selection.siteId}
          choices={siteChoices.map(({ entry }) => ({
            value: entry.id,
            label: entry.name,
            // Named so two sites with the same name are distinguishable - common once an agency runs
            // "Marketing" for several clients.
            ...(workspaceNameFor(catalog, entry.workspaceId)
              ? { hint: workspaceNameFor(catalog, entry.workspaceId) as string }
              : {}),
          }))}
          onChange={handleSiteValue}
        />
      </div>
    </section>
  )
}
