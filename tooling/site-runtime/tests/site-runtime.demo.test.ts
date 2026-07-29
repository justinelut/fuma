import { describe, expect, test } from 'bun:test'
import {
  FixtureTenantRuntimeAuthority,
  assertCacheIdentityForResolution,
  tenantCacheKey,
} from '../contracts'
import { VALID_TENANT_RUNTIME_RATIFICATION } from '../fixtures'

describe('FUMA-SITE-001 exact-host demo', () => {
  test('resolves the same route on two hosts to distinct immutable releases', () => {
    const authority = new FixtureTenantRuntimeAuthority(VALID_TENANT_RUNTIME_RATIFICATION.hostBindings)
    const alpha = authority.resolve('ALPHA.FUMA.CO.KE:443', '/colliding-route')
    const beta = authority.resolve('customer.example.', '/colliding-route')

    expect(alpha.route).toBe(beta.route)
    expect(alpha).toMatchObject({ host: 'alpha.fuma.co.ke', siteId: 'site_alpha', releaseId: 'release_alpha_17' })
    expect(beta).toMatchObject({ host: 'customer.example', siteId: 'site_beta', releaseId: 'release_beta_23' })
    expect(alpha.releaseHashSha256).not.toBe(beta.releaseHashSha256)

    const alphaCache = assertCacheIdentityForResolution(VALID_TENANT_RUNTIME_RATIFICATION.cacheIdentities[0], alpha)
    const betaCache = assertCacheIdentityForResolution(VALID_TENANT_RUNTIME_RATIFICATION.cacheIdentities[1], beta)
    expect(tenantCacheKey(alphaCache)).not.toBe(tenantCacheKey(betaCache))
  })

  test('rejects unknown host without a default tenant', () => {
    const authority = new FixtureTenantRuntimeAuthority(VALID_TENANT_RUNTIME_RATIFICATION.hostBindings)
    expect(() => authority.resolve('unknown.fuma.co.ke', '/colliding-route')).toThrow(expect.objectContaining({ code: 'unknown-host' }))
  })

  test('rejects a cross-tenant cache identity', () => {
    const authority = new FixtureTenantRuntimeAuthority(VALID_TENANT_RUNTIME_RATIFICATION.hostBindings)
    const beta = authority.resolve('customer.example', '/colliding-route')
    expect(() => assertCacheIdentityForResolution(VALID_TENANT_RUNTIME_RATIFICATION.cacheIdentities[0], beta)).toThrow(expect.objectContaining({ code: 'cross-tenant-cache' }))
  })
})
