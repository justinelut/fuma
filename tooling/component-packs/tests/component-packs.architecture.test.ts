import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { COMPONENT_PACK_GATE_RULE_IDS, auditComponentPackFixture } from '../auditor'
import { ComponentPackReleaseSchema, GeneratedClientDraftSchema } from '../contracts'
import { privateRestaurantRelease, restaurantClientDraft } from '../fixtures'

describe('FUMA-SITE-007 component-pack architecture', () => {
  test('strict TypeBox boundaries reject unknown properties', () => {
    const release = privateRestaurantRelease()
    expect(Value.Check(ComponentPackReleaseSchema, { ...release, surpriseAuthority: true })).toBe(false)
    expect(Value.Check(GeneratedClientDraftSchema, { ...restaurantClientDraft(), serverEntry: './tenant.ts' })).toBe(false)
  })

  test('ticket source remains TypeBox-only and authority-seam-only', async () => {
    const paths = ['../contracts.ts', '../lifecycle.ts', '../auditor.ts', '../fixtures.ts']
    for (const path of paths) {
      const source = await Bun.file(new URL(path, import.meta.url)).text()
      expect(source).not.toMatch(/from\s+['"]zod|\bz\.object\s*\(/)
      expect(source).not.toMatch(/apps\/(?:studio|web|site-runtime)/)
      if (path !== '../auditor.ts') expect(source).not.toMatch(/CREATE TABLE|INSERT INTO|signArtifact|executeAgentTool/)
    }
  })

  test('declares one hostile gate for every trust boundary', () => {
    expect(COMPONENT_PACK_GATE_RULE_IDS).toEqual([
      'typebox-only', 'canonical-data-only', 'no-tenant-server-import', 'static-tailwind', 'draft-isolation',
      'restricted-authority', 'exact-version-integrity', 'namespace-owner-isolation',
      'marketplace-private-separation', 'self-reference', 'external-authority-seams',
    ])
  })

  test('safe fixture has no architecture findings', () => {
    expect(auditComponentPackFixture({ name: 'safe', files: [], persistedRecords: [{ moduleId: 'base.text', props: { text: 'safe data' } }], releases: [privateRestaurantRelease()], generatedDrafts: [restaurantClientDraft()] })).toEqual([])
  })

  test('auditor rejects persisted JSX, Zod, tenant server imports, and authority takeover', () => {
    const findings = auditComponentPackFixture({
      name: 'hostile',
      files: [
        { path: 'component.ts', content: "import { z } from 'zod'; const C = import(tenantModule)" },
        { path: 'migrations/component-pack.ts', content: 'CREATE TABLE component_pack(id text)' },
      ],
      persistedRecords: [{ moduleId: 'tenant.card', jsx: '<Card />' }], releases: [], generatedDrafts: [],
    })
    expect(new Set(findings.map((item) => item.ruleId))).toEqual(new Set(['typebox-only', 'no-tenant-server-import', 'external-authority-seams', 'canonical-data-only']))
  })
})
