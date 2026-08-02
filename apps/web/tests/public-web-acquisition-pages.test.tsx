import { describe, expect, test } from 'bun:test'
import claimsSource from '../content/public/claims.json'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import AboutPage, { metadata as aboutMetadata } from '../app/about/page'
import FeaturesPage, { metadata as featuresMetadata } from '../app/features/page'
import HomePage, { metadata as homeMetadata } from '../app/page'
import PublicationPage, { metadata as publicationMetadata } from '../app/publication/page'
import SolutionsPage, { metadata as solutionsMetadata } from '../app/solutions/page'
import WebsitePage, { metadata as websiteMetadata } from '../app/website/page'
import { SiteShell } from '../components/site-shell'
import {
  ACQUISITION_PATHS,
  ACQUISITION_ROUTE_CONTRACT,
  approvedClaim,
  type AcquisitionPath,
} from '../lib/acquisition-content'

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..')
const ROUTES = {
  '/': { Page: HomePage, metadata: homeMetadata },
  '/website': { Page: WebsitePage, metadata: websiteMetadata },
  '/publication': { Page: PublicationPage, metadata: publicationMetadata },
  '/features': { Page: FeaturesPage, metadata: featuresMetadata },
  '/solutions': { Page: SolutionsPage, metadata: solutionsMetadata },
  '/about': { Page: AboutPage, metadata: aboutMetadata },
} satisfies Record<AcquisitionPath, { Page: () => React.ReactNode; metadata: typeof homeMetadata }>

function renderedLinks(html: string): Set<string> {
  return new Set(Array.from(html.matchAll(/href="([^"]+)"/g), (match) => match[1]!.replaceAll('&amp;', '&')))
}

describe('core acquisition page contracts', () => {
  test('keeps every claim unique, reviewed, evidenced and sourced from the approved inventory', () => {
    expect(new Set(claimsSource.map(({ id }) => id)).size).toBe(claimsSource.length)
    for (const claim of claimsSource) {
      expect(Date.parse(claim.reviewAt)).toBeGreaterThan(Date.now())
      expect(existsSync(path.join(REPOSITORY_ROOT, claim.evidence))).toBe(true)
      expect(approvedClaim(claim.id as Parameters<typeof approvedClaim>[0])).toEqual(claim)
    }
    expect(approvedClaim('kenya-context').statement).toContain('en-KE, Africa/Nairobi and KES')
    expect(approvedClaim('kenya-context').statement).toContain('only when approved pricing authority is available')
  })

  for (const route of ACQUISITION_PATHS) {
    test(`${route} has its canonical, required links, claims and semantic document structure`, () => {
      const entry = ROUTES[route]
      const contract = ACQUISITION_ROUTE_CONTRACT[route]
      const html = renderToStaticMarkup(<SiteShell><entry.Page /></SiteShell>)
      const links = renderedLinks(html)

      expect(entry.metadata.alternates?.canonical).toBe(contract.canonical)
      expect(entry.metadata.alternates?.languages).toEqual({
        'en-KE': contract.canonical,
        'x-default': contract.canonical,
      })
      for (const href of contract.links) expect(links.has(href)).toBe(true)
      for (const claimId of contract.claims) expect(html).toContain(`data-claim-id="${claimId}"`)

      expect(html.match(/<main\b/g)).toHaveLength(1)
      expect(html.match(/<h1\b/g)).toHaveLength(1)
      expect(html.match(/<h2\b/g)?.length ?? 0).toBeGreaterThan(0)
      expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('<h2'))
      expect(html).not.toMatch(/profile\s*===|profile\s*!==/)
    })
  }

  test('Website and Publication media are labelled real product captures rather than availability evidence', () => {
    for (const Page of [WebsitePage, PublicationPage]) {
      const html = renderToStaticMarkup(<Page />)
      // Product imagery is now real captures of the running Studio rather than a hand-drawn SVG
      // mockup, so this asserts the enduring intent: every shot is a labelled figure, sourced from
      // the committed product captures, and never implies live availability or customer content.
      expect(html).toContain('<figure')
      expect(html).toContain('<figcaption')
      expect(html).toContain('src="/product/')
      for (const shot of html.matchAll(/<img[^>]*src="\/product\/[^>]*>/g)) {
        expect(shot[0]).toMatch(/alt="[^"]+"/)
      }
      expect(html).not.toMatch(/\b(uptime|99\.9|always online|guaranteed availability)\b/i)
    }
  })
})
