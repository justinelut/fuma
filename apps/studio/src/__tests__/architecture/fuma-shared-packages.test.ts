import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..')
const BOUNDED_PACKAGE_IDS = ['brand', 'design-tokens', 'public-contracts'] as const
const REPOSITORY_PACKAGE_IDS = [...BOUNDED_PACKAGE_IDS, 'fuma-governance-launch'] as const
const REPOSITORY_APP_IDS = ['control-surfaces', 'site-runtime', 'studio', 'web'] as const
const EXPECTED_PACKAGE_NAMES = new Map([
  ['brand', '@fuma/brand'],
  ['design-tokens', '@fuma/design-tokens'],
  ['public-contracts', '@fuma/public-contracts'],
])
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const LOCKFILES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const PRIVATE_COMMERCIAL_FIELD = /^(?:paystackPlanId|providerPlanId|providerPriceId|providerId|providerCost|costMinor|margin|grossMargin|internalEntitlements?|grandfatheredContract|privateOffer|paymentState|transferState|cogs)$/i
const FRAMEWORK_SPECIFIER = /^(?:node:|bun:|react(?:\/|$)|react-dom(?:\/|$)|next(?:\/|$)|vue(?:\/|$)|svelte(?:\/|$)|solid-js(?:\/|$)|preact(?:\/|$)|lit(?:\/|$)|@angular\/|@emotion\/|styled-components(?:\/|$)|tailwindcss(?:\/|$)|@tailwindcss\/|shadcn(?:\/|$)|class-variance-authority(?:\/|$)|clsx(?:\/|$)|tailwind-merge(?:\/|$)|tw-animate-css(?:\/|$)|lucide-react(?:\/|$)|radix-ui(?:\/|$)|@radix-ui\/|@base-ui-components\/)/
const CONTRACT_AUTHORITY_SPECIFIER = /^(?:node:|bun:|react(?:\/|$)|react-dom(?:\/|$)|next(?:\/|$)|better-auth(?:\/|$)|@better-auth\/|postgres(?:\/|$)|drizzle-orm(?:\/|$)|redis(?:\/|$)|ioredis(?:\/|$)|minio(?:\/|$)|@aws-sdk\/|@paystack\/|@fuma\/)/
const CONTRACT_AUTHORITY_SEGMENT = /^(?:apps?|studio|server|auth|providers?|publisher|publish|repositories?|migrations?|admin|billing|paystack|entitlements?|moderation|tenant-routing|database|db)$/

const RULE_IDS = [
  'package-topology',
  'app-topology',
  'package-name',
  'duplicate-package-name',
  'package-leaf',
  'package-cycle',
  'export-surface',
  'nested-lockfile',
  'public-contract-typebox-only',
  'public-contract-authority',
  'private-commercial-field',
  'framework-neutral',
] as const

type RuleId = typeof RULE_IDS[number]
type Finding = Readonly<{ ruleId: RuleId, path: string, detail: string }>
type JsonObject = Record<string, unknown>
type PackageRecord = Readonly<{ id: string, root: string, manifestPath: string, manifest: JsonObject }>
type SourceFile = Readonly<{ absolutePath: string, path: string, source: string, ast: ts.SourceFile }>

const temporaryDirectories: string[] = []

function normalize(path: string): string {
  return path.split(sep).join('/')
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function readJson(path: string): JsonObject | undefined {
  if (!existsSync(path) || !lstatSync(path).isFile()) return undefined
  try {
    return object(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

function directories(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function symlinks(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function lockfileEntries(root: string): string[] {
  if (!existsSync(root)) return []
  const locks: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (LOCKFILES.has(entry.name)) locks.push(absolutePath)
      if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules') walk(absolutePath)
    }
  }
  walk(root)
  return locks
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) walk(absolutePath)
      else if (entry.isFile()) files.push(absolutePath)
    }
  }
  walk(root)
  return files
}

function dependencyNames(manifest: JsonObject): string[] {
  const names = new Set<string>()
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = object(manifest[field])
    if (dependencies) for (const name of Object.keys(dependencies)) names.add(name)
  }
  return [...names].sort((left, right) => left.localeCompare(right, 'en'))
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function sourceFiles(repositoryRoot: string, packageRecord: PackageRecord): SourceFile[] {
  const sourceRoot = join(packageRecord.root, 'src')
  return walkFiles(sourceRoot)
    .filter((path) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))))
    .map((absolutePath) => {
      const path = normalize(relative(repositoryRoot, absolutePath))
      const source = readFileSync(absolutePath, 'utf8')
      return { absolutePath, path, source, ast: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path)) }
    })
}

function staticSpecifier(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = staticSpecifier(node.moduleSpecifier)
      if (specifier) specifiers.push(specifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = staticSpecifier(node.moduleReference.expression)
      if (specifier) specifiers.push(specifier)
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire) {
        const specifier = staticSpecifier(node.arguments[0])
        if (specifier) specifiers.push(specifier)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function workspacePackageName(specifier: string, names: ReadonlySet<string>): string | undefined {
  return [...names].find((name) => specifier === name || specifier.startsWith(`${name}/`))
}

function hasCycle(edges: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string): boolean => {
    if (visiting.has(name)) return true
    if (visited.has(name)) return false
    visiting.add(name)
    for (const target of edges.get(name) ?? []) if (visit(target)) return true
    visiting.delete(name)
    visited.add(name)
    return false
  }
  return [...edges.keys()].some(visit)
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportTargets)
  const record = object(value)
  return record ? Object.values(record).flatMap(exportTargets) : []
}

function rootExport(value: unknown): unknown {
  const record = object(value)
  return record && '.' in record ? record['.'] : value
}

function exportKeys(value: unknown): string[] {
  const record = object(value)
  return record ? Object.keys(record) : []
}

function authoritySpecifier(specifier: string): boolean {
  return CONTRACT_AUTHORITY_SPECIFIER.test(specifier)
    || specifier.split('/').some((segment) => CONTRACT_AUTHORITY_SEGMENT.test(segment))
}

function propertyName(node: ts.Node): string | undefined {
  if (!('name' in node)) return undefined
  const name = (node as ts.NamedDeclaration).name
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : undefined
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function falseAdditionalProperties(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false
  return node.properties.some((property) => ts.isPropertyAssignment(property)
    && propertyName(property) === 'additionalProperties'
    && property.initializer.kind === ts.SyntaxKind.FalseKeyword)
}

function add(findings: Finding[], ruleId: RuleId, path: string, detail: string): void {
  findings.push({ ruleId, path: normalize(path), detail })
}

function auditSharedPackages(repositoryRoot: string): readonly Finding[] {
  const findings: Finding[] = []
  const packageDirectory = join(repositoryRoot, 'packages')
  const packageIds = directories(packageDirectory)
  const packageSymlinks = symlinks(packageDirectory)
  if (JSON.stringify(packageIds) !== JSON.stringify([...REPOSITORY_PACKAGE_IDS].sort()) || packageSymlinks.length > 0) {
    add(findings, 'package-topology', 'packages', `Expected exactly ${REPOSITORY_PACKAGE_IDS.join(', ')} as real directories; found directories ${packageIds.join(', ') || 'none'} and symlinks ${packageSymlinks.join(', ') || 'none'}.`)
  }

  const appDirectory = join(repositoryRoot, 'apps')
  const appIds = directories(appDirectory)
  const appSymlinks = symlinks(appDirectory)
  if (JSON.stringify(appIds) !== JSON.stringify([...REPOSITORY_APP_IDS].sort()) || appSymlinks.length > 0) {
    add(findings, 'app-topology', 'apps', `Expected exactly ${REPOSITORY_APP_IDS.join(', ')} as real application directories with no symlinks; found directories ${appIds.join(', ') || 'none'} and symlinks ${appSymlinks.join(', ') || 'none'}.`)
  }

  const packageRecords: PackageRecord[] = []
  for (const id of BOUNDED_PACKAGE_IDS) {
    const root = join(packageDirectory, id)
    const manifestPath = join(root, 'package.json')
    const manifest = readJson(manifestPath)
    if (!manifest) {
      if (existsSync(root)) add(findings, 'package-topology', relative(repositoryRoot, manifestPath), 'Package manifest is missing or invalid JSON.')
      continue
    }
    packageRecords.push({ id, root, manifestPath, manifest })
    const expectedName = EXPECTED_PACKAGE_NAMES.get(id)
    if (manifest.name !== expectedName) add(findings, 'package-name', relative(repositoryRoot, manifestPath), `Expected package name ${expectedName}.`)
  }

  const workspaceRecords: PackageRecord[] = []
  for (const [kind, ids] of [['apps', appIds], ['packages', packageIds]] as const) {
    for (const id of ids) {
      const root = join(repositoryRoot, kind, id)
      const manifestPath = join(root, 'package.json')
      const manifest = readJson(manifestPath)
      if (manifest) workspaceRecords.push({ id, root, manifestPath, manifest })
    }
  }
  const ownerByName = new Map<string, PackageRecord>()
  for (const record of workspaceRecords) {
    if (typeof record.manifest.name !== 'string') continue
    const prior = ownerByName.get(record.manifest.name)
    if (prior) add(findings, 'duplicate-package-name', relative(repositoryRoot, record.manifestPath), `${record.manifest.name} is already owned by ${normalize(relative(repositoryRoot, prior.manifestPath))}.`)
    else ownerByName.set(record.manifest.name, record)
  }

  const workspaceNames = new Set(ownerByName.keys())
  const packageNames = new Set(BOUNDED_PACKAGE_IDS.map((id) => EXPECTED_PACKAGE_NAMES.get(id)!))
  const edges = new Map<string, Set<string>>([...packageNames].map((name) => [name, new Set<string>()]))
  const allSource = new Map<string, SourceFile[]>()

  for (const record of packageRecords) {
    const ownName = EXPECTED_PACKAGE_NAMES.get(record.id)!
    for (const dependency of dependencyNames(record.manifest)) {
      if (workspaceNames.has(dependency)) {
        add(findings, 'package-leaf', relative(repositoryRoot, record.manifestPath), `${ownName} depends on workspace package ${dependency}.`)
        if (packageNames.has(dependency)) edges.get(ownName)?.add(dependency)
      }
    }
    const sources = sourceFiles(repositoryRoot, record)
    allSource.set(record.id, sources)
    for (const file of sources) {
      for (const specifier of moduleSpecifiers(file.ast)) {
        let dependency = workspacePackageName(specifier, workspaceNames)
        if (!dependency && specifier.startsWith('.')) {
          const target = resolve(dirname(file.absolutePath), specifier)
          const targetOwner = workspaceRecords.find((candidate) => target === candidate.root || target.startsWith(`${candidate.root}${sep}`))
          if (targetOwner && typeof targetOwner.manifest.name === 'string') dependency = targetOwner.manifest.name
        }
        if (dependency && dependency !== ownName) {
          add(findings, 'package-leaf', file.path, `${ownName} imports workspace package ${dependency}.`)
          if (packageNames.has(dependency)) edges.get(ownName)?.add(dependency)
        }
      }
    }

    const exportsValue = record.manifest.exports
    const targets = exportTargets(exportsValue)
    const rootTargets = exportTargets(rootExport(exportsValue))
    const invalidTarget = targets.find((target) => !target.startsWith('./src/')
      || target.includes('*')
      || normalize(target).split('/').includes('..')
      || !existsSync(resolve(record.root, target))
      || !lstatSync(resolve(record.root, target)).isFile())
    if (exportsValue === undefined
      || targets.length === 0
      || rootTargets.length === 0
      || !rootTargets.includes('./src/index.ts')
      || exportKeys(exportsValue).some((key) => key.includes('*'))
      || invalidTarget) {
      add(findings, 'export-surface', relative(repositoryRoot, record.manifestPath), 'Exports must expose an existing ./src/index.ts root source, use no wildcards, and resolve only existing source files.')
    }
  }

  if (hasCycle(edges)) add(findings, 'package-cycle', 'packages', 'Shared package dependency graph contains a cycle.')

  for (const scope of ['apps', 'packages']) {
    for (const file of lockfileEntries(join(repositoryRoot, scope))) {
      add(findings, 'nested-lockfile', relative(repositoryRoot, file), 'Only the root bun.lock may exist.')
    }
  }

  for (const id of ['brand', 'design-tokens'] as const) {
    const record = packageRecords.find((candidate) => candidate.id === id)
    if (!record) continue
    for (const dependency of dependencyNames(record.manifest)) {
      if (FRAMEWORK_SPECIFIER.test(dependency)) add(findings, 'framework-neutral', relative(repositoryRoot, record.manifestPath), `${id} declares framework dependency ${dependency}.`)
    }
    for (const file of allSource.get(id) ?? []) {
      let containsJsx = false
      const inspect = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) containsJsx = true
        ts.forEachChild(node, inspect)
      }
      inspect(file.ast)
      const frameworkImport = moduleSpecifiers(file.ast).find((specifier) => FRAMEWORK_SPECIFIER.test(specifier))
      if (containsJsx || frameworkImport) add(findings, 'framework-neutral', file.path, frameworkImport ? `${id} imports framework ${frameworkImport}.` : `${id} contains JSX.`)
    }
  }

  const contracts = packageRecords.find(({ id }) => id === 'public-contracts')
  if (contracts) {
    const dependencies = dependencyNames(contracts.manifest)
    if (!dependencies.includes('@sinclair/typebox')) {
      add(findings, 'public-contract-typebox-only', relative(repositoryRoot, contracts.manifestPath), 'public-contracts must declare @sinclair/typebox.')
    }
    for (const dependency of dependencies) {
      if (dependency === '@sinclair/typebox') continue
      add(findings, authoritySpecifier(dependency) ? 'public-contract-authority' : 'public-contract-typebox-only', relative(repositoryRoot, contracts.manifestPath), `public-contracts declares forbidden dependency ${dependency}.`)
    }

    let hasTypeObject = false
    for (const file of allSource.get('public-contracts') ?? []) {
      for (const specifier of moduleSpecifiers(file.ast)) {
        if (specifier.startsWith('.') || specifier === '@sinclair/typebox' || specifier.startsWith('@sinclair/typebox/')) continue
        add(findings, authoritySpecifier(specifier) ? 'public-contract-authority' : 'public-contract-typebox-only', file.path, `public-contracts imports forbidden module ${specifier}.`)
      }
      for (const specifier of moduleSpecifiers(file.ast).filter((value) => value.startsWith('.'))) {
        const target = resolve(dirname(file.absolutePath), specifier)
        if (target !== contracts.root && !target.startsWith(`${contracts.root}${sep}`)) {
          add(findings, 'public-contract-authority', file.path, `public-contracts escapes its package through ${specifier}.`)
        }
      }

      const inspect = (node: ts.Node): void => {
        if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'Type'
          && node.expression.name.text === 'Object') {
          hasTypeObject = true
          if (!falseAdditionalProperties(node.arguments[1])) {
            add(findings, 'public-contract-typebox-only', file.path, 'Every Type.Object public schema must set additionalProperties: false.')
          }
        }
        if (ts.isInterfaceDeclaration(node) && isExported(node)) {
          add(findings, 'public-contract-typebox-only', file.path, `Exported interface ${node.name.text} duplicates TypeBox authority.`)
        }
        if (ts.isTypeAliasDeclaration(node) && isExported(node) && ts.isTypeLiteralNode(node.type)) {
          add(findings, 'public-contract-typebox-only', file.path, `Exported object type ${node.name.text} must derive from a TypeBox schema.`)
        }
        const name = propertyName(node)
        if (name && PRIVATE_COMMERCIAL_FIELD.test(name)) {
          add(findings, 'private-commercial-field', file.path, `Public contract exposes private commercial field ${name}.`)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(file.ast)
    }
    if (!hasTypeObject) add(findings, 'public-contract-typebox-only', normalize(relative(repositoryRoot, contracts.root)), 'public-contracts must export strict TypeBox object schemas.')
  }

  const unique = new Map<string, Finding>()
  for (const finding of findings) unique.set(`${finding.ruleId}\0${finding.path}\0${finding.detail}`, finding)
  return [...unique.values()].sort((left, right) => RULE_IDS.indexOf(left.ruleId) - RULE_IDS.indexOf(right.ruleId)
    || left.path.localeCompare(right.path, 'en')
    || left.detail.localeCompare(right.detail, 'en'))
}

function write(root: string, path: string, content: string): void {
  const absolutePath = join(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function packageManifest(name: string, dependencies: Readonly<Record<string, string>> = {}): JsonObject {
  return { name, private: true, version: '0.0.0', type: 'module', exports: { '.': './src/index.ts' }, dependencies }
}

function writeManifest(root: string, id: string, manifest: JsonObject): void {
  write(root, `packages/${id}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'fuma-shared-packages-'))
  temporaryDirectories.push(root)
  write(root, 'apps/control-surfaces/package.json', `${JSON.stringify({ name: '@fuma/control-surfaces', private: true, dependencies: { '@fuma/governance-launch': 'workspace:*' } })}\n`)
  write(root, 'apps/site-runtime/runtime.manifest.json', '{}\n')
  write(root, 'apps/studio/package.json', `${JSON.stringify({ name: '@fuma/studio', private: true })}\n`)
  write(root, 'apps/web/package.json', `${JSON.stringify({ name: '@fuma/web', private: true })}\n`)
  writeManifest(root, 'fuma-governance-launch', packageManifest('@fuma/governance-launch', { '@sinclair/typebox': '0.34.49' }))
  write(root, 'packages/fuma-governance-launch/src/index.ts', 'export const governance = true\n')
  writeManifest(root, 'brand', packageManifest('@fuma/brand'))
  write(root, 'packages/brand/src/index.ts', "export const brandName = 'Fuma'\n")
  writeManifest(root, 'design-tokens', packageManifest('@fuma/design-tokens'))
  write(root, 'packages/design-tokens/src/index.ts', 'export const spacing = { md: 16 } as const\n')
  writeManifest(root, 'public-contracts', packageManifest('@fuma/public-contracts', { '@sinclair/typebox': '0.34.49' }))
  write(root, 'packages/public-contracts/src/index.ts', [
    "import { Type, type Static } from '@sinclair/typebox'",
    "export const ProductSchema = Type.Object({ id: Type.String() }, { additionalProperties: false })",
    'export type Product = Static<typeof ProductSchema>',
    '',
  ].join('\n'))
  return root
}

function ruleSet(root: string): RuleId[] {
  return [...new Set(auditSharedPackages(root).map(({ ruleId }) => ruleId))]
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('FUMA-WEB-004 bounded shared package architecture', () => {
  test('the actual workspace contains the bounded leaves plus approved governance, control, and tenant-runtime applications', () => {
    expect(auditSharedPackages(REPOSITORY_ROOT)).toEqual([])
  })

  test('the independent valid fixture satisfies the package contract', () => {
    expect(auditSharedPackages(fixture())).toEqual([])
  })

  const independentMutations: ReadonlyArray<Readonly<{ ruleId: RuleId, mutate(root: string): void }>> = [
    { ruleId: 'package-topology', mutate: (root) => write(root, 'packages/utils/package.json', '{}\n') },
    { ruleId: 'app-topology', mutate: (root) => write(root, 'apps/admin/package.json', '{"name":"@fuma/admin"}\n') },
    { ruleId: 'package-name', mutate: (root) => writeManifest(root, 'brand', packageManifest('@fuma/branding')) },
    { ruleId: 'duplicate-package-name', mutate: (root) => write(root, 'apps/studio/package.json', '{"name":"@fuma/brand"}\n') },
    { ruleId: 'package-leaf', mutate: (root) => writeManifest(root, 'brand', packageManifest('@fuma/brand', { '@fuma/design-tokens': 'workspace:*' })) },
    { ruleId: 'export-surface', mutate: (root) => writeManifest(root, 'brand', { ...packageManifest('@fuma/brand'), exports: { '.': './src/missing.ts' } }) },
    { ruleId: 'nested-lockfile', mutate: (root) => write(root, 'packages/brand/bun.lock', 'forbidden\n') },
    { ruleId: 'public-contract-typebox-only', mutate: (root) => write(root, 'packages/public-contracts/src/parallel.ts', 'export interface ParallelContract { id: string }\n') },
    { ruleId: 'public-contract-authority', mutate: (root) => write(root, 'packages/public-contracts/src/runtime.ts', "import React from 'react'\nexport { React }\n") },
    { ruleId: 'private-commercial-field', mutate: (root) => write(root, 'packages/public-contracts/src/private.ts', "import { Type } from '@sinclair/typebox'\nexport const PrivateSchema = Type.Object({ providerCost: Type.Integer() }, { additionalProperties: false })\n") },
    { ruleId: 'framework-neutral', mutate: (root) => write(root, 'packages/design-tokens/src/react.ts', "import React from 'react'\nexport { React }\n") },
  ]

  test.each(independentMutations)('independently rejects $ruleId drift', ({ ruleId, mutate }) => {
    const root = fixture()
    mutate(root)
    expect(ruleSet(root)).toEqual([ruleId])
  })

  test('rejects a symlinked fourth shared package without following it', () => {
    const root = fixture()
    symlinkSync(join(root, 'packages/brand'), join(root, 'packages/linked-brand'), 'dir')
    expect(ruleSet(root)).toEqual(['package-topology'])
  })

  test('rejects dependency cycles in addition to the leaf violation', () => {
    const root = fixture()
    writeManifest(root, 'brand', packageManifest('@fuma/brand', { '@fuma/design-tokens': 'workspace:*' }))
    writeManifest(root, 'design-tokens', packageManifest('@fuma/design-tokens', { '@fuma/brand': 'workspace:*' }))
    expect(ruleSet(root)).toEqual(['package-leaf', 'package-cycle'])
  })

  test('covers every rule with an isolated hostile mutation', () => {
    const covered = [...independentMutations.map(({ ruleId }) => ruleId), 'package-cycle'].sort()
    expect(covered).toEqual([...RULE_IDS].sort())
  })

  test.each([
    "export { spacing } from '@fuma/design-tokens'",
    "export { spacing } from '../../design-tokens/src/index'",
  ])('rejects package-to-package source coupling: %s', (source) => {
    const root = fixture()
    write(root, 'packages/brand/src/coupled.ts', `${source}\n`)
    expect(ruleSet(root)).toEqual(['package-leaf'])
  })

  test.each(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'])('rejects nested %s', (lockfile) => {
    const root = fixture()
    write(root, `apps/studio/${lockfile}`, 'forbidden\n')
    expect(ruleSet(root)).toEqual(['nested-lockfile'])
  })

  test('rejects a symlinked nested lockfile without following it', () => {
    const root = fixture()
    symlinkSync(join(root, 'packages/brand/package.json'), join(root, 'packages/brand/yarn.lock'))
    expect(ruleSet(root)).toEqual(['nested-lockfile'])
  })

  test.each(['react', 'next/server', 'node:fs', 'bun:sqlite', 'postgres', 'drizzle-orm', 'better-auth'])('rejects public-contract authority import %s', (specifier) => {
    const root = fixture()
    write(root, 'packages/public-contracts/src/runtime.ts', `import authority from '${specifier}'\nexport { authority }\n`)
    expect(ruleSet(root)).toEqual(['public-contract-authority'])
  })

  test('rejects a public-contract import of the Studio package as both non-leaf and authority drift', () => {
    const root = fixture()
    write(root, 'packages/public-contracts/src/runtime.ts', "import studio from '@fuma/studio'\nexport { studio }\n")
    expect(ruleSet(root)).toEqual(['package-leaf', 'public-contract-authority'])
  })

  test('rejects a relative public-contract escape into Studio authority', () => {
    const root = fixture()
    write(root, 'packages/public-contracts/src/runtime.ts', "export { studio } from '../../../apps/studio/src/index'\n")
    expect(ruleSet(root)).toEqual(['package-leaf', 'public-contract-authority'])
  })

  test.each(['zod', 'valibot'])('rejects non-TypeBox schema dependency %s', (dependency) => {
    const root = fixture()
    writeManifest(root, 'public-contracts', packageManifest('@fuma/public-contracts', { '@sinclair/typebox': '0.34.49', [dependency]: '1.0.0' }))
    expect(ruleSet(root)).toEqual(['public-contract-typebox-only'])
  })

  test('rejects non-strict TypeBox object schemas', () => {
    const root = fixture()
    write(root, 'packages/public-contracts/src/index.ts', "import { Type } from '@sinclair/typebox'\nexport const ProductSchema = Type.Object({ id: Type.String() })\n")
    expect(ruleSet(root)).toEqual(['public-contract-typebox-only'])
  })

  test.each(['providerPlanId', 'providerPriceId', 'providerCost', 'grossMargin', 'internalEntitlement', 'grandfatheredContract', 'privateOffer', 'paymentState', 'transferState', 'cogs'])('rejects private commercial field %s', (field) => {
    const root = fixture()
    write(root, 'packages/public-contracts/src/private.ts', `import { Type } from '@sinclair/typebox'\nexport const PrivateSchema = Type.Object({ ${field}: Type.String() }, { additionalProperties: false })\n`)
    expect(ruleSet(root)).toEqual(['private-commercial-field'])
  })

  test.each(['react', 'next', 'vue', 'svelte', 'solid-js', '@emotion/css', 'styled-components', 'tailwindcss', '@tailwindcss/postcss', 'shadcn', 'class-variance-authority', 'clsx', 'tailwind-merge', 'tw-animate-css', 'lucide-react', 'radix-ui', '@radix-ui/react-dialog', '@base-ui-components/react', 'node:fs', 'bun:sqlite'])('rejects framework/runtime dependency %s in brand/tokens', (dependency) => {
    const root = fixture()
    writeManifest(root, 'design-tokens', packageManifest('@fuma/design-tokens', { [dependency]: '1.0.0' }))
    expect(ruleSet(root)).toEqual(['framework-neutral'])
  })

  test('rejects wildcard/deep export surfaces even when the target currently exists', () => {
    const root = fixture()
    writeManifest(root, 'brand', { ...packageManifest('@fuma/brand'), exports: { '.': './src/index.ts', './*': './src/*' } })
    expect(ruleSet(root)).toEqual(['export-surface'])
  })
})
