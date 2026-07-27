import { Link } from '@admin/lib/routing'
import type { ManagedClientsView } from '@core/fuma'
import { EmptyState } from '@ui/components/EmptyState'
import styles from './FumaManagedClientsView.module.css'

export interface FumaManagedClientsViewProps {
  model: ManagedClientsView
}

export function FumaManagedClientsView({ model }: FumaManagedClientsViewProps) {
  if (model.entries.length === 0) {
    return (
      <section className={styles.root} aria-label="Managed clients">
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
    <section className={styles.root} aria-labelledby="managed-clients-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Internal delivery</p>
          <h2 id="managed-clients-title" className={styles.title}>Managed clients</h2>
        </div>
        <p className={styles.description}>
          Open authorized internal workspaces and sites through their normal product context.
          Intended destinations do not change current ownership.
        </p>
      </header>

      <div className={styles.grid}>
        {model.entries.map((entry) => (
          <article
            key={`${entry.organizationId}:${entry.workspaceId}`}
            className={styles.card}
          >
            <div className={styles.cardHeading}>
              <div>
                <h3 className={styles.workspaceName}>{entry.workspaceName}</h3>
                <p className={styles.ownerName}>Owned by {entry.organizationName}</p>
              </div>
              <span className={styles.status}>{entry.workspaceStatus}</span>
            </div>
            <p className={styles.destination}>
              Intended destination: {entry.intendedOrganizationName}
            </p>
            {entry.sites.length > 0 ? (
              <ul className={styles.siteList} aria-label={`${entry.workspaceName} sites`}>
                {entry.sites.map((site) => (
                  <li key={site.selection.siteId} className={styles.siteRow}>
                    <div>
                      <span className={styles.siteName}>{site.name}</span>
                      <span className={styles.profileName}>{site.profileId}</span>
                    </div>
                    {site.target ? (
                      <Link className={styles.openLink} to={site.target}>Open site</Link>
                    ) : (
                      <span className={styles.unavailable}>{site.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptySites}>No authorized sites in this workspace.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
