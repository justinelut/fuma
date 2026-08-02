import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  TenantCacheIdentitySchema,
  TenantComponentTrustBindingSchema,
  TenantRuntimeContractError,
  TenantRuntimeRatificationSchema,
  tenantCacheKey,
  validateTenantRuntimeRatification,
} from '../contracts'
import { auditTenantRuntimeFixture, TenantRuntimeAuditError } from '../auditor'
import { validTenantRuntimeFixture } from '../fixtures'

type MutableRatification = {
  defaultSite?: string
  hostBindings: Array<Record<string, unknown>>
  cacheIdentities: Array<Record<string, unknown>>
  components: Array<Record<string, unknown>>
}

function clonedRatification(): MutableRatification {
  return structuredClone(validTenantRuntimeFixture().ratification) as unknown as MutableRatification
}

describe('FUMA-SITE-001 fault boundaries', () => {
  test('rejects schema drift and unknown properties at every untyped boundary', () => {
    const ratification = clonedRatification()
    ratification.defaultSite = 'site_alpha'
    expect(Value.Check(TenantRuntimeRatificationSchema, ratification)).toBe(false)
    expect(() => validateTenantRuntimeRatification(ratification)).toThrow(TenantRuntimeContractError)

    const cache = ratification.cacheIdentities[0]
    cache.providerToken = 'forbidden'
    expect(Value.Check(TenantCacheIdentitySchema, cache)).toBe(false)

    const component = ratification.components[0]
    component.jsx = '<ArbitraryServerComponent />'
    expect(Value.Check(TenantComponentTrustBindingSchema, component)).toBe(false)
  })

  test('rejects duplicate hosts and noncanonical cache query identity', () => {
    const duplicate = clonedRatification()
    duplicate.hostBindings[1].host = duplicate.hostBindings[0].host
    expect(() => validateTenantRuntimeRatification(duplicate)).toThrow(expect.objectContaining({ code: 'duplicate-host' }))

    const unsorted = clonedRatification()
    unsorted.cacheIdentities[0].canonicalQuery = 'z=2&a=1'
    expect(() => validateTenantRuntimeRatification(unsorted)).toThrow(expect.objectContaining({ code: 'invalid-contract' }))
    expect(() => tenantCacheKey(unsorted.cacheIdentities[0])).toThrow(expect.objectContaining({ code: 'invalid-contract' }))
  })

  test('separates public and member cache identities', () => {
    const ratification = clonedRatification()
    const publicIdentity = ratification.cacheIdentities[0]
    const memberIdentity = structuredClone(publicIdentity)
    memberIdentity.audience = {
      kind: 'member',
      memberId: 'member_alpha',
      accessFingerprintSha256: '9'.repeat(64),
    }
    expect(tenantCacheKey(publicIdentity)).not.toBe(tenantCacheKey(memberIdentity))
  })

  test('rejects malformed fixture envelopes before scanning untrusted content', () => {
    expect(() => auditTenantRuntimeFixture({ files: 'not-an-array' })).toThrow(TenantRuntimeAuditError)
  })
})
