/**
 * The hosted storage allowance bridge: what closes task 6's "Included allowance not published
 * yet" once a plan is assigned, without giving a self-hosted install a limit nobody sold it.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hostedStorageAllowanceBytes,
  setHostedStorageAllowanceResolver,
} from '../../../server/fuma/entitlements/storageAllowanceBridge'
import { subscriptionForSignup, effectOf, assumedFundedStorageBytes } from '../../../server/fuma/entitlements/subscription'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const request = (): Request => new Request('https://example.test/admin/api/cms/dashboard/storage')

afterEach(() => {
  // Module-level state: a leftover resolver would give a later test an allowance it never set.
  setHostedStorageAllowanceResolver(null)
})

describe('self-host is byte-for-byte unchanged', () => {
  it('reports NULL with no resolver registered', async () => {
    // A self-hosted install has no plan, so null is its correct and permanent answer - and the
    // surface already renders an unknown allowance honestly rather than as unlimited.
    expect(await hostedStorageAllowanceBytes(request())).toBeNull()
  })
})

describe('a hosted resolver supplies the plan allowance', () => {
  it('reports what the resolver returns', async () => {
    setHostedStorageAllowanceResolver(() => 512 * 1_048_576)
    expect(await hostedStorageAllowanceBytes(request())).toBe(512 * 1_048_576)
  })

  it('accepts an async resolver, because authorising needs a database', async () => {
    setHostedStorageAllowanceResolver(async () => 1_024)
    expect(await hostedStorageAllowanceBytes(request())).toBe(1_024)
  })

  it('receives the REQUEST, so it can tell which tenant is asking', async () => {
    // A zero-argument resolver would answer for the wrong tenant - the same cross-tenant class as
    // the shared site document and the unscoped render cache.
    let seen: string | null = null
    setHostedStorageAllowanceResolver((req) => { seen = new URL(req.url).pathname; return 10 })
    await hostedStorageAllowanceBytes(request())
    expect(seen).toBe('/admin/api/cms/dashboard/storage')
  })
})

describe('a bad allowance is treated as unknown rather than shown', () => {
  it('a THROWING resolver reports null instead of failing the widget', async () => {
    // The dashboard is read-only; failing the whole storage panel because an entitlement lookup
    // was briefly unavailable would replace a known-good usage figure with an error.
    setHostedStorageAllowanceResolver(() => { throw new Error('entitlements unavailable') })
    expect(await hostedStorageAllowanceBytes(request())).toBeNull()
  })

  it('zero is treated as unknown', async () => {
    // Rendering a limit of zero would put every account permanently over its allowance.
    setHostedStorageAllowanceResolver(() => 0)
    expect(await hostedStorageAllowanceBytes(request())).toBeNull()
  })

  it('a negative or non-finite allowance is treated as unknown', async () => {
    setHostedStorageAllowanceResolver(() => -5)
    expect(await hostedStorageAllowanceBytes(request())).toBeNull()
    setHostedStorageAllowanceResolver(() => Number.NaN)
    expect(await hostedStorageAllowanceBytes(request())).toBeNull()
  })
})

describe('the allowance a signup resolves to is the seeded one', () => {
  it('a funded signup carries the starter storage figure', async () => {
    // This is the end-to-end shape: signup -> subscription -> quotas -> the number the bridge
    // would report. It proves the seed and the surface agree on one figure.
    const quotas = effectOf(subscriptionForSignup('org-new'), '2026-03-01T00:00:00.000Z').quotas
    expect(quotas).not.toBeNull()
    setHostedStorageAllowanceResolver(() => quotas!.storageBytes)
    expect(await hostedStorageAllowanceBytes(request())).toBe(quotas!.storageBytes)
  })

  it('that figure matches what the seed declares, not a restatement', () => {
    const seed = readFileSync(join(STUDIO, 'server/fuma/entitlements/planSeed.ts'), 'utf8')
    const starter = seed.slice(seed.indexOf('STARTER_QUOTAS'), seed.indexOf('STUDIO_QUOTAS'))
    expect(starter).toContain('storageBytes: 512 * MB')
    const quotas = effectOf(subscriptionForSignup('org-new'), '2026-03-01T00:00:00.000Z').quotas
    expect(quotas!.storageBytes).toBe(512 * 1_048_576)
  })
})

describe('the storage reader consults the bridge', () => {
  const reader = readFileSync(join(STUDIO, 'server/handlers/cms/dashboard/storage.ts'), 'utf8')

  it('reports limitBytes from the bridge rather than omitting it', () => {
    // Before this the response carried no limit field at all, so the card parsed null every time
    // and permanently rendered "Included allowance not published yet".
    expect(reader).toContain('hostedStorageAllowanceBytes')
    expect(reader).toContain('limitBytes')
  })

  it('passes the request through so the lookup is per-tenant', () => {
    expect(reader).toContain('ctx.request')
  })
})

describe('the resolver is REGISTERED, not merely built', () => {
  const index = readFileSync(join(STUDIO, 'server/index.ts'), 'utf8')

  it('is registered in the hosted composition', () => {
    // Built but unregistered means the fix is inert - the mistake task 20 nearly shipped.
    expect(index).toContain('setHostedStorageAllowanceResolver(')
  })

  it('authorises through the SAME scoped resolution as the site document', () => {
    // An allowance must only be reported for a request that has already proven it may read this
    // tenant. A caller who edits ?siteId= must get null, not another tenant's figure.
    const at = index.indexOf('setHostedStorageAllowanceResolver(')
    const body = index.slice(at, at + 1800)
    expect(body).toContain('createSiteDocumentResolver')
    expect(body).toContain('loadExactSiteAuthorization')
    expect(body).toContain('if (!resolution.ok) return null')
  })
})

describe('the funded assumption is self-limiting', () => {
  it('reports the starter allowance while nothing is chargeable', () => {
    // True today: every seeded plan has checkoutAvailable false, so every hosted tenant genuinely
    // is on the funded starter.
    expect(assumedFundedStorageBytes()).toBe(512 * 1_048_576)
  })

  it('is gated on the same fact that makes it sound', () => {
    // A figure that quietly becomes wrong is worse than one that is absent - the customer would
    // see an allowance they never bought. So the assumption is tied to chargeability rather than
    // left to be remembered.
    const source = readFileSync(join(STUDIO, 'server/fuma/entitlements/subscription.ts'), 'utf8')
    const at = source.indexOf('export function assumedFundedStorageBytes')
    expect(source.slice(at, at + 500)).toContain('reviewChargingReadiness().ready')
  })
})
