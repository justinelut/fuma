import { Link } from '@admin/lib/routing'
import type { ManagedClientsView } from '@core/fuma'
import { EmptyState } from '@ui/components/EmptyState'

export interface FumaManagedClientsViewProps {
  model: ManagedClientsView
}

export function FumaManagedClientsView({ model }: FumaManagedClientsViewProps) {
  if (model.entries.length === 0) {
    return (
      <section className="grid gap-10" aria-label="Managed clients">
        <EmptyState
          variant="centered"
          title="No managed clients"
          description="No authorized managed workspaces are available in this app session."
          role="status"
        />
      </section>
    )
  }

  return (
    <section className="grid gap-10" aria-labelledby="managed-clients-title">
      <header className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(260px,520px)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal delivery</p>
          <h2 id="managed-clients-title" className="text-2xl text-foreground">Managed clients</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Open authorized internal workspaces and sites through their normal product context.
          Intended destinations do not change current ownership.
        </p>
      </header>

      <div className="grid gap-px overflow-hidden rounded-2xl bg-border grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        {model.entries.map((entry) => (
          <article
            key={`${entry.organizationId}:${entry.workspaceId}`}
            className="grid content-start gap-4 bg-card p-8"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg text-foreground">{entry.workspaceName}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">Owned by {entry.organizationName}</p>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{entry.workspaceStatus}</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground rounded-md bg-muted px-3 py-2">
              Intended destination: {entry.intendedOrganizationName}
            </p>
            {entry.sites.length > 0 ? (
              <ul className="m-0 grid list-none p-0" aria-label={`${entry.workspaceName} sites`}>
                {entry.sites.map((site) => (
                  <li key={site.selection.siteId} className="flex items-center justify-between gap-4 border-t border-border py-3">
                    <div>
                      <span className="block">{site.name}</span>
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{site.profileId}</span>
                    </div>
                    {site.target ? (
                      <Link className="text-sm font-medium text-primary" to={site.target}>Open site</Link>
                    ) : (
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{site.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">No authorized sites in this workspace.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
