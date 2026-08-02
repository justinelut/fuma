import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PublicTemplateSchema, PublicTemplatesPageSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import {
  canonicalTemplateFilters,
  exactTemplatePreview,
  installTemplateHref,
  templateSitemapRows,
} from '../lib/templates'

const item = {
  id: 'template_portfolio',
  slug: 'editorial-portfolio',
  name: 'Editorial Portfolio',
  summary: 'A restrained portfolio with accessible navigation and publication-ready article layouts.',
  profiles: ['website', 'publication'],
  capabilities: ['blog', 'forms'],
  industries: ['creative-services'],
  styles: ['editorial', 'minimal'],
  accessibility: {
    standard: 'WCAG 2.2 AA',
    keyboardChecked: true,
    reducedMotionChecked: true,
    highContrastChecked: true,
    notes: ['Landmarks and heading order were reviewed.'],
  },
  releaseId: 'release_portfolio_7',
  previewUrl: 'https://templates.preview.trimly.co.ke/releases/release_portfolio_7/',
  image: {
    url: 'https://templates.preview.trimly.co.ke/releases/release_portfolio_7/assets/cover.webp',
    alt: 'Editorial portfolio home page with project cards.',
    width: 1600,
    height: 900,
    byteSize: 120000,
  },
  sitemapEligible: true,
  approvedAt: '2026-07-27T10:00:00.000Z',
  updatedAt: '2026-07-27T10:00:00.000Z',
} as const

describe('public template discovery presentation', () => {
  test('accepts only the strict approved projection and closed tombstone page', () => {
    expect(Value.Check(PublicTemplateSchema, item)).toBe(true)
    expect(Value.Check(PublicTemplateSchema, { ...item, ownerId: 'private' })).toBe(false)
    expect(Value.Check(PublicTemplateSchema, { ...item, imageUrl: item.image.url })).toBe(false)
    expect(Value.Check(PublicTemplatesPageSchema, {
      items: [item],
      tombstones: [],
      page: { hasMore: false, nextCursor: null },
    })).toBe(true)
    expect(Value.Check(PublicTemplatesPageSchema, {
      items: [],
      tombstones: [{ id: item.id, slug: item.slug, withdrawnAt: '2026-07-27T11:00:00.000Z', privateReason: 'forbidden' }],
      page: { hasMore: false, nextCursor: null },
    })).toBe(false)
  })

  test('requires the isolated host, exact release root and matching budgeted release image', () => {
    expect(exactTemplatePreview(item)).toBe(true)
    expect(exactTemplatePreview({ ...item, previewUrl: 'https://trimly.co.ke/templates/editorial-portfolio' })).toBe(false)
    expect(exactTemplatePreview({ ...item, previewUrl: 'https://sample.preview.trimly.co.ke/releases/release_portfolio_7/' })).toBe(false)
    expect(exactTemplatePreview({ ...item, previewUrl: `${item.previewUrl}?draft=1` })).toBe(false)
    expect(exactTemplatePreview({ ...item, image: { ...item.image, url: 'https://templates.preview.trimly.co.ke/releases/other/assets/cover.webp' } })).toBe(false)
    expect(exactTemplatePreview({ ...item, image: { ...item.image, byteSize: 300001 } })).toBe(false)
  })

  test('canonicalizes only approved discovery filters and stable-ID handoff fields', () => {
    expect(canonicalTemplateFilters({ profile: 'publication', capability: 'blog', industry: 'creative-services', style: 'minimal', ignored: 'private' })).toEqual({
      profile: 'publication', capability: 'blog', industry: 'creative-services', style: 'minimal',
    })
    expect(canonicalTemplateFilters({ profile: 'private', capability: ['blog'], cursor: 'bad cursor' })).toEqual({})
    expect(installTemplateHref(item.id)).toBe('/start?kind=use_template&source=template&templateId=template_portfolio')
    expect(installTemplateHref(item.id)).not.toContain('release')
  })

  test('sitemap eligibility disappears with withdrawn or stale projection records', () => {
    expect(templateSitemapRows([item])).toEqual([{ path: '/templates/editorial-portfolio', lastModified: item.updatedAt }])
    expect(templateSitemapRows([])).toEqual([])
    expect(templateSitemapRows([{ ...item, previewUrl: 'https://templates.preview.trimly.co.ke/releases/stale/' }])).toEqual([])
  })

  test('template pages retain semantic, responsive and accessibility behavior without shared UI imports', () => {
    const index = readFileSync(path.join(import.meta.dir, '../app/templates/page.tsx'), 'utf8')
    const detail = readFileSync(path.join(import.meta.dir, '../app/templates/[slug]/page.tsx'), 'utf8')
    expect(index).toContain('sm:grid-cols-2')
    expect(index).toContain('lg:grid-cols-3')
    expect(index).toContain('aria-label="Capability"')
    expect(index).toContain('alt={item.image.alt}')
    expect(detail).toContain('sm:text-5xl')
    expect(detail).toContain('aria-labelledby="template-accessibility"')
    expect(detail).toContain('item.accessibility.notes')
    expect(index + detail).not.toContain('@ui/')
    expect(index + detail).not.toContain('zod')
  })
})
