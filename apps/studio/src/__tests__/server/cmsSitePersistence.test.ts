import { describe, expect, it } from 'bun:test'
import type { SiteShell } from '@core/page-tree'
import { SiteValidationError } from '@core/persistence/validate'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import type { DbResult } from '../../../server/db'
import {
  getDraftSite,
  saveDraftSite,
} from '../../../server/repositories/site'
import { SELF_HOST_SITE_ID } from '../../../server/selfHost'
import { createFakeDb } from './dbTestFake'

function createSiteFakeDb() {
  const sites = new Map<string, Record<string, unknown>>()
  const state = {
    sites,
    get site(): Record<string, unknown> | null {
      return sites.get(SELF_HOST_SITE_ID) ?? null
    },
  }

  const db = createFakeDb(async (rawSql, params): Promise<DbResult> => {
    const sql = rawSql.replace(/\s+/g, ' ').trim().toLowerCase()

    if (sql.startsWith('insert into site')) {
      const siteId = String(params[0])
      sites.set(siteId, {
        id: siteId,
        name: params[1],
        settings_json: params[2],
        created_at: new Date('2026-01-01').toISOString(),
        updated_at: new Date('2026-01-02').toISOString(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('select id, name, settings_json')) {
      const site = sites.get(String(params[0]))
      return {
        rows: site ? [site] : [],
        rowCount: site ? 1 : 0,
      }
    }
    throw new Error(`Unhandled SQL: ${rawSql}`)
  })

  return { state, db }
}

function validShell(overrides: Partial<SiteShell> = {}): SiteShell {
  return {
    id: 'project_1',
    name: 'Example Site',
    files: [],
    visualComponents: [],
    packageJson: {
      dependencies: {},
      devDependencies: {},
    },
    runtime: normalizeSiteRuntimeConfig(undefined),
    breakpoints: [
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    settings: {
      metaTitle: 'Example',
      shortcuts: {},
    },
    styleRules: {
      class_1: {
        id: 'class_1',
        name: 'Hero',
        kind: 'class',
        selector: '.Hero',
        order: 0,
        styles: { color: 'red' },
        contextStyles: {},
        createdAt: 1,
        updatedAt: 2,
      },
    },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

describe('CMS draft site persistence', () => {
  it('saves the site shell and loads it back', async () => {
    const { state, db } = createSiteFakeDb()
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell(), 'user_1')

    expect(state.site).toMatchObject({ name: 'Example Site' })
    expect(state.site?.settings_json).toMatchObject({
      cmsSiteSchemaVersion: 1,
      site: {
        id: 'project_1',
        settings: { metaTitle: 'Example' },
        styleRules: { class_1: { name: 'Hero' } },
      },
    })
  })

  it('selects and writes only the requested site row', async () => {
    const { db } = createSiteFakeDb()
    const secondarySiteId = 'secondary-site'
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell({ name: 'Primary Site' }))
    await saveDraftSite(db, secondarySiteId, validShell({ name: 'Secondary Site' }))

    expect((await getDraftSite(db, SELF_HOST_SITE_ID))?.name).toBe('Primary Site')
    expect((await getDraftSite(db, secondarySiteId))?.name).toBe('Secondary Site')
    expect(await getDraftSite(db, 'missing-site')).toBeNull()
  })

  it('loads a saved draft site without reading pages (shell-only)', async () => {
    const { db } = createSiteFakeDb()
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell(), 'user_1')

    const loaded = await getDraftSite(db, SELF_HOST_SITE_ID)

    expect(loaded).toMatchObject({
      id: 'project_1',
      name: 'Example Site',
      settings: { metaTitle: 'Example' },
      styleRules: { class_1: { name: 'Hero' } },
    })
    // Shell does not include pages — pages live in data_rows
    expect((loaded as Record<string, unknown> | null)?.pages).toBeUndefined()
  })

  it('round-trips reusable CSS conditions in the site shell', async () => {
    const { db } = createSiteFakeDb()
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell({
      conditions: [
        {
          id: 'media:(min-width: 1200px)',
          label: '(min-width: 1200px)',
          condition: { kind: 'media', query: '(min-width: 1200px)' },
        },
      ],
      styleRules: {
        class_1: {
          id: 'class_1',
          name: 'd-xl-block',
          kind: 'class',
          selector: '.d-xl-block',
          order: 0,
          styles: {},
          contextStyles: {
            'media:(min-width: 1200px)': { display: 'block' },
          },
          createdAt: 1,
          updatedAt: 2,
        },
      },
    }), 'user_1')

    const loaded = await getDraftSite(db, SELF_HOST_SITE_ID)

    expect(loaded?.conditions).toEqual([
      {
        id: 'media:(min-width: 1200px)',
        label: '(min-width: 1200px)',
        condition: { kind: 'media', query: '(min-width: 1200px)' },
      },
    ])
    expect(loaded?.styleRules.class_1.contextStyles).toHaveProperty('media:(min-width: 1200px)')
  })

  it('validates the stored shell and throws SiteValidationError on corrupt data', async () => {
    const { state, db } = createSiteFakeDb()
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell(), 'user_1')

    // Corrupt a breakpoint: inject an invalid width type.
    // readStoredShell passes arrays through as-is, so this reaches validateSite
    // intact. parseSiteDocument then rejects it and throws SiteValidationError.
    const payload = state.site?.settings_json as Record<string, unknown>
    const site = payload.site as Record<string, unknown>
    site.breakpoints = [{ id: 'desktop', label: 'Desktop', width: 'not-a-number', icon: 'monitor' }]

    await expect(getDraftSite(db, SELF_HOST_SITE_ID)).rejects.toThrow(SiteValidationError)
  })

  it('round-trips site runtime settings in the site shell', async () => {
    const { db } = createSiteFakeDb()
    await saveDraftSite(db, SELF_HOST_SITE_ID, validShell({
      runtime: normalizeSiteRuntimeConfig({
        scripts: {
          script_1: {
            placement: 'head',
            priority: 10,
          },
        },
      }),
    }))

    const loaded = await getDraftSite(db, SELF_HOST_SITE_ID)

    expect(loaded?.runtime?.scripts.script_1).toMatchObject({
      placement: 'head',
      priority: 10,
    })
  })
})
