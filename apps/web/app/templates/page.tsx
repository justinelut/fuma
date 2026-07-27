import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, FilterBar, Hero, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { canonicalTemplateFilters, exactTemplatePreview } from '@/lib/templates'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Templates', 'Discover approved Fuma templates and immutable previews.', '/templates')
export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filters = canonicalTemplateFilters(await searchParams)
  const data = await readPublicData('templates', { ...filters, limit: 24 })
  const items = (data?.data.items ?? []).filter(exactTemplatePreview)

  return <PageMain>
    <Hero eyebrow="Approved templates" title="Start with a strong structure." description="Filter reviewed templates, inspect an exact immutable release, then let the product re-check approval before installation." />
    <FilterBar>
      <select aria-label="Profile" name="profile" defaultValue={filters.profile}>
        <option value="">All profiles</option>
        <option value="website">Website</option>
        <option value="publication">Publication</option>
      </select>
      <input aria-label="Capability" name="capability" defaultValue={filters.capability} placeholder="Capability" pattern="[a-z0-9-]+" />
      <input aria-label="Industry" name="industry" defaultValue={filters.industry} placeholder="Industry" pattern="[a-z0-9-]+" />
      <input aria-label="Style" name="style" defaultValue={filters.style} placeholder="Style" pattern="[a-z0-9-]+" />
    </FilterBar>
    {items.length === 0
      ? <AuthorityUnavailable subject="Templates" />
      : <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => <article className="overflow-hidden rounded-xl border bg-card" key={item.id}>
            {/* Exact release media is intentionally not transformed or copied by Web. */}
            <img
              alt={item.image.alt}
              className="aspect-[16/9] h-auto w-full object-cover"
              decoding="async"
              height={item.image.height}
              loading="lazy"
              src={item.image.url}
              width={item.image.width}
            />
            <div className="p-6">
              <h2 className="text-2xl font-semibold"><a className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/templates/${item.slug}`}>{item.name}</a></h2>
              <p className="mt-3 text-muted-foreground">{item.summary}</p>
              <div aria-label="Template metadata" className="mt-4 flex flex-wrap gap-2">
                {item.profiles.map((tag) => <Tag key={`profile-${tag}`}>{tag}</Tag>)}
                {item.capabilities.map((tag) => <Tag key={`capability-${tag}`}>{tag}</Tag>)}
                {item.industries.map((tag) => <Tag key={`industry-${tag}`}>{tag}</Tag>)}
                {item.styles.map((tag) => <Tag key={`style-${tag}`}>{tag}</Tag>)}
              </div>
              <a className="mt-6 inline-block underline underline-offset-4" href={item.previewUrl} rel="noopener noreferrer" target="_blank">Open isolated preview<span className="sr-only"> of {item.name} in a new tab</span></a>
            </div>
          </article>)}
        </div>}
    <CursorPagination basePath="/templates" nextCursor={data?.data.page.nextCursor ?? null} filters={filters} />
  </PageMain>
}
