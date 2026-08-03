/**
 * Collections widget — the operator's view of the content model.
 *
 * Bounded provisioning lets Site AI define collections, so this tile answers
 * "what has been modelled, and what is actually in it": a total split into
 * content and record collections, plus the busiest collections by row count.
 *
 * A freshly provisioned collection shows with zero rows rather than being
 * hidden, because seeing an empty collection is how an operator confirms the
 * model landed. System collections are labelled so it is obvious which ones
 * cannot be restructured.
 */
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { StatValue } from '@ui/components/charts'
import { Widget } from '@ui/components/Widget'
import { cn } from '@ui/cn'
import { useCollectionsStats } from '../hooks/useDashboardStats'
import styles from './widgets.module.css'

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function CollectionsWidget({ span, editing }: DashboardWidgetRendererProps) {
  const stats = useCollectionsStats()
  const isLoading = stats === null
  const collections = stats?.collections ?? []
  const isEmpty = !isLoading && collections.length === 0

  return (
    <Widget
      widgetId="collections"
      title="Collections"
      icon={DatabaseSolidIcon}
      tint="mint"
      span={span}
      editing={editing}
      loading={isLoading}
    >
      {stats && (
        <>
          <StatValue
            value={stats.total.toLocaleString()}
            sub={(
              <span>
                {stats.content} {plural(stats.content, 'content type', 'content types')}
                {' · '}
                {stats.records} {plural(stats.records, 'record set', 'record sets')}
                {' · '}
                {stats.totalRows.toLocaleString()} {plural(stats.totalRows, 'entry', 'entries')}
              </span>
            )}
          />
          {isEmpty && (
            <p className={cn(styles.feedTime, styles.feedEmpty)}>
              No collections yet — create one in Data, or ask the assistant to
              model what this site needs.
            </p>
          )}
          {!isEmpty && (
            <ul className={styles.wlist}>
              {collections.map((collection) => (
                <li key={collection.slug}>
                  <span className={styles.wlistTitle}>
                    <span className={styles.wlistPath}>{collection.name}</span>
                  </span>
                  <span className={styles.wlistMeta}>
                    <span
                      className={cn(
                        styles.badge,
                        collection.system
                          ? styles.badgeLive
                          : collection.shape === 'content'
                            ? styles.badgePublished
                            : styles.badgeQueued,
                      )}
                    >
                      {collection.system ? 'system' : collection.shape}
                    </span>
                    <span>
                      {collection.rows.toLocaleString()} {plural(collection.rows, 'entry', 'entries')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  )
}
