import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { ComponentCatalogHttpClient, type ComponentCatalogItemView } from './client'

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
      className="grid gap-6 rounded-md border border-border bg-card p-6 text-foreground [&_header_p]:max-w-[72ch]"
      aria-labelledby="component-catalog-title"
      data-testid="component-catalog"
    >
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Open exact-version registry</p>
        <h2 id="component-catalog-title">Component catalog</h2>
        <p>
          Create private declarative versions immediately, validate restricted React/Tailwind
          drafts, or install signed reviewed packs. Every insert stays exact-pinned.
        </p>
      </header>
      <div className="flex items-center gap-6 [&>*:first-child]:flex-1">
        <Input
          aria-label="Search components"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search layout, navigation, forms…"
        />
        <span>{items.length} results</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <div className="grid content-start gap-4 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
          {items.map((item) => (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="grid h-auto w-full justify-items-start gap-2 whitespace-normal p-4 text-left hover:border-primary focus-visible:border-primary"
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
              <span className="w-max rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{item.source}</span>
              <strong>{item.displayName}</strong>
              <p>{item.description}</p>
              <small>
                {item.coordinate}
                {item.installed ? ' · installed' : ''}
              </small>
            </Button>
          ))}
        </div>
        <aside className="grid content-start gap-3 rounded-md bg-muted/40 p-4 [&_textarea]:min-h-60 [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-card [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-sm [&_textarea]:leading-relaxed" aria-label="Component authoring">
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
          <div className="flex flex-wrap gap-2">
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
                variant={action === 'preview' ? 'secondary' : 'default'}
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {result && <pre>{result}</pre>}
        </aside>
      </div>
    </section>
  )
}
