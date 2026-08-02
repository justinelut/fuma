import { describe, expect, test } from 'bun:test'
import { auditTenantRuntimeFixture, type SiteRuntimeGateRuleId } from '../auditor'
import { hostileTenantRuntimeFixtures } from '../fixtures'

function rules(value: unknown): SiteRuntimeGateRuleId[] {
  return [...new Set(auditTenantRuntimeFixture(value).map(({ ruleId }) => ruleId))]
}

describe('FUMA-SITE-001 hostile security gates', () => {
  test.each(hostileTenantRuntimeFixtures())('independently rejects $ruleId', ({ ruleId, fixture }) => {
    expect(rules(fixture)).toEqual([ruleId])
  })

  test('returns byte-stable findings without leaking fixture payloads', () => {
    const fixture = hostileTenantRuntimeFixtures().find(({ ruleId }) => ruleId === 'direct-authority')!.fixture
    const first = auditTenantRuntimeFixture(fixture)
    const second = auditTenantRuntimeFixture(fixture)
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('DATABASE_URL')
  })
})
