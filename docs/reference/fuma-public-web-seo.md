# Fuma public Web technical SEO

FUMA-WEB-015 keeps crawler presentation inside `apps/web`; it does not create content, marketplace, pricing, identity, onboarding, or session authority.

## Canonical and metadata policy

Every indexable page emits one query-free `https://trimly.co.ke` canonical plus matching `en-KE` and `x-default` alternates. Search, preview, handoff, acceptance, API, and missing/withdrawn states are noindex. Metadata titles and descriptions are bounded plain text. RSS and Atom discovery are advertised from the root layout. Open Graph and Twitter metadata use the app-owned, versioned `/social/fuma-social-v1.png` fallback, which is generated without remote assets or visitor input and served with a one-year immutable cache policy.

## Structured data policy

JSON-LD builders are closed to reviewed editorial or strict public-projection fields. Supported ticket schemas cover WebSite, BlogPosting/TechArticle, Product templates, Person/Organization experts, and BreadcrumbList. Serialization rejects non-JSON values, excessive complexity, script-breaking text, and all rating/review/testimonial keys because no such public authority exists. Withdrawn discovery records produce neither a detail page nor JSON-LD.

## Sitemaps and feeds

`/sitemap/core.xml` contains deterministic indexable static routes without invented modification dates. `/sitemap/content.xml` consumes only eligible Git editorial entries. `/sitemap/discovery.xml` walks bounded authority cursors and includes only current approved templates, experts, showcases, and reviewed plugins. Each segment sorts by canonical URL, rejects collisions, and fails above 45,000 URLs or 500 source pages rather than truncating silently. Projection failure omits that authority dataset and never substitutes stale or editorial records.

RSS and Atom consume the same eligible editorial loader as routes, search, and content sitemap. Draft, future, redirected-old, and overdue content cannot enter the feeds. Responses are explicitly typed, nosniff, and revalidated for five minutes.

## Acceptance boundary

Repository tests validate canonical/query behavior, locale alternates, noindex rules, JSON-LD schemas, fabricated-review rejection, sitemap completeness/limits/collisions/exclusions, bounded pagination, deterministic feeds, social-card metadata, and an approved-expert present→withdrawn removal simulation. Final SEO/indexation approval still requires a deployed authority mutation, edge purge, crawler recrawl, and named Growth/Web approval at `https://3002.blyss.co.ke`; this task does not deploy, mutate providers, or sign the launch gate.
