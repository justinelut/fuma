import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { ComponentCatalogHttpClient, type ComponentCatalogItemView } from './client'
import styles from './ComponentCatalogRouteContent.module.css'

export function ComponentCatalogRouteContent({
  shell,
  permissionDecisions,
}: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
}>): ReactNode {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(
    () => new ComponentCatalogHttpClient({ organizationId, workspaceId, siteId }),
    [organizationId, workspaceId, siteId],
  )
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<readonly ComponentCatalogItemView[]>([])
  const [selected, setSelected] = useState<ComponentCatalogItemView | null>(null)
  const [command, setCommand] = useState('{}')
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)
  const active =
    shell.profileRelativeSubpath === '/admin/design' &&
    shell.routeAccess.kind === 'allowed' &&
    shell.routeAccess.route.id === 'route.design'
  const canWrite = permissionDecisions.some(
    (decision) =>
      decision.permissionId === 'website.design.write' && decision.decision === 'allow',
  )

  useEffect(() => {
    if (!active) return
    let live = true
    void client.search(query).then(
      (value) => {
        if (live) setItems(value)
      },
      (caught) => {
        if (live) setError(getErrorMessage(caught, 'Catalog unavailable'))
      },
    )
    return () => {
      live = false
    }
  }, [active, client, query])

  if (!active) return null

  async function run(action: string, payload: unknown) {
    setError(null)
    try {
      setResult(JSON.stringify(await client.action(action, payload), null, 2))
      void client.search(query).then(setItems)
    } catch (caught) {
      setError(getErrorMessage(caught, 'Component action failed.'))
    }
  }

  return (
    <section
      className={styles.root}
      aria-labelledby="component-catalog-title"
      data-testid="component-catalog"
    >
      <header>
        <p className={styles.eyebrow}>Open exact-version registry</p>
        <h2 id="component-catalog-title">Component catalog</h2>
        <p>
          Create private declarative versions immediately, validate restricted React/Tailwind
          drafts, or install signed reviewed packs. Every insert stays exact-pinned.
        </p>
      </header>
      <div className={styles.toolbar}>
        <Input
          aria-label="Search components"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search layout, navigation, forms…"
        />
        <span>{items.length} results</span>
      </div>
      <div className={styles.layout}>
        <div className={styles.grid}>
          {items.map((item) => (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              align="start"
              fullWidth
              className={styles.card}
              key={item.coordinate}
              onClick={() => {
                setSelected(item)
                setCommand(
                  JSON.stringify(
                    {
                      coordinate: item.coordinate,
                      componentId: item.componentIds[0],
                      variantId: null,
                    },
                    null,
                    2,
                  ),
                )
              }}
            >
              <span className={styles.source}>{item.source}</span>
              <strong>{item.displayName}</strong>
              <p>{item.description}</p>
              <small>
                {item.coordinate}
                {item.installed ? ' · installed' : ''}
              </small>
            </Button>
          ))}
        </div>
        <aside className={styles.editor} aria-label="Component authoring">
          <h3>{selected?.displayName ?? 'Declarative authoring'}</h3>
          <p>
            Use strict command JSON to create/edit/version/variant/preview/insert. Source
            confirmation is intentionally completed only by the owner here, never by native AI.
          </p>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.currentTarget.value)}
            spellCheck={false}
          />
          <div className={styles.actions}>
            {[
              'preview',
              'create',
              'edit',
              'variant',
              'insert',
              'validate-source',
              'confirm-source',
              'install',
              'upgrade',
              'usage',
              'uninstall',
            ].map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={action === 'preview' ? 'secondary' : 'primary'}
                disabled={!canWrite && action !== 'preview' && action !== 'usage'}
                onClick={() => {
                  try {
                    void run(action, JSON.parse(command))
                  } catch {
                    setError('Command must be valid JSON.')
                  }
                }}
              >
                <span>{action}</span>
              </Button>
            ))}
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {result && <pre>{result}</pre>}
        </aside>
      </div>
    </section>
  )
}
