/**
 * Template marketplace surface.
 *
 * Reads the decision model rather than re-deriving it, so what the interface offers and what the
 * server permits cannot disagree. Composed from shadcn + Lucide + the rhythm scale, with no
 * stylesheet.
 */
import { useMemo, useState } from 'react'
import { Search, ShieldAlert } from 'lucide-react'
import {
  MARKETPLACE_CONTRACT,
  isPurchasable,
  reviewListing,
  type TemplateLicence,
  type TemplateListing,
} from '@core/fuma/templateMarketplace'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { RHYTHM } from '../ui/rhythm'

export interface MarketplaceRow {
  readonly listing: TemplateListing
  /** Whether artifact review has passed. False today for every template - see REVIEW_PIPELINE_GAP. */
  readonly reviewed: boolean
}

export interface TemplateMarketplaceSurfaceProps {
  readonly rows: readonly MarketplaceRow[]
  /** Licences this organization already holds, so an owned template says so instead of offering a sale. */
  readonly licences: readonly TemplateLicence[]
  readonly organizationId: string
  readonly onBuy?: (listingId: string, expectedPriceMinor: number) => void
  /**
   * Why the catalogue is incomplete, when it is. A REASON rather than a boolean: an empty
   * marketplace with no explanation reads as the product being broken.
   */
  readonly incompleteReason?: string
}

function formatPrice(minor: number, currency: string): string {
  if (minor === 0) return 'Free'
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

export function TemplateMarketplaceSurface({
  rows,
  licences,
  organizationId,
  onBuy,
  incompleteReason,
}: TemplateMarketplaceSurfaceProps) {
  const [query, setQuery] = useState('')

  const owned = useMemo(
    () => new Set(licences
      .filter((licence) => licence.buyerOrganizationId === organizationId && licence.refundedAt === null)
      .map((licence) => licence.listingId)),
    [licences, organizationId],
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return rows
    // Search the template name; it is the only thing a buyer knows to look for.
    return rows.filter((row) => row.listing.templateName.toLowerCase().includes(needle))
  }, [rows, query])

  return (
    <section aria-labelledby="marketplace-heading">
      <h1 id="marketplace-heading" className="text-lg font-semibold text-foreground">Template marketplace</h1>
      <p className={`${RHYTHM.TIGHT} max-w-2xl text-sm text-muted-foreground`}>
        {MARKETPLACE_CONTRACT.licenceOutlivesListing}
      </p>

      {incompleteReason ? (
        <div className={`${RHYTHM.GROUP} flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4`} role="status">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-foreground">{incompleteReason}</p>
        </div>
      ) : null}

      <div className={`${RHYTHM.GROUP} flex items-center ${RHYTHM.RELATED_GAP}`}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <Input
          aria-label="Search templates"
          placeholder="Search templates"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        /* An empty marketplace and a search that matched nothing are different facts. */
        <p className={`${RHYTHM.GROUP} text-sm text-muted-foreground`}>
          No templates have been listed yet.
        </p>
      ) : matches.length === 0 ? (
        <p className={`${RHYTHM.GROUP} text-sm text-muted-foreground`}>
          No templates match that search.
        </p>
      ) : (
        <ul className={`${RHYTHM.GROUP} flex flex-col ${RHYTHM.RELATED_GAP}`}>
          {matches.map(({ listing, reviewed }) => {
            const problems = reviewListing(listing, reviewed)
            const buyable = isPurchasable(listing, reviewed)
            const isOwned = owned.has(listing.listingId)
            return (
              <li key={listing.listingId} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-foreground">
                      {listing.templateName}
                    </strong>
                    <span className={`${RHYTHM.TIGHT} block text-sm text-muted-foreground`}>
                      {formatPrice(listing.priceMinor, listing.currency)}
                    </span>
                  </div>
                  {isOwned ? (
                    /* Owned is stated rather than offering a second sale, which would read as a
                       charge the buyer already made. */
                    <Badge variant="secondary">Licensed to your organization</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!buyable}
                      onClick={() => onBuy?.(listing.listingId, listing.priceMinor)}
                    >
                      {listing.priceMinor === 0 ? 'Get' : 'Buy'}
                    </Button>
                  )}
                </div>

                {/*
                  A disabled button with no explanation reads as the product being broken, so the
                  reason the model gave is rendered rather than discarded.
                */}
                {!buyable && !isOwned && problems.length > 0 ? (
                  <ul className={`${RHYTHM.RELATED} flex flex-col gap-1`} role="status">
                    {problems.map((problem) => (
                      <li key={problem.code} className="text-xs text-muted-foreground">{problem.message}</li>
                    ))}
                  </ul>
                ) : null}
                {!buyable && !isOwned && problems.length === 0 ? (
                  <p className={`${RHYTHM.RELATED} text-xs text-muted-foreground`} role="status">
                    This template is not on sale at the moment.
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
