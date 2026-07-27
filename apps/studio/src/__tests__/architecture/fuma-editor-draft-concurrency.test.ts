import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')
const FILES = {
  contracts: 'server/fuma/editor/contracts.ts',
  repository: 'server/fuma/editor/repository.ts',
  storage: 'server/fuma/editor/postgresStorage.ts',
  routes: 'server/fuma/editor/routes.ts',
  clientContracts: 'src/admin/fuma/editorSession/contracts.ts',
  coordinator: 'src/admin/fuma/editorSession/coordinator.ts',
  adapter: 'src/admin/fuma/editorSession/scopedHttpAdapter.ts',
  migration: 'server/fuma/db/migrations/000012_editor_draft_sequences.ts',
  migrationIndex: 'server/fuma/db/migrations/index.ts',
} as const

type Sources = Record<keyof typeof FILES, string>

function sources(): Sources {
  return Object.fromEntries(Object.entries(FILES).map(([name, path]) => [
    name,
    readFileSync(join(ROOT, path), 'utf8'),
  ])) as Sources
}

function audit(input: Sources): string[] {
  const findings: string[] = []
  const requiredContracts = [
    'EditorDraftSequenceSchema',
    'EditorDraftMutationSchema',
    'EditorDraftMutationReceiptSchema',
    'EditorDraftConflictSchema',
    'expectedSequence',
    'mutationId',
    'operations',
  ]
  for (const token of requiredContracts) {
    if (!input.contracts.includes(token)) findings.push(`contract:${token}`)
  }

  const streamDimensions = [
    'platformId', 'ownerKey', 'generation', 'profileId', 'resourceKind', 'logicalId',
  ]
  for (const dimension of streamDimensions) {
    if (!input.contracts.includes(dimension)) findings.push(`stream:${dimension}`)
  }
  if (!input.repository.includes('loadScopeAuthorityForUpdate')) findings.push('authority:fresh')
  if (!input.repository.includes('lockDraftSequence')) findings.push('sequence:lock')
  if (!input.repository.includes('setDraftSequence')) findings.push('sequence:cas')
  if (!input.repository.includes('getDraftMutationReceipt')) findings.push('replay:read')
  if (!input.repository.includes('putDraftMutationReceipt')) findings.push('replay:write')
  if (!input.repository.includes("code: 'draft-sequence-conflict'")) findings.push('conflict:visible')
  if (!input.repository.includes("code: 'mutation-id-reused'")) findings.push('replay:reuse')

  const sqlDimensions = [
    'platform_id', 'owner_key', 'owner_generation', 'profile_id', 'resource_kind', 'logical_id',
  ]
  for (const dimension of sqlDimensions) {
    if (!input.storage.includes(dimension)) findings.push(`sql:${dimension}`)
  }
  if (!input.storage.includes('for update')) findings.push('sql:row-lock')
  if (!input.storage.includes('and sequence = ${expected}')) findings.push('sql:cas-predicate')
  if (!input.storage.includes('for update\n    `')) findings.push('authority:exclusive-lock')

  if (!input.routes.includes('EditorDraftMutationSchema')) findings.push('route:strict-body')
  if (!input.routes.includes('repository.mutateDraft(body)')) findings.push('route:sequenced-write')
  if (!input.routes.includes("EditorDraftConflictSchema, result, 409")) findings.push('route:409')
  if (input.routes.includes('repository.save(body)')) findings.push('route:last-write-wins')

  if (!input.clientContracts.includes('profileId: TargetIdSchema')) findings.push('client:profile-scope')
  if (!input.coordinator.includes('target.profileId')) findings.push('client:profile-key')
  if (!input.coordinator.includes("saveState = 'conflict'")) findings.push('client:visible-conflict')
  if (!input.coordinator.includes("'accept-authoritative' | 'retry-local'")) {
    findings.push('client:explicit-resolution')
  }
  if (!input.adapter.includes('expectedSequence: command.expectedSequence')) {
    findings.push('client:precondition')
  }
  if (!input.adapter.includes('mutationId: command.mutationId')) findings.push('client:mutation-id')
  if (!input.adapter.includes('response.status === 409')) findings.push('client:409')

  const production = Object.values(input).join('\n')
  if (/\b(?:from|require\s*\()\s*['"]zod['"]/.test(production)) findings.push('forbidden:zod')
  if (/headers\s*:\s*\{[^}]*\b(?:ownerKey|generation|profileId|siteId)\b/s.test(input.adapter)) {
    findings.push('forbidden:authority-header')
  }
  if (/JSON\.stringify\(\{[^}]*\b(?:ownerKey|generation|profileId)\s*:/s.test(input.adapter)) {
    findings.push('forbidden:authority-body')
  }
  for (const source of [input.repository, input.routes, input.coordinator, input.adapter]) {
    if (/(?:if|switch|\?)\s*\([^)]*['"](?:website|publication)['"]/i.test(source)) {
      findings.push('forbidden:profile-branch')
      break
    }
  }

  if (!input.migration.includes("id: '000012_editor_draft_sequences'")) findings.push('migration:id')
  if (!input.migration.includes('create table fuma_editor_draft_heads')) findings.push('migration:head')
  if (!input.migration.includes('create table fuma_editor_draft_mutations')) findings.push('migration:receipt')
  if (/\b(?:alter|drop|truncate|delete from)\b/i.test(input.migration)) findings.push('migration:destructive')
  if (!input.migrationIndex.includes("'000012_editor_draft_sequences': '92048e16")) {
    findings.push('migration:checksum')
  }
  return findings
}

describe('FUMA-028 sequenced draft concurrency architecture', () => {
  it('accepts the production boundary', () => {
    expect(audit(sources())).toEqual([])
  })

  it('rejects hostile substitutions independently', () => {
    const baseline = sources()
    const mutations: Array<[string, Sources]> = [
      ['optimistic precondition', { ...baseline, contracts: baseline.contracts.replaceAll('expectedSequence', 'clientSequence') }],
      ['mutation ID', { ...baseline, contracts: baseline.contracts.replaceAll('mutationId', 'requestId') }],
      ['fresh authority', { ...baseline, repository: baseline.repository.replace('loadScopeAuthorityForUpdate', 'loadScopeAuthorityCached') }],
      ['row lock', { ...baseline, storage: baseline.storage.replaceAll('for update', 'for share') }],
      ['CAS predicate', { ...baseline, storage: baseline.storage.replace('and sequence = ${expected}', '') }],
      ['duplicate receipt', { ...baseline, repository: baseline.repository.replace('getDraftMutationReceipt', 'skipDraftMutationReceipt') }],
      ['strict route', { ...baseline, routes: baseline.routes.replaceAll('EditorDraftMutationSchema', 'Type.Unknown()') }],
      ['409 envelope', { ...baseline, routes: baseline.routes.replace('EditorDraftConflictSchema, result, 409', 'EditorDraftConflictSchema, result, 200') }],
      ['profile client key', { ...baseline, coordinator: baseline.coordinator.replace('target.profileId,', '') }],
      ['visible conflict', { ...baseline, coordinator: baseline.coordinator.replace("saveState = 'conflict'", "saveState = 'saved'") }],
      ['migration checksum', { ...baseline, migrationIndex: baseline.migrationIndex.replace('92048e16', '00000000') }],
      ['Zod', { ...baseline, routes: `${baseline.routes}\nimport { z } from 'zod'` }],
      ['authority header', { ...baseline, adapter: baseline.adapter.replace("headers: { 'Content-Type': 'application/json' }", "headers: { 'Content-Type': 'application/json', ownerKey: 'caller' }") }],
      ['profile branch', { ...baseline, coordinator: `${baseline.coordinator}\nif (target.profileId === 'website') throw new Error()` }],
    ]

    for (const [label, hostile] of mutations) {
      expect(audit(hostile).length, label).toBeGreaterThan(0)
    }
  })
})
