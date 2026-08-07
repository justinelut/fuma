/**
 * Task 68: enforce plan limits inside the visual builder.
 *
 * The number comes from the seeded plan (task 66). What is tested here is the DECISION and that
 * every path which creates a page consults it - a limit enforced at one of three buttons is not
 * a limit.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decidePageCreation,
  inventoryOf,
  reviewPageCreation,
  setActivePageAllowance,
  activePageAllowance,
  shouldWarnBeforeLimit,
} from '../../core/fuma/builder/pageAllowance'

const STUDIO = join(import.meta.dir, '..', '..', '..')

afterEach(() => {
  // Module-level state: a leftover allowance would give a later test a limit it never set.
  setActivePageAllowance(null)
})

describe('the free tier is one page', () => {
  it('allows the first page', () => {
    const verdict = decidePageCreation({ addressablePages: 0, postTemplates: 0 }, { limit: 1, planName: 'Starter' })
    expect(verdict.allowed).toBe(true)
    expect(verdict.reason).toBe('within-allowance')
  })

  it('refuses the second', () => {
    const verdict = decidePageCreation({ addressablePages: 1, postTemplates: 0 }, { limit: 1, planName: 'Starter' })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('at-limit')
  })

  it('names the plan and the way out rather than only the bound', () => {
    // "Page limit reached" alone leaves somebody unable to tell a bug from a bound, and the
    // commonest next move is to try again.
    const verdict = decidePageCreation({ addressablePages: 1, postTemplates: 0 }, { limit: 1, planName: 'Starter' })
    expect(verdict.message).toContain('Starter')
    expect(verdict.message).toContain('Upgrade')
  })

  it('uses singular wording for a limit of one', () => {
    // "includes 1 pages" reads as a bug in the product, and this is the exact sentence the free
    // tier shows every time somebody tries to add their second page.
    const verdict = decidePageCreation({ addressablePages: 1, postTemplates: 0 }, { limit: 1, planName: 'Starter' })
    expect(verdict.message).toContain('1 page.')
    expect(verdict.message).not.toContain('1 pages')
  })

  it('uses plural wording above one', () => {
    const verdict = decidePageCreation({ addressablePages: 5, postTemplates: 0 }, { limit: 5, planName: 'Studio' })
    expect(verdict.message).toContain('5 pages')
  })
})

describe('an unknown limit ALLOWS, which is the opposite of how it is displayed', () => {
  it('allows when the plan could not be resolved', () => {
    // Over-allowing is a billing discrepancy that can be reconciled afterwards. BLOCKING is not
    // recoverable - the work does not happen - and it would break the product for paying
    // customers during an entitlements outage, in the one place the product exists to be used.
    const verdict = decidePageCreation({ addressablePages: 99, postTemplates: 0 }, { limit: null, planName: null })
    expect(verdict.allowed).toBe(true)
    expect(verdict.reason).toBe('no-limit-known')
  })

  it('says nothing rather than filling the space', () => {
    // A notice that always says something trains people to stop reading it.
    expect(decidePageCreation({ addressablePages: 0, postTemplates: 0 }, { limit: null, planName: null }).message).toBeNull()
  })

  it('reports no usage figures, so a caller cannot render "1 of null"', () => {
    expect(decidePageCreation({ addressablePages: 3, postTemplates: 0 }, { limit: null, planName: null }).usage).toBeNull()
  })

  it('self-host has no carrier set, so it is unlimited by default', () => {
    // Null by default means a self-hosted install behaves exactly as it did before this file
    // existed. Somebody running their own server is not ours to ration.
    expect(activePageAllowance().limit).toBeNull()
    expect(reviewPageCreation([{}, {}, {}, {}]).allowed).toBe(true)
  })
})

describe('a post template does not spend the page allowance', () => {
  it('counts templates separately from addressable pages', () => {
    const inventory = inventoryOf([{}, { template: { enabled: true } }, {}])
    expect(inventory.addressablePages).toBe(2)
    expect(inventory.postTemplates).toBe(1)
  })

  it('so a free tier with one page and a template is still at exactly its limit', () => {
    // Charging the template would make a free tier of one page become ZERO pages the moment
    // somebody uses a post type - a limit nobody could predict from the number they were shown.
    const inventory = inventoryOf([{}, { template: { enabled: true } }])
    const verdict = decidePageCreation(inventory, { limit: 1, planName: 'Starter' })
    expect(inventory.addressablePages).toBe(1)
    expect(verdict.allowed).toBe(false)
  })

  it('a template flagged DISABLED counts as an addressable page', () => {
    // This is the discrepancy worth recording. The explorer splits on `!page.template` (the
    // object being present at all) while core/loops/sources/sitePages.ts splits on
    // `template?.enabled === true`. Those disagree for `template: { enabled: false }`. The count
    // follows the loop source, so the limit enforces at the same total the publisher renders.
    expect(inventoryOf([{ template: { enabled: false } }]).addressablePages).toBe(1)
  })

  it('an empty site counts as zero, not as one', () => {
    expect(inventoryOf([]).addressablePages).toBe(0)
  })
})

describe('the warning arrives at the last page, not partway', () => {
  it('warns when one page remains', () => {
    expect(shouldWarnBeforeLimit({ addressablePages: 4, postTemplates: 0 }, { limit: 5, planName: 'Studio' })).toBe(true)
  })

  it('does not warn with room to spare', () => {
    // A warning at half the allowance is noise, and on a larger plan it arrives long before
    // there is any decision to make.
    expect(shouldWarnBeforeLimit({ addressablePages: 1, postTemplates: 0 }, { limit: 5, planName: 'Studio' })).toBe(false)
  })

  it('never warns when no limit is known', () => {
    expect(shouldWarnBeforeLimit({ addressablePages: 9, postTemplates: 0 }, { limit: null, planName: null })).toBe(false)
  })
})

describe('EVERY creation path consults the limit', () => {
  const executor = readFileSync(join(STUDIO, 'src/admin/pages/site/agent/executor.ts'), 'utf8')
  const explorer = readFileSync(join(STUDIO, 'src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerPanel.tsx'), 'utf8')

  it('the AI add-page tool consults it', () => {
    // The AI is the path that adds pages fastest, so a limit it can walk past is not a limit.
    const index = executor.indexOf('function runAddPage')
    expect(index).toBeGreaterThan(-1)
    expect(executor.slice(index, index + 600)).toContain('reviewPageCreation')
  })

  it('the AI duplicate-page tool consults it', () => {
    // Duplicating is adding. Exempting it makes the limit avoidable by copying rather than
    // creating - the same page count reached by a different verb.
    const index = executor.indexOf('duplicatePage(input.pageId')
    expect(index).toBeGreaterThan(-1)
    expect(executor.slice(Math.max(0, index - 700), index)).toContain('reviewPageCreation')
  })

  it('the explorer consults it', () => {
    expect(explorer).toContain('reviewPageCreation')
  })

  it('the explorer checks BEFORE calling addPage, not after', () => {
    // Creating then removing would leave the page in undo history for somebody to restore, and
    // the limit would read as a bug that ate their work. Asserted by position rather than
    // trusted, because running afterwards is the easy mistake to make later.
    const check = explorer.indexOf('reviewPageCreation')
    const create = explorer.indexOf('addPage(name,')
    expect(check).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(check)
  })

  it('the explorer SHOWS the refusal rather than throwing it away', () => {
    // The panel's catch only reaches the console, so a thrown refusal would close the dialog and
    // tell the person nothing at all - the silent failure this whole exercise exists to remove.
    expect(explorer).toContain('setLimitNotice')
    expect(explorer).toContain('role="status"')
  })
})

describe('the seeded plan supplies the number', () => {
  it('the free tier in the seed is one page, so the builder and billing agree', () => {
    // Read from the seed source rather than restated here: two copies of the free-tier number
    // would let the builder enforce one figure while billing promises another.
    const seed = readFileSync(join(STUDIO, 'server/fuma/entitlements/planSeed.ts'), 'utf8')
    const starter = seed.slice(seed.indexOf('STARTER_QUOTAS'), seed.indexOf('STUDIO_QUOTAS'))
    expect(starter).toMatch(/pages:\s*1,/)
  })

  it('an allowance set on the carrier is what the review uses', () => {
    setActivePageAllowance({ limit: 1, planName: 'Starter' })
    expect(reviewPageCreation([{}]).allowed).toBe(false)
    expect(reviewPageCreation([]).allowed).toBe(true)
  })
})
