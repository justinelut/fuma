import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  readFileSync,
} from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import * as ts from 'typescript'

export const WORKSPACE_BOUNDARY_RULE_IDS = [
  'workspace-topology',
  'root-orchestrator',
  'duplicate-package-name',
  'leaf-package-boundary',
  'nested-git',
  'nested-lockfile',
  'app-to-app-import',
  'next-in-studio',
  'web-authority-import',
  'public-contracts-runtime-import',
  'zod',
  'shared-cookie',
  'unsafe-cookie',
  'session-cookie-reuse',
  'better-auth-host',
  'product-route-on-admin',
  'console-route-on-app',
  'staff-surface-on-public-host',
  'reserved-tenant-name',
  'reserved-set-incomplete',
  'unknown-host-fallback',
  'public-api-host',
  'visitor-credential-forwarding',
  'hardcoded-price',
  'private-commercial-field',
] as const

export type WorkspaceBoundaryRuleId = typeof WORKSPACE_BOUNDARY_RULE_IDS[number]

export type WorkspaceBoundaryFinding = Readonly<{
  ruleId: WorkspaceBoundaryRuleId
  path: string
  line: number
  detail: string
}>

const WorkspaceBoundaryPolicySchema = Type.Object({
  apps: Type.Tuple([Type.Literal('studio'), Type.Literal('web')]),
  leafPackages: Type.Tuple([
    Type.Literal('brand'),
    Type.Literal('design-tokens'),
    Type.Literal('public-contracts'),
  ]),
  hosts: Type.Object({
    public: Type.Literal('fuma.co.ke'),
    auth: Type.Literal('auth.fuma.co.ke'),
    product: Type.Literal('app.fuma.co.ke'),
    console: Type.Literal('admin.fuma.co.ke'),
  }, { additionalProperties: false }),
  reservedTenantNames: Type.Tuple([
    Type.Literal('auth'),
    Type.Literal('app'),
    Type.Literal('www'),
    Type.Literal('api'),
    Type.Literal('admin'),
    Type.Literal('status'),
    Type.Literal('support'),
    Type.Literal('mail'),
  ]),
}, { additionalProperties: false })

export type WorkspaceBoundaryPolicy = Static<typeof WorkspaceBoundaryPolicySchema>

export const FUMA_WORKSPACE_BOUNDARY_POLICY: WorkspaceBoundaryPolicy = Object.freeze({
  apps: ['studio', 'web'],
  leafPackages: ['brand', 'design-tokens', 'public-contracts'],
  hosts: {
    public: 'fuma.co.ke',
    auth: 'auth.fuma.co.ke',
    product: 'app.fuma.co.ke',
    console: 'admin.fuma.co.ke',
  },
  reservedTenantNames: ['auth', 'app', 'www', 'api', 'admin', 'status', 'support', 'mail'],
})

const DependencyMapSchema = Type.Record(Type.String(), Type.String())
const PackageManifestSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  private: Type.Optional(Type.Boolean()),
  packageManager: Type.Optional(Type.String({ minLength: 1 })),
  workspaces: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  scripts: Type.Optional(DependencyMapSchema),
  dependencies: Type.Optional(DependencyMapSchema),
  devDependencies: Type.Optional(DependencyMapSchema),
  peerDependencies: Type.Optional(DependencyMapSchema),
  optionalDependencies: Type.Optional(DependencyMapSchema),
}, { additionalProperties: true })

type PackageManifest = Static<typeof PackageManifestSchema>
type PackageKind = 'app' | 'package'
type PackageRecord = Readonly<{
  kind: PackageKind
  id: string
  root: string
  manifestPath: string
  manifest: PackageManifest
}>
type CollectedFile = Readonly<{ absolutePath: string, path: string }>
type AuditContext = {
  root: string
  policy: WorkspaceBoundaryPolicy
  files: readonly CollectedFile[]
  packageRecords: readonly PackageRecord[]
  packageNames: ReadonlyMap<string, PackageRecord>
  findings: WorkspaceBoundaryFinding[]
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const RUNTIME_CONTENT_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.md', '.mdx', '.json', '.yaml', '.yml', '.toml'])
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', '.next', 'coverage', '.cache', '.turbo'])
const LOCKFILE_NAMES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'])
const PRESERVED_VENDORED_LOCKFILES = new Set(['vendor/pixel-art-icons/bun.lock'])
const REQUIRED_ROOT_ENTRIES = ['apps', 'packages', 'infra', 'tooling', 'vendor', 'docs', 'package.json', 'bun.lock', 'tsconfig.base.json'] as const
const RULE_ORDER = new Map(WORKSPACE_BOUNDARY_RULE_IDS.map((ruleId, index) => [ruleId, index]))
const PRODUCT_ROUTE = /^\/(?:admin\/)?organizations(?:\/|$)|^\/(?:editor|onboarding|account|billing)(?:\/|$)/i
const CONSOLE_ROUTE = /^\/(?:console|internal|platform|support|moderation|break-glass)(?:\/|$)/i
const STAFF_ROUTE = /^\/(?:sign-in|sign-up|login|logout|mfa|recovery|verify|auth)(?:\/|$)/i
const ALLOCATION_CALL = /(?:allocate|assign|claim|provision|register|create).*(?:tenant|subdomain|host)|(?:tenant|subdomain|host).*(?:allocate|assign|claim|provision|register|create)/i
const HARDCODED_PRICE_TEXT = /(?:\bKES|\bKSh)\s*\d[\d,.]*(?:\s*\/\s*(?:month|year))?|\$\s*\d+(?:\.\d{1,2})?/i
const HARDCODED_TRUTH_FIELD = /^(?:price|amount|monthlyPrice|annualPrice|monthlyAmount|annualAmount|amountMinor|priceMinor|quota|quotas|limits|includedFeatures|featureIncluded|checkoutAvailable|promotion|promotionTerms)$/i
const PRIVATE_COMMERCIAL_FIELD = /^(?:paystackPlanId|providerPlanId|providerPriceId|providerId|providerCost|costMinor|margin|grossMargin|internalEntitlements?|grandfatheredContract|privateOffer|paymentState|transferState|cogs)$/i
const UNKNOWN_FALLBACK_FIELD = /^(?:unknownHostFallback|defaultHost|defaultSite|fallbackHost|fallbackSite)$/i
const STAFF_COOKIE_NAMES = new Map([
  ['__Host-fuma_auth', 'auth.fuma.co.ke'],
  ['__Host-fuma_app', 'app.fuma.co.ke'],
  ['__Host-fuma_admin', 'admin.fuma.co.ke'],
])
const DIRECT_AUTHORITY_DEPENDENCIES = new Set([
  'better-auth', '@better-auth/drizzle-adapter', 'postgres', 'drizzle-orm', 'redis', 'ioredis', 'minio',
  '@aws-sdk/client-s3', '@aws-sdk/client-ses', '@paystack/paystack-sdk',
])
const PUBLIC_CONTRACT_RUNTIME_DEPENDENCIES = new Set([
  'react', 'react-dom', 'next', 'better-auth', '@better-auth/drizzle-adapter', 'postgres', 'drizzle-orm',
  'redis', 'ioredis', 'minio', '@aws-sdk/client-s3', '@aws-sdk/client-ses',
])

export class WorkspaceBoundaryAuditError extends Error {
  override readonly name = 'WorkspaceBoundaryAuditError'
}

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length
}

function addFinding(context: AuditContext, ruleId: WorkspaceBoundaryRuleId, path: string, detail: string, line = 1): void {
  context.findings.push({ ruleId, path, line, detail })
}

function readRegularFile(path: string): string {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    if (!fstatSync(descriptor).isFile()) throw new WorkspaceBoundaryAuditError(`Refusing to read non-file entry: ${path}`)
    return readFileSync(descriptor, 'utf8')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function collectFiles(root: string): CollectedFile[] {
  const files: CollectedFile[] = []
  const walk = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const path = normalizePath(relative(root, absolutePath))
      if (entry.isSymbolicLink()) {
        if (entry.name === '.git' || LOCKFILE_NAMES.has(entry.name)) files.push({ absolutePath, path })
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          if (directory !== root) files.push({ absolutePath, path })
          continue
        }
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(absolutePath)
      } else if (entry.isFile()) {
        files.push({ absolutePath, path })
      }
    }
  }
  walk(root)
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function parseJson(source: string, path: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new WorkspaceBoundaryAuditError(`Invalid JSON at ${path}.`, { cause: error })
  }
}

function parsePolicy(value: unknown): WorkspaceBoundaryPolicy {
  if (!Value.Check(WorkspaceBoundaryPolicySchema, value)) {
    throw new WorkspaceBoundaryAuditError('Workspace boundary policy failed TypeBox validation.')
  }
  return Value.Decode(WorkspaceBoundaryPolicySchema, value)
}

function readManifest(context: AuditContext, path: string, ruleId: WorkspaceBoundaryRuleId): PackageManifest | undefined {
  const absolutePath = join(context.root, path)
  if (!existsSync(absolutePath)) {
    addFinding(context, ruleId, path, 'Required package.json is missing.')
    return undefined
  }
  try {
    const candidate = parseJson(readRegularFile(absolutePath), path)
    if (!Value.Check(PackageManifestSchema, candidate)) {
      addFinding(context, ruleId, path, 'package.json failed TypeBox validation.')
      return undefined
    }
    return Value.Decode(PackageManifestSchema, candidate)
  } catch (error) {
    addFinding(context, ruleId, path, error instanceof Error ? error.message : 'package.json is invalid.')
    return undefined
  }
}

function directDirectories(root: string, path: string): Readonly<{ directories: string[], symlinks: string[] }> {
  const absolutePath = join(root, path)
  if (!existsSync(absolutePath)) return { directories: [], symlinks: [] }
  const entries = readdirSync(absolutePath, { withFileTypes: true })
  const sort = (values: string[]): string[] => values.sort((left, right) => left.localeCompare(right, 'en'))
  return {
    directories: sort(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)),
    symlinks: sort(entries.filter((entry) => entry.isSymbolicLink()).map((entry) => entry.name)),
  }
}

function validateRoot(context: AuditContext): void {
  for (const entry of REQUIRED_ROOT_ENTRIES) {
    if (!existsSync(join(context.root, entry))) addFinding(context, 'workspace-topology', entry, `Required workspace root entry ${entry} is missing.`)
  }
  const manifest = readManifest(context, 'package.json', 'root-orchestrator')
  if (!manifest) return
  const workspaces = manifest.workspaces ?? []
  if (manifest.private !== true || workspaces.length !== 2 || !workspaces.includes('apps/*') || !workspaces.includes('packages/*')) {
    addFinding(context, 'root-orchestrator', 'package.json', 'Root must be private and declare only apps/* and packages/* Bun workspaces.')
  }
  if (manifest.packageManager && !manifest.packageManager.startsWith('bun@')) {
    addFinding(context, 'root-orchestrator', 'package.json', 'Root packageManager must be Bun.')
  }
  const allDependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const scripts = manifest.scripts ?? {}
  if ('turbo' in allDependencies || '@vercel/turbo' in allDependencies || Object.values(scripts).some((script) => /\bturbo\b/.test(script))) {
    addFinding(context, 'root-orchestrator', 'package.json', 'Turborepo is forbidden; native Bun workspaces own orchestration.')
  }
}

function topology(context: AuditContext): PackageRecord[] {
  const records: PackageRecord[] = []
  const groups: readonly Readonly<{ directory: string, expected: readonly string[], kind: PackageKind }>[] = [
    { directory: 'apps', expected: context.policy.apps, kind: 'app' },
    { directory: 'packages', expected: context.policy.leafPackages, kind: 'package' },
  ]
  for (const group of groups) {
    const entries = directDirectories(context.root, group.directory)
    const expected = new Set<string>(group.expected)
    for (const id of entries.symlinks) addFinding(context, 'workspace-topology', `${group.directory}/${id}`, `Workspace ${group.kind} roots must not be symlinks.`)
    for (const id of entries.directories) {
      if (!expected.has(id)) addFinding(context, 'workspace-topology', `${group.directory}/${id}`, `Unapproved workspace ${group.kind} directory.`)
    }
    for (const id of group.expected) {
      if (!entries.directories.includes(id)) {
        addFinding(context, 'workspace-topology', `${group.directory}/${id}`, `Required workspace ${group.kind} directory is missing.`)
        continue
      }
      const manifestPath = `${group.directory}/${id}/package.json`
      const manifest = readManifest(context, manifestPath, 'workspace-topology')
      if (manifest) records.push({ kind: group.kind, id, root: `${group.directory}/${id}`, manifestPath, manifest })
    }
  }
  const names = new Map<string, PackageRecord>()
  for (const record of records) {
    const prior = names.get(record.manifest.name)
    if (prior) addFinding(context, 'duplicate-package-name', record.manifestPath, `Package name ${record.manifest.name} is already owned by ${prior.manifestPath}.`)
    else names.set(record.manifest.name, record)
  }
  return records
}

function dependencies(manifest: PackageManifest): Readonly<Record<string, string>> {
  return { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }
}

function packageDependencyFindings(context: AuditContext): void {
  const appsByName = new Map(context.packageRecords.filter(({ kind }) => kind === 'app').map((record) => [record.manifest.name, record]))
  for (const record of context.packageRecords) {
    for (const dependency of Object.keys(dependencies(record.manifest)).sort((left, right) => left.localeCompare(right, 'en'))) {
      const targetApp = appsByName.get(dependency)
      if (record.kind === 'app' && targetApp && targetApp.id !== record.id) {
        addFinding(context, 'app-to-app-import', record.manifestPath, `App ${record.id} depends on app ${targetApp.id}.`)
      }
      if (record.kind === 'package' && context.packageNames.has(dependency)) {
        addFinding(context, 'leaf-package-boundary', record.manifestPath, `Leaf package ${record.id} depends on workspace package ${dependency}.`)
      }
      if (record.id === 'studio' && (dependency === 'next' || dependency.startsWith('@next/'))) {
        addFinding(context, 'next-in-studio', record.manifestPath, `Studio declares forbidden Next.js dependency ${dependency}.`)
      }
      if (dependency === 'zod' || dependency.startsWith('zod/')) {
        addFinding(context, 'zod', record.manifestPath, `Workspace package declares forbidden Zod dependency ${dependency}.`)
      }
      if (record.id === 'web' && (DIRECT_AUTHORITY_DEPENDENCIES.has(dependency) || authoritySpecifier(dependency))) {
        addFinding(context, 'web-authority-import', record.manifestPath, `Public Web declares private authority dependency ${dependency}.`)
      }
      if (record.id === 'public-contracts' && (PUBLIC_CONTRACT_RUNTIME_DEPENDENCIES.has(dependency) || authoritySpecifier(dependency) || dependency.startsWith('bun:'))) {
        addFinding(context, 'public-contracts-runtime-import', record.manifestPath, `public-contracts declares forbidden runtime dependency ${dependency}.`)
      }
    }
  }
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function staticString(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}

function staticBoolean(node: ts.Node | undefined): boolean | undefined {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function staticModuleReferences(sourceFile: ts.SourceFile): ReadonlyArray<Readonly<{ specifier: string, node: ts.Node }>> {
  const references: Array<Readonly<{ specifier: string, node: ts.Node }>> = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = staticString(node.moduleSpecifier)
      if (specifier) references.push({ specifier, node })
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = staticString(node.moduleReference.expression)
      if (specifier) references.push({ specifier, node })
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport || requireCall) {
        const specifier = staticString(node.arguments[0])
        if (specifier) references.push({ specifier, node })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return references
}

function ownerForPath(context: AuditContext, path: string): PackageRecord | undefined {
  return context.packageRecords.find((record) => path === record.root || path.startsWith(`${record.root}/`))
}

function referencedOwner(context: AuditContext, importerPath: string, specifier: string): PackageRecord | undefined {
  const direct = context.packageNames.get(specifier) ?? context.packageNames.get(specifier.split('/').slice(0, 2).join('/'))
  if (direct) return direct
  if (specifier.startsWith('.')) {
    const target = normalizePath(relative(context.root, resolve(context.root, dirname(importerPath), specifier)))
    return ownerForPath(context, target)
  }
  const match = specifier.match(/(?:^|\/)(apps|packages)\/(studio|web|brand|design-tokens|public-contracts)(?:\/|$)/)
  return match ? context.packageRecords.find((record) => record.id === match[2]) : undefined
}

function authoritySpecifier(specifier: string): boolean {
  if (DIRECT_AUTHORITY_DEPENDENCIES.has(specifier) || specifier.startsWith('bun:sqlite')) return true
  return specifier.split('/').some((segment) => /^(?:server|auth|providers?|publisher|publish|repositories?|migrations?|admin|billing|paystack|entitlements?|moderation|tenant-routing|database|db)$/.test(segment))
}

function importFindings(context: AuditContext, file: CollectedFile, sourceFile: ts.SourceFile): void {
  const owner = ownerForPath(context, file.path)
  if (!owner) return
  for (const reference of staticModuleReferences(sourceFile)) {
    const target = referencedOwner(context, file.path, reference.specifier)
    const line = sourceFile.getLineAndCharacterOfPosition(reference.node.getStart(sourceFile)).line + 1
    if (owner.kind === 'app' && target?.kind === 'app' && target.id !== owner.id) {
      addFinding(context, 'app-to-app-import', file.path, `App ${owner.id} imports app ${target.id}.`, line)
    }
    if (owner.kind === 'package' && target && target.id !== owner.id) {
      addFinding(context, 'leaf-package-boundary', file.path, `Leaf package ${owner.id} imports workspace ${target.kind} ${target.id}.`, line)
    }
    if (owner.id === 'studio' && (reference.specifier === 'next' || reference.specifier.startsWith('next/') || reference.specifier.startsWith('@next/'))) {
      addFinding(context, 'next-in-studio', file.path, `Studio imports forbidden Next.js module ${reference.specifier}.`, line)
    }
    if (reference.specifier === 'zod' || reference.specifier.startsWith('zod/')) {
      addFinding(context, 'zod', file.path, `Source imports forbidden Zod module ${reference.specifier}.`, line)
    }
    if (owner.id === 'web' && (target?.id === 'studio' || authoritySpecifier(reference.specifier))) {
      addFinding(context, 'web-authority-import', file.path, `Public Web imports private authority module ${reference.specifier}.`, line)
    }
    if (owner.id === 'public-contracts' && (target !== undefined || PUBLIC_CONTRACT_RUNTIME_DEPENDENCIES.has(reference.specifier) || authoritySpecifier(reference.specifier) || reference.specifier.startsWith('bun:'))) {
      addFinding(context, 'public-contracts-runtime-import', file.path, `public-contracts imports forbidden runtime module ${reference.specifier}.`, line)
    }
  }
}

function objectProperties(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const properties = new Map<string, ts.Expression>()
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
    if (name) properties.set(name, property.initializer)
  }
  return properties
}

function objectLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function semanticFindings(context: AuditContext, file: CollectedFile, sourceFile: ts.SourceFile): void {
  const reserved = new Set<string>(context.policy.reservedTenantNames)
  const owner = ownerForPath(context, file.path)
  let declaresReservedSet = false
  const importsBetterAuth = staticModuleReferences(sourceFile).some(({ specifier }) => specifier === 'better-auth' || specifier.startsWith('@better-auth/'))
  if (importsBetterAuth && owner?.id === 'studio') {
    const stringLiterals = new Set<string>()
    const collectStrings = (node: ts.Node): void => {
      const value = staticString(node)
      if (value !== undefined) stringLiterals.add(value)
      ts.forEachChild(node, collectStrings)
    }
    collectStrings(sourceFile)
    const hasAuthHost = stringLiterals.has(context.policy.hosts.auth)
    const hasWrongHost = [context.policy.hosts.public, context.policy.hosts.product, context.policy.hosts.console]
      .some((host) => stringLiterals.has(host))
    if (!hasAuthHost || hasWrongHost) addFinding(context, 'better-auth-host', file.path, 'Better Auth may only mount on auth.fuma.co.ke.')
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /reserved.*(?:tenant|host|subdomain)/i.test(node.name.text) && ts.isArrayLiteralExpression(node.initializer)) {
      declaresReservedSet = true
      const actual = new Set(node.initializer.elements.map((element) => staticString(element)?.toLowerCase()).filter((value): value is string => value !== undefined))
      if ([...reserved].some((name) => !actual.has(name))) {
        addFinding(context, 'reserved-set-incomplete', file.path, 'Tenant allocation policy omits a mandatory reserved label.', objectLine(sourceFile, node))
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const properties = objectProperties(node)
      const strings = new Map([...properties].map(([name, value]) => [name, staticString(value)]))
      const host = strings.get('host')
      const path = strings.get('path')
      const line = objectLine(sourceFile, node)
      if (host === context.policy.hosts.console && path && PRODUCT_ROUTE.test(path)) addFinding(context, 'product-route-on-admin', file.path, 'Customer product route is assigned to the internal console host.', line)
      if (host === context.policy.hosts.product && path && CONSOLE_ROUTE.test(path)) addFinding(context, 'console-route-on-app', file.path, 'Internal console route is assigned to the customer product host.', line)
      if (host && ![context.policy.hosts.auth, context.policy.hosts.product, context.policy.hosts.console].includes(host) && path && STAFF_ROUTE.test(path)) {
        addFinding(context, 'staff-surface-on-public-host', file.path, 'Staff identity route is mounted on a public, tenant, or customer host.', line)
      }
      if (properties.has('domain')) addFinding(context, 'shared-cookie', file.path, 'Session cookies must omit Domain and remain host-only.', line)
      const cookieName = strings.get('name')
      if (cookieName && STAFF_COOKIE_NAMES.has(cookieName)) {
        const expectedHost = STAFF_COOKIE_NAMES.get(cookieName)
        const safe = staticBoolean(properties.get('secure')) === true
          && staticBoolean(properties.get('httpOnly')) === true
          && strings.get('sameSite')?.toLowerCase() === 'lax'
          && strings.get('path') === '/'
          && !properties.has('domain')
        if (!safe) addFinding(context, 'unsafe-cookie', file.path, `Staff cookie ${cookieName} must be Secure, HttpOnly, SameSite=Lax, Path=/, and host-only.`, line)
        if (host !== expectedHost) addFinding(context, 'session-cookie-reuse', file.path, `Staff cookie ${cookieName} is bound to the wrong relying host.`, line)
        if (host && ![context.policy.hosts.auth, context.policy.hosts.product, context.policy.hosts.console].includes(host)) {
          addFinding(context, 'staff-surface-on-public-host', file.path, 'Staff cookie is exposed to a public, tenant, or customer host.', line)
        }
      }
      for (const [name, value] of properties) {
        if (UNKNOWN_FALLBACK_FIELD.test(name) && value.kind !== ts.SyntaxKind.NullKeyword && value.kind !== ts.SyntaxKind.FalseKeyword) {
          addFinding(context, 'unknown-host-fallback', file.path, `Host policy declares forbidden fallback ${name}.`, line)
        }
        if ((owner?.id === 'web' || owner?.id === 'public-contracts') && PRIVATE_COMMERCIAL_FIELD.test(name)) {
          addFinding(context, 'private-commercial-field', file.path, `Public boundary declares private commercial field ${name}.`, line)
        }
        if (owner?.id === 'web' && HARDCODED_TRUTH_FIELD.test(name) && (ts.isNumericLiteral(value) || ts.isStringLiteral(value) || ts.isArrayLiteralExpression(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword)) {
          addFinding(context, 'hardcoded-price', file.path, `Public Web hardcodes authoritative pricing field ${name}.`, line)
        }
      }
    }
    if (ts.isCallExpression(node) && ALLOCATION_CALL.test(node.expression.getText(sourceFile))) {
      for (const argument of node.arguments) {
        const value = staticString(argument)?.toLowerCase()
        if (value && reserved.has(value)) addFinding(context, 'reserved-tenant-name', file.path, `Tenant allocation uses reserved name ${value}.`, objectLine(sourceFile, argument))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (file.path.includes('/tenancy/') && /reserved/i.test(file.path) && !declaresReservedSet) {
    addFinding(context, 'reserved-set-incomplete', file.path, 'Tenant allocation source must declare every mandatory reserved label.')
  }
}

function scopedTextFindings(context: AuditContext, file: CollectedFile, source: string): void {
  const runtimeScope = /^(?:apps|packages|infra)\//.test(file.path)
  if (!runtimeScope) return
  const apiIndex = source.indexOf('api.fuma.co.ke')
  if (apiIndex >= 0) addFinding(context, 'public-api-host', file.path, 'Public api.fuma.co.ke is forbidden at launch.', lineAt(source, apiIndex))
  const domainMatch = /(?:\bDomain\s*=\s*\.?fuma\.co\.ke\b|\bdomain\s*:\s*['"]\.?fuma\.co\.ke['"]|FUMA_COOKIE_DOMAIN|\bsharedCookie\b)/i.exec(source)
  if (domainMatch) addFinding(context, 'shared-cookie', file.path, 'Sessions must be distinct host-only cookies with no parent Domain.', lineAt(source, domainMatch.index))
  if (file.path.startsWith('apps/web/')) {
    const credentialMatch = /(?:headers\s*:\s*(?:request|req)\.headers|(?:cookie|authorization)['"]?\s*:\s*(?:request|req)\.headers(?:\.get)?)/i.exec(source)
    if (credentialMatch) addFinding(context, 'visitor-credential-forwarding', file.path, 'Public BFF must not forward visitor Cookie or Authorization headers.', lineAt(source, credentialMatch.index))
    const priceMatch = HARDCODED_PRICE_TEXT.exec(source)
    if (priceMatch) addFinding(context, 'hardcoded-price', file.path, 'Public Web contains a hardcoded display price instead of an approved projection.', lineAt(source, priceMatch.index))
    if (!SOURCE_EXTENSIONS.has(extname(file.path))) {
      const privateMatch = /\b(?:paystackPlanId|providerPlanId|providerPriceId|providerCost|grossMargin|internalEntitlement|grandfatheredContract|privateOffer|paymentState|transferState|cogs)\s*:/i.exec(source)
      if (privateMatch) addFinding(context, 'private-commercial-field', file.path, 'Public content contains private commercial authority.', lineAt(source, privateMatch.index))
      const truthMatch = /\b(?:price|amount|quota|checkoutAvailable|promotionTerms)\s*:\s*(?:\d+|true|false|['"][^'"]+['"])/i.exec(source)
      if (truthMatch) addFinding(context, 'hardcoded-price', file.path, 'Public content hardcodes authoritative pricing truth.', lineAt(source, truthMatch.index))
    }
  }
}

function repositoryFindings(context: AuditContext): void {
  if (context.files.some(({ path }) => path === '.gitmodules')) addFinding(context, 'nested-git', '.gitmodules', 'Git submodules are forbidden.')
  for (const file of context.files) {
    const segments = file.path.split('/')
    if (segments.includes('.git')) addFinding(context, 'nested-git', file.path, 'Nested Git metadata is forbidden.')
    const name = segments.at(-1) ?? ''
    if (LOCKFILE_NAMES.has(name) && file.path !== 'bun.lock' && !PRESERVED_VENDORED_LOCKFILES.has(file.path)) {
      addFinding(context, 'nested-lockfile', file.path, 'Root bun.lock is the only install-authority lockfile.')
    }
  }
  if (!context.files.some(({ path }) => path === 'bun.lock')) addFinding(context, 'nested-lockfile', 'bun.lock', 'Workspace root bun.lock is required.')
}

function deduplicateAndSort(findings: readonly WorkspaceBoundaryFinding[]): WorkspaceBoundaryFinding[] {
  const unique = new Map<string, WorkspaceBoundaryFinding>()
  for (const finding of findings) unique.set(`${finding.ruleId}\0${finding.path}\0${finding.line}\0${finding.detail}`, finding)
  return [...unique.values()].sort((left, right) => {
    const ruleDifference = (RULE_ORDER.get(left.ruleId) ?? 0) - (RULE_ORDER.get(right.ruleId) ?? 0)
    return ruleDifference || left.path.localeCompare(right.path, 'en') || left.line - right.line || left.detail.localeCompare(right.detail, 'en')
  })
}

/** Audits a supplied future Fuma workspace without following symlinks. */
export function auditFutureWorkspace(workspaceDirectory: string, untypedPolicy: unknown = FUMA_WORKSPACE_BOUNDARY_POLICY): readonly WorkspaceBoundaryFinding[] {
  const requestedRoot = resolve(workspaceDirectory)
  if (!existsSync(requestedRoot)) throw new WorkspaceBoundaryAuditError(`Workspace does not exist: ${requestedRoot}`)
  if (lstatSync(requestedRoot).isSymbolicLink()) throw new WorkspaceBoundaryAuditError('Workspace root must not be a symlink.')
  const root = realpathSync(requestedRoot)
  if (!lstatSync(root).isDirectory()) throw new WorkspaceBoundaryAuditError('Workspace root must be a directory.')

  const context: AuditContext = {
    root,
    policy: parsePolicy(untypedPolicy),
    files: collectFiles(root),
    packageRecords: [],
    packageNames: new Map(),
    findings: [],
  }
  validateRoot(context)
  context.packageRecords = topology(context)
  context.packageNames = new Map(context.packageRecords.map((record) => [record.manifest.name, record]))
  repositoryFindings(context)
  packageDependencyFindings(context)

  for (const file of context.files) {
    const segments = file.path.split('/')
    const name = segments.at(-1) ?? ''
    if (segments.includes('.git') || LOCKFILE_NAMES.has(name) || file.path === 'package.json' || file.path.endsWith('/package.json')) continue
    const extension = extname(file.path)
    if (!RUNTIME_CONTENT_EXTENSIONS.has(extension)) continue
    const source = readRegularFile(file.absolutePath)
    scopedTextFindings(context, file, source)
    if (!SOURCE_EXTENSIONS.has(extension)) continue
    const sourceFile = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, true, scriptKind(file.path))
    importFindings(context, file, sourceFile)
    semanticFindings(context, file, sourceFile)
  }

  return deduplicateAndSort(context.findings)
}
