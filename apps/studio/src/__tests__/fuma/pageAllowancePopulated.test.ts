/**
 * Tests that the builder's page limit is actually POPULATED, which is what task 68 left open.
 *
 * Task 68 wired the check at all three page-creation paths and proved the refusal fires. But nothing
 * ever called `setActivePageAllowance`, so in production the carrier was always null, every limit read
 * as unknown, and the free tier's one-page rule could not fire. A limit nothing populates is not a
 * limit - the same inert-fix class as tasks 20 and 52.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openBuilderSession } from '@core/fuma/builder/builderSessionClient'
import { activePageAllowance, setActivePageAllowance } from '@core/fuma/builder/pageAllowance'
import { pageAllowanceForSlug } from '../../../server/fuma/entitlements/planSeed'

const STUDIO = join(import.meta.dir, '..', '..', '..')

/** A schema-valid CmsCurrentUser, because apiRequest validates the envelope it receives. */
const user = {
  id: 'user-1', email: 'a@example.com', displayName: 'Ada', status: 'active',
  capabilities: [],
  role: {
    id: 'role-1', slug: 'owner', name: 'Owner', description: '', isSystem: true,
    capabilities: [],
  },
  lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, passwordUpdatedAt: null,
  mfaEnabled: false, mfaEnabledAt: null, mfaRecoveryCodesRemaining: 0,
  stepUpAuthMode: 'required', stepUpWindowMinutes: 15,
  avatarMediaId: null, avatarUrl: null, gravatarHash: 'abc123',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

const scope = { organizationId: 'org-1', workspaceId: 'ws-1', siteId: 'site-1' }

function respondWith(body: unknown, status = 200): typeof fetch {
  // The server returns the envelope directly rather than wrapped, which is what apiRequest
  // validates against. A wrapped body fails with "/data: Unexpected property".
  return (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

// Leftover module state would give a later test an allowance it never asked for.
afterEach(() => { setActivePageAllowance(null) })

describe('the builder session populates the page allowance', () => {
  it('records the limit the server sent, so the free tier can refuse a second page', async () => {
    const result = await openBuilderSession(scope, respondWith({
      user, publicOrigin: null, pageAllowance: { limit: 1, planName: 'Starter' },
    }))
    expect(result.kind).toBe('ready')
    expect(activePageAllowance().limit).toBe(1)
    expect(activePageAllowance().planName).toBe('Starter')
  })

  it('leaves the limit UNKNOWN when the envelope omits it, which allows the page', async () => {
    const result = await openBuilderSession(scope, respondWith({ user, publicOrigin: null }))
    expect(result.kind).toBe('ready')
    // Self-host has no plan. Refusing because we could not resolve one would break the product for
    // everybody in the one place it exists to be used; over-allowing is reconcilable afterwards.
    expect(activePageAllowance().limit).toBeNull()
  })

  it('does NOT record an allowance when the exchange was refused', async () => {
    setActivePageAllowance(null)
    const result = await openBuilderSession(scope, respondWith({ error: 'no' }, 403))
    expect(result.kind).toBe('forbidden')
    // Recording a limit from a refused exchange would let the builder claim a plan the server never
    // granted - the same rule the scope already follows.
    expect(activePageAllowance().limit).toBeNull()
  })
})

describe('the number comes from the seed, not from a restatement', () => {
  it('the starter allowance is one page', () => {
    const allowance = pageAllowanceForSlug('starter')
    expect(allowance).not.toBeNull()
    // Per user direction: the free tier is one page, and it lives in the seed so the builder and the
    // billing layer cannot disagree about what free includes.
    expect(allowance!.limit).toBe(1)
  })

  it('an unknown slug reports null rather than a default', () => {
    // Showing one plan's allowance for another is wrong in a way nobody can see.
    expect(pageAllowanceForSlug('does-not-exist')).toBeNull()
  })
})

describe('the server supplies it, so the carrier is not populated only in tests', () => {
  it('the builder session boundary accepts an allowance resolver', () => {
    const identity = readFileSync(join(STUDIO, 'server/fuma/builder/builderIdentity.ts'), 'utf8')
    expect(identity).toContain('resolvePageAllowance')
    // Omitted rather than sent as null when absent, so a self-hosted envelope is byte-for-byte
    // what it was before this wiring.
    expect(identity).toContain('pageAllowance === null ? {} : { pageAllowance }')
  })

  it('the server registers a resolver and gates it on charging readiness', () => {
    const index = readFileSync(join(STUDIO, 'server/index.ts'), 'utf8')
    expect(index).toContain('resolvePageAllowance:')
    expect(index).toContain("pageAllowanceForSlug('starter')")
    // Self-limiting: once any plan is chargeable the assumed figure stops being true, so it must
    // return null and force a real assignment lookup rather than quietly becoming wrong.
    expect(index).toContain('reviewChargingReadiness().ready) return null')
  })
})
