import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

const PATHS = Object.freeze({
  http: 'server/fuma/context/middleware.ts',
  runtimeKeys: 'server/fuma/runtime/scopedKeys.ts',
  objectKeys: 'server/fuma/objectStorage/scopedKeys.ts',
  plugin: 'server/fuma/plugins/callBoundary.ts',
  jobs: 'server/fuma/jobs/integration.ts',
  jobRepository: 'server/fuma/jobs/repository.ts',
  siteRepository: 'server/fuma/sites/scopedRepository.ts',
})

type BoundarySources = Readonly<Record<keyof typeof PATHS, string>>

type Finding = Readonly<{
  boundary: keyof typeof PATHS
  detail: string
}>

function productionSources(): BoundarySources {
  return Object.fromEntries(Object.entries(PATHS).map(([name, path]) => [
    name,
    readFileSync(join(ROOT, path), 'utf8'),
  ])) as BoundarySources
}

function requireText(
  findings: Finding[],
  boundary: keyof typeof PATHS,
  source: string,
  text: string,
  detail: string,
): void {
  if (!source.includes(text)) findings.push({ boundary, detail })
}

function requireOrder(
  findings: Finding[],
  boundary: keyof typeof PATHS,
  source: string,
  ordered: readonly string[],
  detail: string,
): void {
  let cursor = -1
  for (const text of ordered) {
    const next = source.indexOf(text, cursor + 1)
    if (next < 0) {
      findings.push({ boundary, detail })
      return
    }
    cursor = next
  }
}

function methodBody(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  return from >= 0 && to > from ? source.slice(from, to) : ''
}

function auditHttp(source: string): Finding[] {
  const findings: Finding[] = []
  for (const claim of ["'owner-key'", "'tenant-id'", "'ownerkey'", "'tenantid'"]) {
    requireText(findings, 'http', source, claim, `HTTP caller-claim vocabulary omits ${claim}`)
  }
  const handle = methodBody(source, 'async function handle(request: Request)', '\n  return Object.freeze({ handles, authorize, handle })')
  requireOrder(findings, 'http', handle, [
    'callerClaimsHeaderAuthority(request)',
    'callerClaimsBodyAuthority(request)',
    'deriveFumaRequestContext({',
    'deriveFumaRepositoryScope({',
    "repositoryScope.state !== 'active'",
    'repositoryScope.transferFence !== null',
    'selected.route.handler(handlerInput)',
  ], 'HTTP dispatch does not reject caller authority or inactive scope before trusted handler dispatch')
  requireText(findings, 'http', handle, 'trustedContext: Object.freeze({ kind: \'request\', context })', 'HTTP repository scope is not derived from frozen trusted request authority')
  requireText(findings, 'http', handle, 'context,\n        repositoryScope,', 'HTTP handler does not receive the trusted context and repository scope together')
  return findings
}

function auditRuntimeKeys(source: string): Finding[] {
  const findings: Finding[] = []
  requireText(findings, 'runtimeKeys', source, 'minimum: 1,', 'coordination key version accepts an unversioned value')
  requireText(findings, 'runtimeKeys', source, 'version: FumaScopedKeyVersionSchema,', 'coordination key authority omits its explicit version')
  requireText(findings, 'runtimeKeys', source, '!isDeepFrozen(input.trustedContext.context)', 'coordination keys accept mutable trusted context')
  requireText(findings, 'runtimeKeys', source, '!isDeepFrozen(input.repositoryScope)', 'coordination keys accept mutable repository scope')
  requireText(findings, 'runtimeKeys', source, "scope.state !== 'active'", 'coordination keys accept inactive repository scope')
  requireText(findings, 'runtimeKeys', source, 'scope.transferFence !== null', 'coordination keys accept transfer-fenced repository scope')
  const fingerprint = methodBody(source, 'function authorityFingerprint', '\nfunction exactAuthority')
  for (const dimension of [
    'platformId',
    'organizationId',
    'workspaceId',
    'siteId',
    'ownerKey',
    'generation',
    'profileId',
    'capabilityId',
    'version',
  ]) {
    requireText(findings, 'runtimeKeys', fingerprint, `authority.${dimension}`, `coordination fingerprint omits ${dimension}`)
  }
  requireText(findings, 'runtimeKeys', source, '`fuma-scope:v1:${fingerprint}:g${authority.generation}:v${authority.version}`', 'coordination keys are not namespace-, generation-, and version-qualified')
  requireText(findings, 'runtimeKeys', source, "key(kind: 'cache' | 'pubsub' | 'lock'", 'cache, pubsub, and lock keys do not share the scoped factory')
  return findings
}

function auditObjectKeys(source: string): Finding[] {
  const findings: Finding[] = []
  requireText(findings, 'objectKeys', source, '!isDeepFrozen(repositoryScope)', 'object keys accept mutable repository scope')
  requireText(findings, 'objectKeys', source, "repositoryScope.state !== 'active'", 'object keys accept inactive repository scope')
  requireText(findings, 'objectKeys', source, 'repositoryScope.transferFence !== null', 'object keys accept transfer-fenced repository scope')
  requireText(findings, 'objectKeys', source, 'prefix: tenantObjectPrefix(scope)', 'object keys bypass the tenant prefix policy')
  requireText(findings, 'objectKeys', source, 'return physicalObjectKey(scope, logicalKey)', 'object physical keys are not derived from bound scope')
  requireText(findings, 'objectKeys', source, 'return logicalObjectKey(scope, candidate)', 'object reverse lookup does not enforce the bound scope')
  return findings
}

function auditPlugin(source: string): Finding[] {
  const findings: Finding[] = []
  for (const claim of [
    "'ownerKey'",
    "'tenantId'",
    "'repositoryScope'",
    "'grantedCapabilities'",
    "'grantedPermissions'",
  ]) {
    requireText(findings, 'plugin', source, claim, `plugin caller-claim vocabulary omits ${claim}`)
  }
  const normalization = methodBody(source, 'function normalizeAuthorityKey', '\n}\n\nconst CALLER_AUTHORITY_KEYS')
  requireText(findings, 'plugin', normalization, "key.toLowerCase().replace(/[^a-z0-9]/g, '')", 'plugin claim keys are not case-and-punctuation normalized')
  requireText(findings, 'plugin', source, '].map(normalizeAuthorityKey)', 'plugin claim vocabulary is not normalized before lookup')
  const claimScan = methodBody(source, 'function assertPayloadHasNoCallerAuthorityClaims', '\n}\n\nfunction clonePayload')
  requireText(findings, 'plugin', claimScan, 'const pending:', 'plugin claim rejection does not recursively scan nested payload values')
  requireText(findings, 'plugin', claimScan, 'CALLER_AUTHORITY_KEYS.has(normalizeAuthorityKey(key))', 'plugin claim rejection does not normalize every nested key')
  requireText(findings, 'plugin', claimScan, 'pending.push({', 'plugin claim rejection does not enqueue nested payload values')
  requireText(findings, 'plugin', source, 'grantedPermissions: readonly PluginPermission[]', 'hosted plugin binding does not require explicit grantedPermissions')
  requireText(findings, 'plugin', source, 'requiredPluginPermissions: Type.Array(', 'hosted plugin target requirements omit plugin permissions')
  requireText(findings, 'plugin', source, 'this.#grantedPermissions = new Set(input.authority.grantedPermissions)', 'hosted plugin calls do not bind the operator-approved grant snapshot')
  const call = methodBody(source, 'async call(input: unknown)', '\n}\n\n/**\n * Binds one hosted plugin identity')
  requireOrder(findings, 'plugin', call, [
    'assertPayloadHasNoCallerAuthorityClaims(parsed.value.payload)',
    'requirement.requiredPluginPermissions.some',
    '!this.#grantedPermissions.has(permission)',
    'deriveFumaRepositoryScope({',
    "currentScope.state !== 'active'",
    'sameScope(currentScope, this.authority.repositoryScope)',
    'authority: this.authority,',
    'dispatcher.dispatch(dispatchCall)',
  ], 'hosted plugin calls can dispatch without recursive claim rejection, plugin grants, and current active scope')
  const rawDispatches = [...source.matchAll(/\.dispatch\(([^)]+)\)/g)]
    .map((match) => match[1]!.trim())
    .filter((argument) => argument !== 'dispatchCall')
  if (rawDispatches.length > 0) {
    findings.push({ boundary: 'plugin', detail: `unscoped plugin dispatch argument(s): ${rawDispatches.join(', ')}` })
  }
  return findings
}

function auditJobs(source: string): Finding[] {
  const findings: Finding[] = []
  const bind = methodBody(source, 'async bind(context: FumaJobHandlerContext)', '\n}\n\n/** Converts authority-consuming handlers')
  const organizationBranch = methodBody(bind, "if (jobContext.kind === 'organization')", '\n      const repositoryScope = await deriveFumaRepositoryScope')
  requireText(findings, 'jobs', organizationBranch, 'repositoryScope: null,', 'actorless organization jobs receive repository scope')
  requireText(findings, 'jobs', organizationBranch, 'siteRepository: null,', 'actorless organization jobs receive site repository access')
  requireOrder(findings, 'jobs', bind, [
    'deriveFumaJobContext({',
    "if (jobContext.kind === 'organization')",
    'deriveFumaRepositoryScope({',
    'this.#siteRepositories.forScope(repositoryScope)',
  ], 'site jobs are not upgraded from trusted job authority into one scoped repository')

  const scopeHandlers = methodBody(source, 'export function scopeFumaJobHandlers', '\n}\n\nexport interface FumaJobIntegrationOptions')
  requireText(findings, 'jobs', scopeHandlers, 'handler(await boundary.bind(context))', 'raw durable-job handlers bypass authority binding')
  const workerHandlers = methodBody(source, 'function workerHandlers(', '\nfunction controlComponent')
  requireText(findings, 'jobs', workerHandlers, 'if (!options.jobAuthority)', 'worker handlers do not require trusted job authority')
  requireText(findings, 'jobs', workerHandlers, 'if (!ownerKeys || !siteRepositories)', 'worker handlers do not require server-owned site scope authority')
  requireText(findings, 'jobs', workerHandlers, 'return scopeFumaJobHandlers(handlers, new FumaJobScopeBoundary({', 'worker composition mounts raw handlers without the scope boundary')
  return findings
}

function auditJobRepository(source: string): Finding[] {
  const findings: Finding[] = []
  const claimAuthority = methodBody(source, 'function hasClaimAuthority', '\n}\n\nexport interface FumaJobRepository')
  requireText(findings, 'jobRepository', claimAuthority, "row.status === 'running'", 'current durable claim does not require running status')
  requireText(findings, 'jobRepository', claimAuthority, 'row.claimed_by === claim.workerId', 'current durable claim does not require the exact claimant')
  requireText(findings, 'jobRepository', claimAuthority, 'Number.isFinite(claimExpiresAt)', 'current durable claim does not require a parseable expiry')
  requireText(findings, 'jobRepository', claimAuthority, 'claimExpiresAt > now.getTime()', 'current durable claim does not require a future expiry')
  requireText(findings, 'jobRepository', claimAuthority, 'String(row.fence) === claim.fence', 'current durable claim does not require the exact fence')
  const cancellation = methodBody(source, 'async cancellationRequested(claim: FumaJobClaim)', '\n  commitEffect(')
  requireText(findings, 'jobRepository', cancellation, 'select status, claimed_by, claim_expires_at, fence, cancellation_requested_at', 'durable claim guard does not reload current status and claimant')
  requireText(findings, 'jobRepository', cancellation, '!hasClaimAuthority(current, claim, now)', 'durable cancellation guard bypasses current claim validation')
  return findings
}

function auditSiteRepository(source: string): Finding[] {
  const findings: Finding[] = []
  requireText(findings, 'siteRepository', source, 'return this.#repository.transaction(\n      this.scope.organizationId,\n      this.scope.workspaceId,', 'site repository transaction omits bound tenant ancestry')
  requireText(findings, 'siteRepository', source, 'await transaction.assertActiveOwnerScope({', 'site repository operations do not revalidate active owner authority')
  requireText(findings, 'siteRepository', source, 'siteId: this.scope.siteId,', 'site repository owner assertion omits site identity')
  requireText(findings, 'siteRepository', source, 'ownerKey: this.scope.ownerKey,', 'site repository owner assertion omits stable owner key')
  requireText(findings, 'siteRepository', source, 'generation: this.scope.generation,', 'site repository owner assertion omits owner generation')
  return findings
}

function audit(sources: BoundarySources): Finding[] {
  return [
    ...auditHttp(sources.http),
    ...auditRuntimeKeys(sources.runtimeKeys),
    ...auditObjectKeys(sources.objectKeys),
    ...auditPlugin(sources.plugin),
    ...auditJobs(sources.jobs),
    ...auditJobRepository(sources.jobRepository),
    ...auditSiteRepository(sources.siteRepository),
  ]
}

function mutate(
  sources: BoundarySources,
  boundary: keyof BoundarySources,
  before: string,
  after: string,
): BoundarySources {
  expect(sources[boundary]).toContain(before)
  return { ...sources, [boundary]: sources[boundary].replace(before, after) }
}

function details(sources: BoundarySources): string[] {
  return audit(sources).map(({ boundary, detail }) => `${boundary}: ${detail}`)
}

describe('FUMA-026 runtime boundary scoping architecture', () => {
  it('audits the actual HTTP, key, plugin, repository, and job integration sources', () => {
    expect(audit(productionSources())).toEqual([])
  })

  it('rejects caller tenant or owner claims crossing HTTP and plugin boundaries', () => {
    const sources = productionSources()
    const unsafeHttp = mutate(
      sources,
      'http',
      'callerClaimsHeaderAuthority(request)\n        || await callerClaimsBodyAuthority(request)',
      'false',
    )
    expect(details(unsafeHttp)).toContain(
      'http: HTTP dispatch does not reject caller authority or inactive scope before trusted handler dispatch',
    )

    const nonRecursivePluginClaims = mutate(
      sources,
      'plugin',
      'pending.push({\n          value: (current.value as Record<string, unknown>)[key],',
      'void ({\n          value: (current.value as Record<string, unknown>)[key],',
    )
    expect(details(nonRecursivePluginClaims)).toContain(
      'plugin: plugin claim rejection does not enqueue nested payload values',
    )

    const unnormalizedPluginClaims = mutate(
      sources,
      'plugin',
      'CALLER_AUTHORITY_KEYS.has(normalizeAuthorityKey(key))',
      'CALLER_AUTHORITY_KEYS.has(key)',
    )
    expect(details(unnormalizedPluginClaims)).toContain(
      'plugin: plugin claim rejection does not normalize every nested key',
    )
  })

  it('rejects mutable, generation-blind, or unversioned coordination and object keys', () => {
    const sources = productionSources()
    const inactiveHttp = mutate(
      sources,
      'http',
      "if (\n        repositoryScope.state !== 'active'\n        || repositoryScope.transferFence !== null\n      ) {",
      'if (false) {',
    )
    expect(details(inactiveHttp)).toContain(
      'http: HTTP dispatch does not reject caller authority or inactive scope before trusted handler dispatch',
    )

    const mutableRuntime = mutate(
      sources,
      'runtimeKeys',
      '|| !isDeepFrozen(input.repositoryScope)',
      '',
    )
    expect(details(mutableRuntime)).toContain(
      'runtimeKeys: coordination keys accept mutable repository scope',
    )

    const inactiveRuntime = mutate(
      sources,
      'runtimeKeys',
      "scope.state !== 'active'",
      'false',
    )
    expect(details(inactiveRuntime)).toContain(
      'runtimeKeys: coordination keys accept inactive repository scope',
    )

    const unversioned = mutate(
      sources,
      'runtimeKeys',
      '`fuma-scope:v1:${fingerprint}:g${authority.generation}:v${authority.version}`',
      '`${fingerprint}`',
    )
    expect(details(unversioned)).toContain(
      'runtimeKeys: coordination keys are not namespace-, generation-, and version-qualified',
    )

    const mutableObjects = mutate(
      sources,
      'objectKeys',
      '|| !isDeepFrozen(repositoryScope)',
      '',
    )
    expect(details(mutableObjects)).toContain(
      'objectKeys: object keys accept mutable repository scope',
    )

    const inactiveObjects = mutate(
      sources,
      'objectKeys',
      "repositoryScope.state !== 'active'",
      'false',
    )
    expect(details(inactiveObjects)).toContain(
      'objectKeys: object keys accept inactive repository scope',
    )
  })

  it('rejects missing plugin grants, unscoped dispatch, actorless site access, and stale durable claims', () => {
    const sources = productionSources()
    const ungrantedPlugin = mutate(
      sources,
      'plugin',
      '!this.#grantedPermissions.has(permission)',
      'false',
    )
    expect(details(ungrantedPlugin)).toContain(
      'plugin: hosted plugin calls can dispatch without recursive claim rejection, plugin grants, and current active scope',
    )

    const unscopedPlugin = mutate(
      sources,
      'plugin',
      'dispatcher.dispatch(dispatchCall)',
      'dispatcher.dispatch(parsed.value.payload)',
    )
    expect(details(unscopedPlugin)).toContain(
      'plugin: unscoped plugin dispatch argument(s): parsed.value.payload',
    )

    const actorlessSite = mutate(
      sources,
      'jobs',
      'siteRepository: null,',
      'siteRepository: this.#siteRepositories,',
    )
    expect(details(actorlessSite)).toContain(
      'jobs: actorless organization jobs receive site repository access',
    )

    const rawHandlers = mutate(
      sources,
      'jobs',
      'return scopeFumaJobHandlers(handlers, new FumaJobScopeBoundary({',
      'return handlers && new FumaJobScopeBoundary({',
    )
    expect(details(rawHandlers)).toContain(
      'jobs: worker composition mounts raw handlers without the scope boundary',
    )

    const staleStatus = mutate(
      sources,
      'jobRepository',
      "row.status === 'running'",
      'true',
    )
    expect(details(staleStatus)).toContain(
      'jobRepository: current durable claim does not require running status',
    )

    const wrongClaimant = mutate(
      sources,
      'jobRepository',
      'row.claimed_by === claim.workerId',
      'true',
    )
    expect(details(wrongClaimant)).toContain(
      'jobRepository: current durable claim does not require the exact claimant',
    )

    const expiredClaim = mutate(
      sources,
      'jobRepository',
      'claimExpiresAt > now.getTime()',
      'true',
    )
    expect(details(expiredClaim)).toContain(
      'jobRepository: current durable claim does not require a future expiry',
    )
  })
})
