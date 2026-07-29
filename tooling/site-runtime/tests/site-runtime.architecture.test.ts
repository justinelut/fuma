import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import {
  TenantRuntimeApplicationContractSchema,
  TenantRuntimeCompatibilityContractSchema,
  TenantRuntimeRatificationSchema,
  validateTenantRuntimeRatification,
} from '../contracts'
import { auditTenantRuntimeFixture, SITE_RUNTIME_GATE_RULE_IDS } from '../auditor'
import { hostileTenantRuntimeFixtures, validTenantRuntimeFixture } from '../fixtures'

const ROOT = join(import.meta.dir, '../../..')

describe('FUMA-SITE-001 architecture ratification', () => {
  test('accepts one complete multi-tenant Next App Router future fixture', () => {
    const fixture = validTenantRuntimeFixture()
    expect(auditTenantRuntimeFixture(fixture)).toEqual([])
    expect(Value.Check(TenantRuntimeRatificationSchema, fixture.ratification)).toBe(true)
    expect(() => validateTenantRuntimeRatification(fixture.ratification)).not.toThrow()
  })

  test('ratifies strict application and compatibility contracts', () => {
    const ratification = validateTenantRuntimeRatification(validTenantRuntimeFixture().ratification)
    expect(Value.Check(TenantRuntimeApplicationContractSchema, ratification.application)).toBe(true)
    expect(Value.Check(TenantRuntimeCompatibilityContractSchema, ratification.compatibility)).toBe(true)
    expect(ratification.application).toMatchObject({
      applicationPath: 'apps/site-runtime',
      deploymentModel: 'single-multi-tenant',
      router: 'next-app-router',
      serverRuntime: 'node',
      bunRole: 'benchmark-only',
      outputMode: 'standalone',
      privateContractValidation: 'typebox',
    })
    expect(ratification.compatibility).toMatchObject({
      semanticHtmlCompiler: 'retained',
      portableExport: 'retained',
      selfHostedPublishing: 'retained',
      legacyReleaseReader: 'retained',
    })
  })

  test('keeps the accepted SITE-001 gates enforced by the dependency-ready SITE-003 app', () => {
    expect(existsSync(join(ROOT, 'apps/site-runtime'))).toBe(true)
    const backlog = readFileSync(join(ROOT, 'docs/plans/fuma-execution-backlog.md'), 'utf8')
    expect(backlog).toContain('### FUMA-SITE-002 — Publish immutable runtime-tree releases')
    expect(backlog).toContain('### FUMA-SITE-003 — Build the exact-host multi-tenant Next runtime')
  })

  test('has one deterministic hostile fixture for every typed rule', () => {
    expect(hostileTenantRuntimeFixtures().map(({ ruleId }) => ruleId)).toEqual([...SITE_RUNTIME_GATE_RULE_IDS])
    expect(new Set(SITE_RUNTIME_GATE_RULE_IDS).size).toBe(SITE_RUNTIME_GATE_RULE_IDS.length)
  })
})
