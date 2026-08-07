/**
 * The Blocks library section in the builder.
 *
 * Renders whatever the catalogue declares, so shipping a block puts it on screen without touching this
 * component - the same property the AnimationPanel has for Motion fields.
 *
 * THE ONE INTERACTION DECISION THAT MATTERS: inserting is a single click and produces a single undo
 * step, because insertBlock goes through one insertNodes call. A picker that inserted a hero as eleven
 * separate operations would make removing it eleven presses of undo, and somebody who inserted the
 * wrong block would sooner rebuild the page than undo their way out.
 */
import { useMemo, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import {
  BLOCK_CATALOGUE,
  BLOCK_CATEGORY_ORDER,
} from '@core/react-ir/blockCatalogue'
import { familyOf, type BlockDefinition } from '@core/react-ir/blockLibrary'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'

export type BlocksPanelProps = Readonly<{
  /**
   * Inserts the block. The panel does not hold the module, so it cannot decide where a block goes -
   * that is the canvas's selection, and duplicating the rule here would let the two disagree.
   */
  onInsert: (block: BlockDefinition) => void
  /**
   * Why insertion is unavailable, or null when it is available.
   *
   * A REASON rather than a boolean, because a disabled button with no explanation reads as the product
   * being broken. The commonest real reason is that nothing on the canvas is selected, so there is no
   * parent to insert into.
   */
  unavailableReason?: string | null
  blocks?: readonly BlockDefinition[]
}>

export function BlocksPanel({
  onInsert,
  unavailableReason = null,
  blocks = BLOCK_CATALOGUE,
}: BlocksPanelProps) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return blocks
    // Searches the DESCRIPTION as well as the name, because somebody looking for a block usually
    // remembers what it is for rather than what it is called.
    return blocks.filter(
      (block) =>
        block.name.toLowerCase().includes(needle)
        || block.description.toLowerCase().includes(needle)
        || block.category.includes(needle),
    )
  }, [blocks, query])

  const grouped = useMemo(
    () =>
      BLOCK_CATEGORY_ORDER
        .map((category) => ({
          category,
          // Only base blocks head a row; a variant is shown beside its base rather than as a peer, or
          // the picker lists two heroes and nothing says they are the same block differently arranged.
          bases: matches.filter((b) => b.category === category && b.variantOf === null),
        }))
        .filter((group) => group.bases.length > 0),
    [matches],
  )

  const disabled = unavailableReason !== null

  return (
    <section aria-label="Blocks" className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Layers aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Blocks</h2>
      </header>

      <Input
        aria-label="Search blocks"
        placeholder="Search blocks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {disabled ? (
        <p role="status" className="text-sm text-muted-foreground">
          {unavailableReason}
        </p>
      ) : null}

      {grouped.length === 0 ? (
        // Returning nothing rather than falling back to the full list, which would look as though the
        // search had been ignored.
        <p className="text-sm text-muted-foreground">No blocks match that search.</p>
      ) : null}

      {grouped.map((group) => (
        <div key={group.category} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labelForCategory(group.category)}
          </h3>
          {group.bases.map((base) => {
            const family = familyOf(blocks, base.id).filter((b) => matches.includes(b) || b.id === base.id)
            return (
              <div key={base.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{base.name}</p>
                    {/* The description is shown rather than hidden behind a hover, because choosing
                        between six blocks by name alone means inserting each one to find out. */}
                    <p className="mt-1.5 text-xs text-muted-foreground">{base.description}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={disabled}
                    onClick={() => onInsert(base)}
                    aria-label={`Insert ${base.name}`}
                  >
                    <Plus aria-hidden="true" />
                    Insert
                  </Button>
                </div>

                {family.length > 1 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Variants</span>
                    {family
                      .filter((variant) => variant.id !== base.id)
                      .map((variant) => (
                        <Button
                          key={variant.id}
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => onInsert(variant)}
                          aria-label={`Insert ${variant.name}`}
                        >
                          {shortVariantName(variant)}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        {/* Stated in the interface rather than only in the contract, because a block that looks like a
            component invites the expectation that improving it updates pages that already used it. */}
        A block is copied into your page. Later changes to the library do not change pages you already
        built.
      </p>
    </section>
  )
}

function labelForCategory(category: BlockDefinition['category']): string {
  switch (category) {
    case 'call-to-action':
      return 'Call to action'
    case 'features':
      return 'Features'
    case 'hero':
      return 'Hero'
    case 'pricing':
      return 'Pricing'
    case 'testimonial':
      return 'Testimonial'
    case 'contact':
      return 'Contact'
    case 'footer':
      return 'Footer'
  }
}

/**
 * A variant's distinguishing word.
 *
 * "Hero — split" beside "Hero — centred" repeats the family name in a row that already states it, so
 * only the part after the dash is shown. Falls back to the whole name when there is no dash, rather
 * than rendering an empty button.
 */
function shortVariantName(variant: BlockDefinition): string {
  const parts = variant.name.split('—')
  const tail = parts.length > 1 ? parts[parts.length - 1]!.trim() : ''
  return tail === '' ? variant.name : tail
}
