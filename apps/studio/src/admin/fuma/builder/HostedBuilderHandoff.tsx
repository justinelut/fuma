/**
 * Full-viewport handoff into the Instatic builder.
 *
 * Site design belongs to Instatic. The hosted product does not wrap it in
 * platform chrome, does not embed it in a panel, and does not reproduce its
 * media, pages or data surfaces. Once the session exchange succeeds this
 * component renders the Instatic application as the only thing on screen.
 *
 * Only the pre-handoff states — resolving, refused, failed — are hosted UI, and
 * they are deliberately minimal.
 */
import { useEffect, useState } from 'react'
import { AppLoadingScreen } from '@admin/AppLoadingScreen'
import { prewarmedLazy } from '@admin/lib/prewarmedLazy'
import type { AdminWorkspace } from '@admin/workspace'
import {
  openBuilderSession,
  type BuilderSessionResult,
  type BuilderSessionScope,
} from '@core/fuma/builder/builderSessionClient'
import type { CmsCurrentUser } from '@core/persistence'
import { useAdminUi } from '@admin/state/adminUi'
import { cn } from '../ui/cn'

const AuthenticatedAdmin = prewarmedLazy<{
  section: AdminWorkspace
  currentUser: CmsCurrentUser
}>(
  () => import('@admin/AuthenticatedAdmin'),
  { displayName: 'AuthenticatedAdmin' },
)

export interface HostedBuilderHandoffProps {
  scope: BuilderSessionScope
  /**
   * Which Instatic section to enter. `site` is the canvas; `dashboard` is
   * Instatic's own insights home. Every other section is Instatic's too — the
   * hosted product does not reproduce any of them.
   */
  section?: AdminWorkspace
  /** Where a refused or failed handoff returns to. */
  returnPath: string
  siteName?: string
  /** Test seam. Defaults to the live session exchange. */
  exchange?: (scope: BuilderSessionScope) => Promise<BuilderSessionResult>
}

type HandoffState =
  | Readonly<{ kind: 'resolving' }>
  | BuilderSessionResult

export function HostedBuilderHandoff({
  scope,
  section = 'site',
  returnPath,
  siteName,
  exchange = openBuilderSession,
}: HostedBuilderHandoffProps) {
  const [state, setState] = useState<HandoffState>({ kind: 'resolving' })
  const setPublishedSiteOrigin = useAdminUi((store) => store.setPublishedSiteOrigin)

  useEffect(() => {
    let active = true
    setState({ kind: 'resolving' })
    void exchange(scope).then((result) => {
      if (!active) return
      // The builder's live-site link needs the site's own origin before it
      // renders, otherwise it would open the admin host.
      setPublishedSiteOrigin(result.kind === 'ready' ? result.publicOrigin : null)
      setState(result)
    })
    return () => { active = false }
  }, [exchange, scope, setPublishedSiteOrigin])

  if (state.kind === 'resolving') return <AppLoadingScreen />

  if (state.kind === 'ready') {
    // Nothing else renders. Instatic owns the document from here.
    return <AuthenticatedAdmin section={section} currentUser={state.user} />
  }

  if (state.kind === 'unauthenticated') {
    window.location.assign('/admin/login')
    return <AppLoadingScreen />
  }

  const refused = state.kind === 'forbidden'
  return (
    <div
      className={cn(
        'fuma-hosted grid min-h-dvh place-items-center bg-background px-6 py-16',
      )}
    >
      <section
        className={cn(
          'w-full max-w-md rounded-[var(--radius-lg)] border border-border',
          'bg-card p-8 text-center',
        )}
        role="alert"
        aria-labelledby="builder-handoff-title"
      >
        <h1
          id="builder-handoff-title"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          {refused ? 'You cannot design this site' : 'The builder did not open'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {refused
            ? 'Designing a site needs edit permission. Ask an owner or admin to grant it.'
            : state.message}
        </p>
        <a
          className={cn(
            'mt-6 inline-flex h-10 items-center justify-center rounded-[var(--radius-md)]',
            'bg-foreground px-4 text-sm font-medium text-background',
            'transition-opacity hover:opacity-90',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          )}
          href={returnPath}
        >
          Back to {siteName ?? 'dashboard'}
        </a>
      </section>
    </div>
  )
}
