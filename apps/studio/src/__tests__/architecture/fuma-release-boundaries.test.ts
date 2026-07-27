import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

type ReleaseSources = Readonly<{
  composition: string
  contracts: string
  keyPolicy: string
  manifest: string
  repository: string
  service: string
  migration: string
}>

type Finding = Readonly<{ rule: string; detail: string }>

function productionSources(): ReleaseSources {
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  return {
    composition: read('server/fuma/releases/composition.ts'),
    contracts: read('server/fuma/releases/contracts.ts'),
    keyPolicy: read('server/fuma/releases/keyPolicy.ts'),
    manifest: read('server/fuma/releases/manifest.ts'),
    repository: read('server/fuma/releases/repository.ts'),
    service: read('server/fuma/releases/service.ts'),
    migration: read('server/fuma/db/migrations/000011_releases.ts'),
  }
}

function analyze(sources: ReleaseSources): Finding[] {
  const findings: Finding[] = []
  const all = Object.values(sources).join('\n')
  const requireText = (
    source: keyof ReleaseSources,
    text: string,
    rule: string,
    detail: string,
  ): void => {
    if (!sources[source].includes(text)) findings.push({ rule, detail })
  }

  if (/\b(?:zod|z\.(?:object|string|union))\b/i.test(all)) {
    findings.push({ rule: 'typebox-only', detail: 'release boundary references Zod' })
  }
  requireText('composition', 'new PostgresReleaseRepository(input.db)', 'production-composition', 'release service is not bound to the durable PostgreSQL repository')
  requireText('composition', 'new ReleaseService({', 'production-composition', 'release composition does not construct the lifecycle service')
  requireText('contracts', 'additionalProperties: false', 'strict-contracts', 'strict TypeBox object contracts missing')
  for (const state of ['queued', 'building', 'ready', 'active', 'failed']) {
    requireText('contracts', `Type.Literal('${state}')`, 'complete-lifecycle', `missing ${state} release state`)
  }
  requireText(
    'keyPolicy',
    'const key = `${releaseObjectPrefix(releaseId)}/${contentHashSha256}`',
    'content-addressed-keys',
    'release object identity is not release-local and content-addressed',
  )
  requireText('manifest', 'missing-reference', 'reference-completeness', 'manifest does not reject missing references')
  requireText('manifest', 'artifactsHashSha256', 'manifest-hashes', 'artifact descriptor hash is not verified')

  for (const predicate of [
    'platform_id = ${this.scope.platformId}',
    'owner_key = ${this.scope.ownerKey}',
    'organization_id = ${this.scope.organizationId}',
    'workspace_id = ${this.scope.workspaceId}',
    'site_id = ${this.scope.siteId}',
    'generation = ${this.scope.generation}',
    "state = 'active'",
    'transfer_id is null',
    'transfer_lock_id is null',
    'transfer_fence is null',
  ]) {
    requireText('repository', predicate, 'exact-owner-authority', `missing repository authority predicate: ${predicate}`)
  }
  requireText('repository', 'pg_advisory_xact_lock', 'activation-serialization', 'release transactions are not serialized')
  requireText('repository', 'assertScopeIdentity(this.#scope, record)', 'bound-record-identity', 'release records can substitute foreign coordinates')
  requireText('repository', 'assertScopeIdentity(this.#scope, pointer)', 'bound-record-identity', 'active pointers can substitute foreign coordinates')
  requireText('repository', 'assertScopeIdentity(this.#scope, root)', 'bound-record-identity', 'retention roots can substitute foreign coordinates')
  requireText('service', 'storage.list(', 'complete-object-verification', 'release object inventory is not listed')
  requireText('service', 'storage.head(', 'complete-object-verification', 'release object metadata is not checked')
  requireText('service', 'storage.get(', 'complete-object-verification', 'release object bytes are not checked')
  requireText('service', "deleteRetentionRoot('active', 'active')", 'active-root-swap', 'active root is not swapped atomically')
  requireText('service', 'putActivePointer(pointer', 'active-pointer-swap', 'active pointer is not committed in release transaction')

  if (/from ['"].*(?:core\/publisher|server\/publish)/.test(sources.service)
    || /\b(?:publishPage|renderPublishedSnapshot|FumaJobService)\b/.test(sources.service)) {
    findings.push({
      rule: 'fuma-049-separation',
      detail: 'FUMA-048 release lifecycle owns worker publishing or renderer activation',
    })
  }
  if (/\bobjectStorage\.(?:put|beginMultipart|delete)\(/.test(sources.service)) {
    findings.push({
      rule: 'immutable-object-reader',
      detail: 'release lifecycle writes or deletes immutable release objects',
    })
  }

  for (const table of [
    'create table fuma_releases',
    'create table fuma_release_active_pointers',
    'create table fuma_release_retention_roots',
  ]) {
    requireText('migration', table, 'additive-release-schema', `missing additive schema: ${table}`)
  }
  requireText('migration', 'release manifest is immutable', 'database-immutability', 'database manifest overwrite guard missing')
  requireText('migration', 'active releases cannot be deleted', 'database-active-protection', 'database active deletion guard missing')
  if (/\balter\s+table\s+(?!fuma_release)/i.test(sources.migration)
    || /\bdrop\s+(?:table|column|schema)\b/i.test(sources.migration)) {
    findings.push({ rule: 'historical-schema-preservation', detail: 'release migration mutates historical schema' })
  }
  return findings
}

function mutate(
  source: ReleaseSources,
  key: keyof ReleaseSources,
  before: string,
  after: string,
): ReleaseSources {
  expect(source[key]).toContain(before)
  return { ...source, [key]: source[key].replace(before, after) }
}

describe('FUMA-048 release architecture boundary', () => {
  it('accepts the production release boundary', () => {
    expect(analyze(productionSources())).toEqual([])
  })

  it('rejects authority, key, verification, immutability, and renderer ownership drift', () => {
    const source = productionSources()
    const hostile = [
      mutate(source, 'composition', 'new PostgresReleaseRepository(input.db)', 'new MemoryReleaseRepository()'),
      mutate(source, 'repository', 'generation = ${this.scope.generation}', 'generation > 0'),
      mutate(source, 'keyPolicy', 'const key = `${releaseObjectPrefix(releaseId)}/${contentHashSha256}`', "const key = 'publish/releases/latest/object'"),
      mutate(source, 'service', 'storage.list(', 'storage.listMissing('),
      mutate(source, 'migration', 'release manifest is immutable', 'release manifest may change'),
      { ...source, service: `${source.service}\nimport { publishPage } from '@core/publisher'` },
      { ...source, contracts: `${source.contracts}\nimport { z } from 'zod'` },
    ]
    const expectedRules = [
      'production-composition',
      'exact-owner-authority',
      'content-addressed-keys',
      'complete-object-verification',
      'database-immutability',
      'fuma-049-separation',
      'typebox-only',
    ]
    hostile.forEach((candidate, index) => {
      expect(analyze(candidate).map(({ rule }) => rule)).toContain(expectedRules[index])
    })
  })
})
