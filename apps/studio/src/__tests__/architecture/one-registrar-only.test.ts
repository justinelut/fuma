import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One registrar, and a core that does not know its name.
 *
 * Two rules, and they pull in opposite directions on purpose:
 *
 *   1. **OpenProvider is the only registrar.** No second vendor may be integrated,
 *      because two registrars means two sets of credentials, two failure modes and two
 *      renewal pipelines for no product benefit.
 *   2. **The registrar core must not name any vendor.** Provider specifics live behind
 *      the gateway seam, so switching or adding one later is an adapter change rather
 *      than a rewrite of the purchase workflow.
 *
 * Together they mean: OpenProvider is the only adapter we build, and it lives outside
 * `server/fuma/registrar/`. Rule 2 is what makes rule 1 cheap to revisit if the
 * commercial relationship ever changes.
 */

const ROOT = join(import.meta.dir, '../../..')
const REGISTRAR_CORE = join(ROOT, 'server/fuma/registrar')

/** Vendors that must not appear anywhere. OpenProvider is deliberately absent. */
const EXCLUDED_REGISTRARS = [
  'godaddy', 'namecheap', 'enom', 'opensrs', 'resellerclub',
  'porkbun', 'gandi', 'dynadot', 'hover', 'name.com',
] as const

function coreSources(): string {
  return readdirSync(REGISTRAR_CORE)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(REGISTRAR_CORE, file), 'utf8'))
    .join('\n')
}

describe('one registrar only', () => {
  const core = coreSources()

  it('names no excluded registrar in the registrar core', () => {
    // Each listed explicitly rather than as a loose pattern, so adding a vendor
    // requires deleting a name from this list — a visible, reviewable act.
    for (const vendor of EXCLUDED_REGISTRARS) {
      expect(core.toLowerCase()).not.toContain(vendor)
    }
  })

  it('does not name OpenProvider in the core either', () => {
    // The chosen vendor is still a vendor. Naming it here would put provider
    // specifics inside the workflow, which is what the gateway seam exists to avoid.
    expect(core.toLowerCase()).not.toContain('openprovider')
  })

  it('keeps a provider-neutral gateway seam for an adapter to implement', () => {
    // The seam is what lets exactly one adapter exist outside this directory.
    expect(core).toContain('RegistrarGatewayHttpClient')
    expect(core).toContain('AuthorizedRegistrarProvider')
  })

  it('routes every provider call through that seam', () => {
    // If the workflow called a vendor API directly, the seam would be decorative.
    for (const operation of ['search', 'quote', 'purchase', 'renew']) {
      expect(core).toContain(operation)
    }
  })
})

describe('margin is modelled without naming a vendor', () => {
  const margin = readFileSync(join(REGISTRAR_CORE, 'margin.ts'), 'utf8')

  it('models wholesale cost against retail price', () => {
    // Reselling only earns if the difference is deliberate and recorded.
    expect(margin).toContain('WholesaleCost')
    expect(margin).toContain('RetailPrice')
    expect(margin).toContain('marginMinor')
  })

  it('records both figures on a sale', () => {
    // Storing only the price would let a later cost change rewrite historical margin.
    expect(margin).toContain('SaleMarginRecord')
    expect(margin).toContain('costMinor')
  })

  it('refuses to price below cost rather than clamping quietly', () => {
    expect(margin).toContain('below-cost')
  })

  it('prices renewal from the renewal cost, not the registration cost', () => {
    // Registrars sell a first year cheaply and charge more to renew.
    expect(margin).toContain('renewalCostMinor')
  })

  it('names no vendor', () => {
    for (const vendor of [...EXCLUDED_REGISTRARS, 'openprovider']) {
      expect(margin.toLowerCase()).not.toContain(vendor)
    }
  })
})

describe('the two acquisition paths are distinguished', () => {
  const path = readFileSync(
    join(ROOT, 'server/fuma/domains/acquisitionPath.ts'), 'utf8')

  it('separates registering from connecting', () => {
    expect(path).toContain("Literal('register')")
    expect(path).toContain("Literal('connect')")
  })

  it('treats an unreachable registry as its own state', () => {
    // Not as taken (which loses a sale) and not as available (which takes money for a
    // domain we cannot register).
    expect(path).toContain("Literal('unknown')")
  })

  it('refuses to quote a domain somebody already owns', () => {
    expect(path).toContain('not-for-sale')
    expect(path).toContain('quotable')
  })

  it('states that we cannot write DNS on the connect path', () => {
    expect(path).toContain('canWriteDnsRecords')
    expect(path).toContain('weControlDns')
  })
})

describe('exactly one adapter, and it lives outside the core', () => {
  const ADAPTERS = join(ROOT, 'server/fuma/registrarAdapters')

  it('keeps the adapter directory outside the guarded core', () => {
    // The core forbids vendor names, so an adapter cannot live there. Putting it
    // beside the core keeps both rules satisfiable at once.
    expect(existsSync(ADAPTERS)).toBe(true)
    expect(existsSync(join(REGISTRAR_CORE, 'openProvider.ts'))).toBe(false)
  })

  it('contains exactly one adapter', () => {
    // Two adapters means two credential sets, two failure modes and two renewal
    // pipelines for no product benefit.
    const adapters = readdirSync(ADAPTERS).filter((file) => file.endsWith('.ts'))
    expect(adapters).toEqual(['openProvider.ts'])
  })

  it('implements the provider seam the workflow already depends on', () => {
    // So the workflow's idempotency, ambiguity and step-up guarantees apply unchanged.
    const adapter = readFileSync(join(ADAPTERS, 'openProvider.ts'), 'utf8')
    expect(adapter).toContain('implements AuthorizedRegistrarProvider')
    for (const method of [
      'search', 'quote', 'purchase', 'lookupPurchase', 'renew', 'lookupRenewal',
    ]) {
      expect(adapter).toContain(method)
    }
  })

  it('validates every response against the core’s own schemas', () => {
    // A vendor field rename must surface at the boundary, not as a malformed quote
    // inside the purchase workflow.
    const adapter = readFileSync(join(ADAPTERS, 'openProvider.ts'), 'utf8')
    expect(adapter).toContain('safeParseValue')
    expect(adapter).toContain('RegistrarQuoteSchema')
    expect(adapter).toContain('RegistrarPurchaseProviderResultSchema')
  })

  it('does not name a competing registrar even in the adapter', () => {
    const adapter = readFileSync(join(ADAPTERS, 'openProvider.ts'), 'utf8').toLowerCase()
    for (const vendor of EXCLUDED_REGISTRARS) {
      expect(adapter).not.toContain(vendor)
    }
  })

  it('distinguishes "could not ask" from "did not happen"', () => {
    // Collapsing them is how a domain gets registered twice.
    const adapter = readFileSync(join(ADAPTERS, 'openProvider.ts'), 'utf8')
    expect(adapter).toContain('lookupPurchase')
    expect(adapter).toMatch(/registered twice|positively reports nothing/)
  })
})
