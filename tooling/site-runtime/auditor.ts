import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  TenantCacheIdentitySchema,
  TenantComponentTrustBindingSchema,
  TenantRuntimeApplicationContractSchema,
  TenantRuntimeAuthorityContractSchema,
  TenantRuntimeCompatibilityContractSchema,
  TenantSiteCookieSchema,
  validateTenantRuntimeRatification,
  type TenantCacheIdentity,
  type TenantComponentTrustBinding,
  type TenantHostBinding,
} from './contracts'
import type { TenantRuntimeFixture, TenantRuntimeHostileRule } from './fixtures'

export const SITE_RUNTIME_GATE_RULE_IDS = [
  'single-site-runtime',
  'app-to-app-import',
  'shared-ui-package',
  'direct-authority',
  'studio-tailwind',
  'typebox-only',
  'app-local-exact-tailwind',
  'dynamic-tenant-server-import',
  'release-qualified-cache',
  'release-bound-component',
  'unknown-host-fallback',
  'process-global-tenant',
  'unsafe-cookie',
  'persisted-jsx',
  'persisted-tailwind-utilities',
  'arbitrary-server-component',
  'static-export-self-host-compatibility',
  'node-first-runtime',
  'native-linux-arm64',
] as const satisfies readonly TenantRuntimeHostileRule[]

export type SiteRuntimeGateRuleId = typeof SITE_RUNTIME_GATE_RULE_IDS[number]
export type SiteRuntimeGateFinding = Readonly<{
  ruleId: SiteRuntimeGateRuleId
  path: string
  detail: string
}>

const FixtureSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  appDirectories: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 100, uniqueItems: true }),
  files: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 1_024 }),
    content: Type.String({ maxLength: 1_000_000 }),
  }, { additionalProperties: false }), { maxItems: 10_000 }),
  ratification: Type.Unknown(),
  persistedRecords: Type.Array(Type.Unknown(), { maxItems: 10_000 }),
}, { additionalProperties: false })

const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json)$/
const APP_IMPORT = /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:@fuma\/(?:studio|web)|[^'"]*(?:apps\/|\.\.\/)+(?:studio|web)(?:\/|['"]))/
const SHARED_UI = /(?:@fuma\/shared-ui|packages\/shared-ui|shared\/ui)/
const DIRECT_AUTHORITY = /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:postgres|drizzle-orm|better-auth|redis|ioredis|minio|@aws-sdk\/|[^'"]*(?:database|repositories|providers?|paystack|migrations)(?:\/|['"]))/
const DIRECT_AUTHORITY_DEPENDENCIES = new Set(['postgres', 'drizzle-orm', 'better-auth', 'redis', 'ioredis', 'minio'])
const ZOD = /(?:from\s*|import\s*\(|require\s*\()\s*['"]zod(?:\/[^'"]*)?['"]|\bz\.object\s*\(/
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(?!['"`])/
const UNKNOWN_FALLBACK = /\b(?:unknownHostFallback|defaultTenant|defaultSite|fallbackTenant|fallbackSite)\s*(?::|=)\s*(?!null\b|false\b)/
const PROCESS_GLOBAL_TENANT = /(?:^|\n)\s*(?:export\s+)?(?:let|var)\s+(?:currentTenant|activeTenant|tenantContext)\b|globalThis\s*\.\s*(?:tenant|currentTenant)/

export class TenantRuntimeAuditError extends Error {
  override readonly name = 'TenantRuntimeAuditError'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function parsedManifest(content: string): Record<string, unknown> | undefined {
  try { return record(JSON.parse(content)) } catch { return undefined }
}

function dependencyMap(manifest: Record<string, unknown>, field: string): Record<string, unknown> {
  return record(manifest[field]) ?? {}
}

function add(findings: SiteRuntimeGateFinding[], ruleId: SiteRuntimeGateRuleId, path: string, detail: string): void {
  findings.push({ ruleId, path, detail })
}

function sameAuthority(host: TenantHostBinding, cache: TenantCacheIdentity): boolean {
  return host.host === cache.host
    && host.platformId === cache.platformId
    && host.organizationId === cache.organizationId
    && host.workspaceId === cache.workspaceId
    && host.siteId === cache.siteId
    && host.ownerKey === cache.ownerKey
    && host.ownerGeneration === cache.ownerGeneration
    && host.releaseId === cache.releaseId
    && host.releaseHashSha256 === cache.releaseHashSha256
}

function componentTrustIsValid(component: TenantComponentTrustBinding): boolean {
  if (component.execution === 'server-component') return component.trustTier === 'official'
  if (component.execution === 'client-component') return component.trustTier === 'official' || component.trustTier === 'reviewed-client'
  if (component.execution === 'declarative-tree') return component.trustTier === 'official' || component.trustTier === 'declarative-community'
  return component.trustTier === 'legacy'
}

function findPersistedKey(value: unknown, keys: ReadonlySet<string>, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPersistedKey(item, keys, seen)
      if (found) return found
    }
    return undefined
  }
  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key)) return key
    const found = findPersistedKey(nested, keys, seen)
    if (found) return found
  }
  return undefined
}

function applicationFindings(fixture: TenantRuntimeFixture, findings: SiteRuntimeGateFinding[]): void {
  const ratification = record(fixture.ratification)
  const application = record(ratification?.application)
  const authority = record(ratification?.authority)
  const compatibility = record(ratification?.compatibility)

  const siteRuntimeDirectories = fixture.appDirectories.filter((path) => path === 'apps/site-runtime')
  const customerApps = fixture.appDirectories.filter((path) => /^apps\/(?:site|tenant|customer)[-_](?!runtime$)/.test(path))
  if (siteRuntimeDirectories.length !== 1 || customerApps.length > 0 || application?.applicationPath !== 'apps/site-runtime' || application?.deploymentModel !== 'single-multi-tenant') {
    add(findings, 'single-site-runtime', 'apps/', 'Exactly one apps/site-runtime deployment must serve every exact tenant/customer host.')
  }

  const imports = record(application?.imports)
  if (Array.isArray(imports?.applications) && imports.applications.length > 0) add(findings, 'app-to-app-import', 'ratification.application.imports', 'The site runtime must not import another application.')
  if (imports?.sharedUiPackage !== false) add(findings, 'shared-ui-package', 'ratification.application.imports', 'A shared UI package is forbidden.')
  if (authority?.directDatabase !== false || authority?.directProvider !== false || authority?.draftReads !== false || imports?.studioAuthority !== false) {
    add(findings, 'direct-authority', 'ratification.authority', 'The runtime consumes private TypeBox APIs, never database/provider/draft authority.')
  }
  if (application?.privateContractValidation !== 'typebox') add(findings, 'typebox-only', 'ratification.application.privateContractValidation', 'Untyped boundaries must use TypeBox.')

  const tenantState = record(application?.tenantState)
  if (tenantState?.processGlobal !== false || tenantState?.defaultTenant !== null) add(findings, 'process-global-tenant', 'ratification.application.tenantState', 'Tenant state is request-bound with no default or process-global tenant.')

  const styling = record(application?.styling)
  if (styling?.ownership !== 'app-local'
    || typeof styling.tailwindVersion !== 'string' || !EXACT_VERSION.test(styling.tailwindVersion)
    || typeof styling.shadcnVersion !== 'string' || !EXACT_VERSION.test(styling.shadcnVersion)
    || styling.utilities !== 'static-source-only' || styling.persistedUtilitiesCompile !== false) {
    add(findings, 'app-local-exact-tailwind', 'ratification.application.styling', 'Tailwind/shadcn must be app-local, exact-pinned, and static-source-only.')
  }
  if (styling?.studioTailwind !== false) add(findings, 'studio-tailwind', 'ratification.application.styling', 'Studio remains Tailwind-free.')
  if (application?.serverRuntime !== 'node' || application?.bunRole !== 'benchmark-only') add(findings, 'node-first-runtime', 'ratification.application', 'Production is Node-first; Bun is benchmark-only until separately accepted.')
  const production = record(application?.production)
  if (production?.os !== 'linux' || production?.architecture !== 'arm64' || production?.emulation !== false) {
    add(findings, 'native-linux-arm64', 'ratification.application.production', 'Production acceptance is native Linux ARM64 without emulation.')
  }
  if (!Value.Check(TenantRuntimeCompatibilityContractSchema, compatibility)) {
    add(findings, 'static-export-self-host-compatibility', 'ratification.compatibility', 'Semantic HTML, static/export, self-host, legacy release, and emergency rollback compatibility must remain retained.')
  }
  if (!Value.Check(TenantRuntimeApplicationContractSchema, application) && findings.length === 0) {
    throw new TenantRuntimeAuditError('Application contract drift was not mapped to a SITE-001 gate.')
  }
  if (!Value.Check(TenantRuntimeAuthorityContractSchema, authority) && findings.length === 0) {
    throw new TenantRuntimeAuditError('Authority contract drift was not mapped to a SITE-001 gate.')
  }
}

function sourceFindings(fixture: TenantRuntimeFixture, findings: SiteRuntimeGateFinding[]): void {
  for (const file of fixture.files) {
    if (!SOURCE_FILE.test(file.path)) continue
    if (file.path.startsWith('apps/site-runtime/')) {
      if (APP_IMPORT.test(file.content)) add(findings, 'app-to-app-import', file.path, 'Site runtime source imports Studio or Web.')
      if (SHARED_UI.test(file.content)) add(findings, 'shared-ui-package', file.path, 'Site runtime source imports a shared UI package.')
      if (DIRECT_AUTHORITY.test(file.content)) add(findings, 'direct-authority', file.path, 'Site runtime source imports direct database/provider authority.')
      if (ZOD.test(file.content)) add(findings, 'typebox-only', file.path, 'Zod is forbidden; use TypeBox.')
      if (DYNAMIC_IMPORT.test(file.content)) add(findings, 'dynamic-tenant-server-import', file.path, 'Tenant-controlled dynamic server imports are forbidden.')
      if (UNKNOWN_FALLBACK.test(file.content)) add(findings, 'unknown-host-fallback', file.path, 'Unknown hosts must fail closed without fallback.')
      if (PROCESS_GLOBAL_TENANT.test(file.content)) add(findings, 'process-global-tenant', file.path, 'Process-global current tenant state is forbidden.')
    }
    if (file.path === 'apps/site-runtime/package.json') {
      const manifest = parsedManifest(file.content)
      const dependencies = manifest ? { ...dependencyMap(manifest, 'dependencies'), ...dependencyMap(manifest, 'devDependencies') } : {}
      if ('@fuma/studio' in dependencies || '@fuma/web' in dependencies) {
        add(findings, 'app-to-app-import', file.path, 'Site runtime manifest depends on another application.')
      }
      if ('@fuma/shared-ui' in dependencies || 'shared-ui' in dependencies) {
        add(findings, 'shared-ui-package', file.path, 'Site runtime manifest declares a forbidden shared UI dependency.')
      }
      if (Object.keys(dependencies).some((dependency) => DIRECT_AUTHORITY_DEPENDENCIES.has(dependency) || dependency.startsWith('@aws-sdk/'))) {
        add(findings, 'direct-authority', file.path, 'Site runtime manifest declares direct database/provider authority.')
      }
      if ('zod' in dependencies) add(findings, 'typebox-only', file.path, 'Zod is forbidden; use TypeBox.')
      if (typeof dependencies.tailwindcss !== 'string' || !EXACT_VERSION.test(dependencies.tailwindcss)
        || typeof dependencies.shadcn !== 'string' || !EXACT_VERSION.test(dependencies.shadcn)) {
        add(findings, 'app-local-exact-tailwind', file.path, 'The future app fixture must exact-pin app-local Tailwind and shadcn.')
      }
    }
    if (file.path.startsWith('apps/studio/')) {
      const manifest = file.path.endsWith('/package.json') ? parsedManifest(file.content) : undefined
      const dependencies = manifest ? { ...dependencyMap(manifest, 'dependencies'), ...dependencyMap(manifest, 'devDependencies') } : {}
      if ('tailwindcss' in dependencies || 'shadcn' in dependencies || /@tailwind|@apply|tailwindcss|shadcn\/ui/.test(file.content)) {
        add(findings, 'studio-tailwind', file.path, 'Tailwind/shadcn must not enter Studio.')
      }
    }
  }
}

function trustFindings(fixture: TenantRuntimeFixture, findings: SiteRuntimeGateFinding[]): void {
  const ratification = record(fixture.ratification)
  const bindings = Array.isArray(ratification?.hostBindings) ? ratification.hostBindings.filter((item): item is TenantHostBinding => record(item) !== undefined) : []
  const caches = Array.isArray(ratification?.cacheIdentities) ? ratification.cacheIdentities : []
  for (const cache of caches) {
    if (!Value.Check(TenantCacheIdentitySchema, cache) || !bindings.some((binding) => sameAuthority(binding, cache as TenantCacheIdentity))) {
      add(findings, 'release-qualified-cache', 'ratification.cacheIdentities', 'Cache identity must include the exact host, owner generation, immutable release, route, query, audience, runtime, and registry version.')
      break
    }
  }
  const components = Array.isArray(ratification?.components) ? ratification.components : []
  for (const component of components) {
    const candidate = record(component)
    if (typeof candidate?.exactVersion !== 'string' || !EXACT_VERSION.test(candidate.exactVersion)) {
      add(findings, 'release-bound-component', 'ratification.components', 'Every component binding must pin one exact immutable version.')
      continue
    }
    if (!Value.Check(TenantComponentTrustBindingSchema, component)) {
      add(findings, 'arbitrary-server-component', 'ratification.components', 'Component bindings cannot persist or dynamically import executable tenant source.')
      continue
    }
    if (!componentTrustIsValid(component)) add(findings, 'arbitrary-server-component', 'ratification.components', 'Only compiled official components may execute as Server Components.')
  }
  const cookies = Array.isArray(ratification?.cookies) ? ratification.cookies : []
  if (cookies.some((cookie) => !Value.Check(TenantSiteCookieSchema, cookie))) {
    add(findings, 'unsafe-cookie', 'ratification.cookies', 'Site-member cookies must be Secure, HttpOnly, SameSite=Lax, Path=/, host-only, and separate from staff realms.')
  }
  const jsxKey = findPersistedKey(fixture.persistedRecords, new Set(['jsx', 'tsx', 'componentSource', 'serverComponentSource']))
  if (jsxKey) add(findings, 'persisted-jsx', 'persistedRecords', `Persisted records contain forbidden executable field ${jsxKey}.`)
  const utilityKey = findPersistedKey(fixture.persistedRecords, new Set(['tailwindUtilities', 'tailwindSource', 'utilitySource', 'compiledUtilities']))
  if (utilityKey) add(findings, 'persisted-tailwind-utilities', 'persistedRecords', `Persisted records contain forbidden Tailwind compilation field ${utilityKey}.`)
}

function orderedUnique(findings: readonly SiteRuntimeGateFinding[]): SiteRuntimeGateFinding[] {
  const order = new Map(SITE_RUNTIME_GATE_RULE_IDS.map((rule, index) => [rule, index]))
  const unique = new Map<string, SiteRuntimeGateFinding>()
  for (const finding of findings) unique.set(`${finding.ruleId}\0${finding.path}\0${finding.detail}`, finding)
  return [...unique.values()].sort((left, right) => (order.get(left.ruleId) ?? 0) - (order.get(right.ruleId) ?? 0) || left.path.localeCompare(right.path, 'en'))
}

export function auditTenantRuntimeFixture(value: unknown): readonly SiteRuntimeGateFinding[] {
  if (!Value.Check(FixtureSchema, value)) throw new TenantRuntimeAuditError('SITE-001 fixture failed its strict TypeBox envelope.')
  const fixture = structuredClone(value) as TenantRuntimeFixture
  const findings: SiteRuntimeGateFinding[] = []
  applicationFindings(fixture, findings)
  sourceFindings(fixture, findings)
  trustFindings(fixture, findings)
  const ordered = orderedUnique(findings)
  if (ordered.length === 0) validateTenantRuntimeRatification(fixture.ratification)
  return ordered
}
