import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, extname, join, posix, relative } from 'path'
import * as ts from 'typescript'
import { HISTORICAL_MIGRATION_SOURCE_HASHES } from '../../../../../tooling/workspaceMigrationBaseline'

const ROOT = join(import.meta.dir, '../../..')
const CONTRACT_PATH = '../../docs/reference/fuma-platform-architecture.md'
const SOURCE_ROOTS = ['server', 'src', 'scripts', 'config', 'deploy', 'deployment', 'infra', 'k8s'] as const
const ROOT_CONFIG_FILES = [
  'package.json',
  'bun.lock',
  'Dockerfile',
  'compose.build.yml',
  'compose.prod.yml',
  'compose.tls.yml',
] as const

/**
 * FUMA-001 inherited singleton debt ledger. Counts are exact so this stays a
 * ratchet: the empty ledger proves legacy self-host site selection is explicit,
 * and new files never enter an allowlist.
 */
const INHERITED_SINGLETON_SQL: Readonly<Record<string, number>> = {}

const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const SHARED_PROFILE_PATH = /(?:^|\/)(?:router|routing|routes?|permissions?|persistence|repositories?|navigation|access)(?:\/|\.|-)/i
const SINGLETON_DEFAULT_ID = /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\bid\b\s*(?:={1,3}|\bis\b)\s*['"]default['"]|['"]default['"]\s*(?:={1,3})\s*(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\bid\b|(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\bid\b\s+in\s*\(\s*['"]default['"]\s*\)/gi
const TENANT_LIMIT_ONE = /\bfrom\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?[`"]?(?:organizations?|workspaces?|sites)[`"]?\b[\s\S]{0,320}?\blimit\s+1\b/gi
const SPECULATIVE_PROFILE_PATH = /(?:^|\/)(?:commerce|courses?|directory|directories|community|communities)(?:\/|\.|-)/i
const SPECULATIVE_PROFILE_TABLE = /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+(?:commerce|courses?|directory|directories|community|communities)(?:_|\b)/i
const DESTRUCTIVE_SQL = /\b(?:drop\s+(?:(?:materialized\s+)?view|table|column|constraint|index|schema|database|trigger|function|type|sequence)|truncate(?:\s+table)?|alter\s+table[\s\S]{0,200}?\b(?:drop\s+(?:column|constraint)|rename\s+(?:column|to))|delete\s+from\s+[A-Za-z_$`"])/i
const SQLITE_PARITY_REQUIREMENT = /\b(?:sqlite\s+(?:migration\s+)?parity|migration\s+parity[\s\S]{0,100}?sqlite|mirror(?:ed|s|ing)?[\s\S]{0,100}?sqlite|sqliteMigrations)\b/i

const FORBIDDEN_TOPOLOGY: ReadonlyArray<readonly [string, RegExp]> = [
  ['Kafka', /\b(?:kafkajs|kafka-node|apache\s+kafka|kafka)\b/i],
  ['Elasticsearch', /\b(?:@elastic\/elasticsearch|elasticsearch|elastic-search)\b/i],
  ['service mesh', /\b(?:service[-_ ]mesh|istio|linkerd|consul[-_ ]connect)\b/i],
  ['microservice framework', /(?:@nestjs\/microservices|\bmoleculer\b|\bseneca\b|\bmicroservice[-_ ]framework\b)/i],
]

const LAUNCH_PROFILE_IDS = new Set(['website', 'publication'])
const FUTURE_PROFILE_IDS = ['commerce', 'course', 'courses', 'directory', 'directories', 'community', 'communities'] as const
const FUTURE_PROFILE_ID_SET = new Set<string>(FUTURE_PROFILE_IDS)
const PROCESS_ROLES = ['web', 'worker', 'scheduler'] as const

type ProcessRole = typeof PROCESS_ROLES[number]
type Rule =
  | 'singleton-scope'
  | 'per-site-sqlite'
  | 'dedicated-resource-default'
  | 'forbidden-topology'
  | 'drizzle-boundary'
  | 'speculative-profile'
  | 'profile-name-fork'
  | 'process-import-boundary'
  | 'hosted-migration-additive'
  | 'hosted-migration-postgres-only'

type Finding = {
  path: string
  rule: Rule
  detail: string
}

type StaticModuleReference = {
  node: ts.Node
  specifier: string
}

type PlacementFact = 'dedicated' | 'premium'

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function sha256(source: string): string {
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}

function repoPath(path: string): string {
  return relative(ROOT, path).replaceAll('\\', '/')
}

function isProductionFile(path: string): boolean {
  const extension = extname(path)
  return ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.toml', '.sql'].includes(extension)
    && !path.includes('/__tests__/')
    && !/\.(?:test|spec)\.[^.]+$/.test(path)
}

function collectProductionFiles(): string[] {
  const files: string[] = []
  const walk = (absoluteDir: string): void => {
    if (!existsSync(absoluteDir)) return
    for (const entry of readdirSync(absoluteDir)) {
      if (['node_modules', 'dist', '.git', '.tmp', 'generated'].includes(entry)) continue
      const absolutePath = join(absoluteDir, entry)
      const stat = statSync(absolutePath)
      if (stat.isDirectory()) walk(absolutePath)
      else if (isProductionFile(absolutePath)) files.push(repoPath(absolutePath))
    }
  }

  for (const root of SOURCE_ROOTS) walk(join(ROOT, root))
  for (const path of ROOT_CONFIG_FILES) {
    if (existsSync(join(ROOT, path))) files.push(path)
  }
  return [...new Set(files)].sort()
}

function normalizedWords(source: string): string {
  return source.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase()
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case '.tsx': return ts.ScriptKind.TSX
    case '.js': return ts.ScriptKind.JS
    case '.mjs': return ts.ScriptKind.JS
    case '.cjs': return ts.ScriptKind.JS
    default: return ts.ScriptKind.TS
  }
}

function parseScript(path: string, source: string): ts.SourceFile | undefined {
  if (!SCRIPT_EXTENSIONS.has(extname(path))) return undefined
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path))
}

function visit(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node)
  ts.forEachChild(node, (child) => visit(child, visitor))
}

function staticString(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text
  return undefined
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function calleeName(expression: ts.Expression): string {
  const current = unwrapExpression(expression)
  if (ts.isIdentifier(current)) return current.text
  if (ts.isPropertyAccessExpression(current)) return `${calleeName(current.expression)}.${current.name.text}`
  if (ts.isElementAccessExpression(current)) {
    const key = staticString(current.argumentExpression)
    return key ? `${calleeName(current.expression)}.${key}` : calleeName(current.expression)
  }
  return current.getText()
}

function staticModuleReferences(sourceFile: ts.SourceFile): StaticModuleReference[] {
  const references: StaticModuleReference[] = []
  visit(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = staticString(node.moduleSpecifier)
      if (specifier) references.push({ node, specifier })
      return
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = staticString(node.moduleReference.expression)
      if (specifier) references.push({ node, specifier })
      return
    }
    if (!ts.isCallExpression(node) || node.arguments.length !== 1) return
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
    const referenceName = calleeName(node.expression)
    const isRequire = referenceName === 'require' || referenceName.endsWith('.require')
    if (!isDynamicImport && !isRequire) return
    const specifier = staticString(node.arguments[0])
    if (specifier) references.push({ node, specifier })
  })
  return references
}

function isFumaHostedPath(path: string): boolean {
  return /(?:^|\/)(?:fuma|hosted)(?:\/|[-_.])|(?:^|\/)fuma[-_.]/i.test(path)
}

function isHostedMigrationPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  if (normalized === 'server/db/migrations-pg.ts') return false
  return /(?:^|\/)server\/fuma\/(?:db\/)?(?:migrations?|schema)(?:\/|[-_.]|$)/.test(normalized)
    || /(?:^|\/)server\/db\/(?:migrations?|schema)[-_.](?:fuma|hosted)(?:\/|[-_.]|$)/.test(normalized)
    || /(?:^|\/)server\/db\/(?:fuma|hosted)[-_./](?:migrations?|schema)(?:\/|[-_.]|$)/.test(normalized)
}

function singletonSqlFindings(path: string, source: string): Finding[] {
  const findings: Finding[] = []
  for (const pattern of [SINGLETON_DEFAULT_ID, TENANT_LIMIT_ONE]) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      findings.push({ path, rule: 'singleton-scope', detail: match[0].replace(/\s+/g, ' ').trim() })
    }
  }
  return findings
}

function importedBindingNames(
  importerPath: string,
  sourceFile: ts.SourceFile,
  exportedName: string,
  modulePaths: ReadonlySet<string>,
): Set<string> {
  const names = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue
    const specifier = staticString(statement.moduleSpecifier)
    if (!specifier || !modulePaths.has(resolveModulePath(importerPath, specifier))) continue
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === exportedName) names.add(element.name.text)
    }
  }
  return names
}

function identifierAliases(sourceFile: ts.SourceFile, seeds: ReadonlySet<string>): Set<string> {
  const aliases = new Set(seeds)
  let changed = true
  while (changed) {
    changed = false
    visit(sourceFile, (node) => {
      let target: ts.Identifier | undefined
      let value: ts.Expression | undefined
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        target = node.name
        value = node.initializer
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
      ) {
        target = node.left
        value = node.right
      }
      const current = value && unwrapExpression(value)
      if (target && current && ts.isIdentifier(current) && aliases.has(current.text) && !aliases.has(target.text)) {
        aliases.add(target.text)
        changed = true
      }
    })
  }
  return aliases
}

function callUsesBinding(call: ts.CallExpression, bindings: ReadonlySet<string>): boolean {
  const expression = unwrapExpression(call.expression)
  return ts.isIdentifier(expression) && bindings.has(expression.text)
}

function sqliteAllocationCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const importedFactories = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'createSqliteClient') importedFactories.add(element.name.text)
    }
  }
  const aliases = identifierAliases(sourceFile, new Set(['createSqliteClient', ...importedFactories]))
  const calls: ts.CallExpression[] = []
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    const words = normalizedWords(calleeName(node.expression))
    const namedSqliteAllocation = callUsesBinding(node, aliases)
      || (/\b(?:create|open|allocate|provision|connect)\b/.test(words) && /\bsqlite\b/.test(words))
      || (/\bsqlite\b/.test(words) && /\b(?:client|database|connection|store|file)\b/.test(words))
    const text = normalizedWords(node.getText(sourceFile))
    const scopedDatabaseFile = /\b(?:create|open|allocate|provision|database|client|path|file)\b/.test(words)
      && /\b(?:site|customer)(?:\s+id)?\b/.test(text)
      && /['"`]\s*[^'"`]*\.db\b/i.test(node.getText(sourceFile))
    if (namedSqliteAllocation || scopedDatabaseFile) calls.push(node)
  })
  return calls
}

function perSiteSqliteFindings(path: string, source: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  if (!isFumaHostedPath(path) || !sourceFile) return []
  const sqliteModules = staticModuleReferences(sourceFile)
    .filter(({ specifier }) => /(?:^|[/.:_-])sqlite(?:[/.:_-]|$)/i.test(specifier))
  const allocationCalls = sqliteAllocationCalls(sourceFile)
  const selectsSqlite = /['"`]sqlite(?:3)?:/i.test(source)
  if (sqliteModules.length === 0 && allocationCalls.length === 0 && !selectsSqlite) return []
  return [{
    path,
    rule: 'per-site-sqlite',
    detail: 'Fuma hosted code references SQLite instead of the sole PostgreSQL runtime',
  }]
}

function markerFacts(expression: ts.Expression): Set<PlacementFact> {
  const current = unwrapExpression(expression)
  const facts = new Set<PlacementFact>()
  const literal = staticString(current)?.toLowerCase()
  if (literal === 'dedicated' || literal === 'isolated') facts.add('dedicated')
  if (literal && ['enterprise', 'paid', 'premium', 'opt-in', 'opted-in'].includes(literal)) facts.add('premium')

  if (literal !== undefined) return facts
  const words = normalizedWords(ts.isCallExpression(current) ? calleeName(current.expression) : current.getText())
  const isNegative = /\b(?:not|without|non|shared|pooled|free)\b/.test(words)
  if (!isNegative && /\b(?:dedicated|isolated)\b/.test(words)) facts.add('dedicated')
  if (!isNegative && /\b(?:enterprise|paid|premium)\b|\bopt\s+in\b|\bopted\s+in\b/.test(words)) facts.add('premium')
  return facts
}

function factsFromAtom(expression: ts.Expression): Set<PlacementFact> {
  const current = unwrapExpression(expression)
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) return new Set()
  if (ts.isBinaryExpression(current)) {
    if (![ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(current.operatorToken.kind)) return new Set()
    if (current.left.kind === ts.SyntaxKind.FalseKeyword || current.right.kind === ts.SyntaxKind.FalseKeyword) return new Set()
    return new Set([...markerFacts(current.left), ...markerFacts(current.right)])
  }
  return markerFacts(current)
}

function guardFacts(expression: ts.Expression): Set<PlacementFact> {
  const current = unwrapExpression(expression)
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return new Set([...guardFacts(current.left), ...guardFacts(current.right)])
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = guardFacts(current.left)
    const right = guardFacts(current.right)
    return new Set([...left].filter((fact) => right.has(fact)))
  }
  return factsFromAtom(current)
}

function nodeIsWithin(node: ts.Node, container: ts.Node): boolean {
  return container.pos <= node.pos && node.end <= container.end
}

function enclosingPlacementFacts(node: ts.Node): Set<PlacementFact> {
  const facts = new Set<PlacementFact>()
  let current: ts.Node = node
  for (let parent = node.parent; parent; current = parent, parent = parent.parent) {
    let expression: ts.Expression | undefined
    if (ts.isIfStatement(parent) && nodeIsWithin(current, parent.thenStatement)) expression = parent.expression
    else if (ts.isConditionalExpression(parent) && nodeIsWithin(current, parent.whenTrue)) expression = parent.condition
    else if (
      ts.isBinaryExpression(parent)
      && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && nodeIsWithin(current, parent.right)
    ) expression = parent.left
    if (expression) {
      for (const fact of guardFacts(expression)) facts.add(fact)
    }
  }
  return facts
}

function expressionHasDedicatedMarker(expression: ts.Expression): boolean {
  let found = false
  visit(expression, (node) => {
    if (ts.isExpression(node) && markerFacts(node).has('dedicated')) found = true
  })
  return found
}

function isDedicatedAllocationCall(call: ts.CallExpression): boolean {
  const words = normalizedWords(calleeName(call.expression))
  const dedicatedName = /\b(?:dedicated|isolated|per\s+(?:site|customer|organization|tenant))\b/.test(words)
  const resourceName = /\b(?:database|redis|cache|bucket|storage|process|edge|web|worker|scheduler|placement)\b/.test(words)
  if (!resourceName) return false

  const observationalVerb = /^(?:get|find|read|list|describe|resolve|check|is|has|can|supports?)\b/.test(words)
  if (dedicatedName && !observationalVerb) return true

  const allocationIntent = /\b(?:allocate|provision|create|assign|reserve|deploy|launch|instantiate|open|place|schedule|start|attach|bind)\b/.test(words)
  const dedicatedArgument = call.arguments.some((argument) => expressionHasDedicatedMarker(argument))
  return allocationIntent && dedicatedArgument
}

function dedicatedResourceFindings(path: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  if (!isFumaHostedPath(path) || !sourceFile) return []
  const findings: Finding[] = []
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isDedicatedAllocationCall(node)) return
    const facts = enclosingPlacementFacts(node)
    if (facts.has('dedicated') && facts.has('premium')) return
    findings.push({
      path,
      rule: 'dedicated-resource-default',
      detail: `${calleeName(node.expression)} is not nested under a dedicated plus enterprise/paid/opt-in placement guard`,
    })
  })
  return findings
}

function topologyFindings(path: string, source: string): Finding[] {
  const findings: Finding[] = []
  for (const [name, pattern] of FORBIDDEN_TOPOLOGY) {
    if (pattern.test(source)) findings.push({ path, rule: 'forbidden-topology', detail: name })
  }
  return findings
}

function isDrizzleSpecifier(specifier: string): boolean {
  return specifier === 'drizzle-orm'
    || specifier.startsWith('drizzle-orm/')
    || specifier === 'drizzle-kit'
    || specifier.startsWith('drizzle-kit/')
    || specifier === '@drizzle-team'
    || specifier.startsWith('@drizzle-team/')
}

function drizzleFindings(path: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  if (
    !sourceFile
    || path.startsWith('server/auth/')
    || path.startsWith('server/fuma/auth/compatibility/')
  ) return []
  return staticModuleReferences(sourceFile)
    .filter(({ specifier }) => isDrizzleSpecifier(specifier))
    .map(({ specifier }) => ({
      path,
      rule: 'drizzle-boundary' as const,
      detail: `Drizzle module ${specifier} belongs only under server/auth/ or server/fuma/auth/compatibility/`,
    }))
}

type StaticBindings = Map<string, ts.Expression[]>

function collectStaticBindings(sourceFile: ts.SourceFile): StaticBindings {
  const bindings: StaticBindings = new Map()
  const addBinding = (name: string, expression: ts.Expression): void => {
    const values = bindings.get(name) ?? []
    values.push(expression)
    bindings.set(name, values)
  }

  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      addBinding(node.name.text, node.initializer)
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      addBinding(node.left.text, node.right)
    }
  })
  return bindings
}

function resolvedStaticStrings(expression: ts.Expression, bindings: StaticBindings, seen = new Set<string>()): Set<string> {
  const current = unwrapExpression(expression)
  const literal = staticString(current)
  if (literal !== undefined) return new Set([literal])

  if (ts.isIdentifier(current)) {
    if (seen.has(current.text)) return new Set()
    const nextSeen = new Set(seen).add(current.text)
    const values = bindings.get(current.text) ?? []
    return new Set(values.flatMap((value) => [...resolvedStaticStrings(value, bindings, nextSeen)]))
  }

  if (ts.isArrayLiteralExpression(current)) {
    return new Set(current.elements.flatMap((element) => ts.isSpreadElement(element)
      ? [...resolvedStaticStrings(element.expression, bindings, seen)]
      : [...resolvedStaticStrings(element, bindings, seen)]))
  }

  if (ts.isNewExpression(current) || ts.isCallExpression(current)) {
    return new Set(current.arguments?.flatMap((argument) => [...resolvedStaticStrings(argument, bindings, seen)]) ?? [])
  }

  return new Set()
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property.name) === name)
}

function objectStringPropertyValues(object: ts.ObjectLiteralExpression, name: string, bindings: StaticBindings): Set<string> {
  const property = objectProperty(object, name)
  if (property && ts.isPropertyAssignment(property)) return resolvedStaticStrings(property.initializer, bindings)
  if (property && ts.isShorthandPropertyAssignment(property)) return resolvedStaticStrings(property.name, bindings)
  return new Set()
}

function hasProfileDeclarationContext(object: ts.ObjectLiteralExpression): boolean {
  const profileProperties = ['capabilities', 'capabilityPreset', 'contributions', 'features']
  if (profileProperties.some((name) => objectProperty(object, name))) return true
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent)) return /profile|preset/i.test(calleeName(parent.expression))
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return /profile|preset/i.test(parent.name.text)
    if (ts.isStatement(parent)) break
  }
  return false
}

function speculativeProfileFindings(path: string, source: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  const findings: Finding[] = []
  if (SPECULATIVE_PROFILE_PATH.test(path) || SPECULATIVE_PROFILE_TABLE.test(source)) {
    findings.push({ path, rule: 'speculative-profile', detail: 'future profile module or table exists before an approved capability requires it' })
  }
  if (!sourceFile) return findings
  const bindings = collectStaticBindings(sourceFile)
  visit(sourceFile, (node) => {
    if (!ts.isObjectLiteralExpression(node) || !hasProfileDeclarationContext(node)) return
    for (const id of objectStringPropertyValues(node, 'id', bindings)) {
      if (!FUTURE_PROFILE_ID_SET.has(id.toLowerCase())) continue
      findings.push({ path, rule: 'speculative-profile', detail: `future profile ${id} is registered or declared before its owning task` })
    }
  })
  return findings
}

function collectProfileAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set(['profileId'])
  const declarations: Array<readonly [string, ts.Expression]> = []
  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push([node.name.text, node.initializer])
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) declarations.push([node.left.text, node.right])
  })

  let changed = true
  while (changed) {
    changed = false
    for (const [name, initializer] of declarations) {
      if (!aliases.has(name) && isProfileReference(initializer, aliases)) {
        aliases.add(name)
        changed = true
      }
    }
  }
  return aliases
}

function isProfileReference(expression: ts.Expression, aliases: Set<string>): boolean {
  const current = unwrapExpression(expression)
  if (ts.isIdentifier(current)) return aliases.has(current.text)
  if (ts.isPropertyAccessExpression(current)) {
    const owner = normalizedWords(current.expression.getText())
    return current.name.text === 'id' && /\b(?:product\s+profile|profile)\b/.test(owner)
  }
  if (ts.isElementAccessExpression(current)) {
    const owner = normalizedWords(current.expression.getText())
    return staticString(current.argumentExpression) === 'id' && /\b(?:product\s+profile|profile)\b/.test(owner)
  }
  return false
}

function isLaunchProfileLiteral(expression: ts.Expression): boolean {
  const value = staticString(unwrapExpression(expression))
  return value !== undefined && LAUNCH_PROFILE_IDS.has(value.toLowerCase())
}

function expressionResolvesLaunchProfile(expression: ts.Expression, bindings: StaticBindings): boolean {
  return isLaunchProfileLiteral(expression)
    || [...resolvedStaticStrings(expression, bindings)].some((value) => LAUNCH_PROFILE_IDS.has(value.toLowerCase()))
}

function expressionContainsLaunchProfile(expression: ts.Expression, bindings: StaticBindings): boolean {
  return expressionResolvesLaunchProfile(expression, bindings)
}

function expressionHasProfileDecision(expression: ts.Expression, aliases: Set<string>, bindings: StaticBindings): boolean {
  let found = false
  visit(expression, (node) => {
    if (found) return
    if (ts.isBinaryExpression(node)) {
      const comparisons: ts.SyntaxKind[] = [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ]
      if (
        comparisons.includes(node.operatorToken.kind)
        && ((isProfileReference(node.left, aliases) && expressionResolvesLaunchProfile(node.right, bindings))
          || (expressionResolvesLaunchProfile(node.left, bindings) && isProfileReference(node.right, aliases)))
      ) found = true
      return
    }
    if (!ts.isCallExpression(node)) return
    const callee = unwrapExpression(node.expression)
    const membershipMethod = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isElementAccessExpression(callee)
        ? staticString(callee.argumentExpression)
        : undefined
    if (!membershipMethod || !['includes', 'has'].includes(membershipMethod)) return
    if (!node.arguments.some((argument) => isProfileReference(argument, aliases))) return
    const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      ? callee.expression
      : undefined
    if (receiver && expressionContainsLaunchProfile(receiver, bindings)) found = true
  })
  return found
}

function profileForkFindings(path: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  if (!SHARED_PROFILE_PATH.test(path) || !sourceFile) return []
  const aliases = collectProfileAliases(sourceFile)
  const bindings = collectStaticBindings(sourceFile)
  const findings: Finding[] = []
  const addFinding = (node: ts.Node): void => {
    findings.push({
      path,
      rule: 'profile-name-fork',
      detail: `shared code branches on a launch profile ID in ${node.getText(sourceFile).replace(/\s+/g, ' ')}`,
    })
  }

  visit(sourceFile, (node) => {
    if (ts.isIfStatement(node) && expressionHasProfileDecision(node.expression, aliases, bindings)) addFinding(node.expression)
    else if (ts.isConditionalExpression(node) && expressionHasProfileDecision(node.condition, aliases, bindings)) addFinding(node.condition)
    else if (ts.isSwitchStatement(node)) {
      const profileSwitch = isProfileReference(node.expression, aliases)
        && node.caseBlock.clauses.some((clause) => ts.isCaseClause(clause) && expressionResolvesLaunchProfile(clause.expression, bindings))
      const decisionCase = node.caseBlock.clauses.some((clause) => ts.isCaseClause(clause) && expressionHasProfileDecision(clause.expression, aliases, bindings))
      if (profileSwitch || decisionCase) addFinding(node)
    }
  })
  return findings
}

function compositionRole(path: string): ProcessRole | undefined {
  const normalized = path.replaceAll('\\', '/').replace(/\.(?:tsx?|mjs|cjs|js)$/, '')
  const match = normalized.match(/(?:^|\/)server\/fuma\/(?:runtime|process|processes|roles)\/(?:start[-_.]?)?(web|worker|scheduler)(?:[-_.]?(?:Root|Composition[-_.]?Root|Bootstrap))?(?:\/(?:bootstrap|index|main))?$/i)
  return PROCESS_ROLES.find((role) => role === match?.[1]?.toLowerCase())
}

function resolveModulePath(importerPath: string, specifier: string): string {
  if (specifier.startsWith('.')) return posix.normalize(posix.join(dirname(importerPath).replaceAll('\\', '/'), specifier))
  if (specifier.startsWith('@server/')) return `server/${specifier.slice('@server/'.length)}`
  if (specifier.startsWith('@fuma/')) return `server/fuma/${specifier.slice('@fuma/'.length)}`
  return specifier.replace(/^\//, '')
}

function processImportFindings(path: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  const ownRole = compositionRole(path)
  if (!ownRole || !sourceFile) return []
  const findings: Finding[] = []
  for (const { specifier } of staticModuleReferences(sourceFile)) {
    const siblingRole = compositionRole(resolveModulePath(path, specifier))
    if (!siblingRole || siblingRole === ownRole) continue
    findings.push({
      path,
      rule: 'process-import-boundary',
      detail: `${ownRole} composition root imports sibling ${siblingRole} composition root via ${specifier}`,
    })
  }
  return findings
}

function hostedMigrationFindings(path: string, source: string, sourceFile: ts.SourceFile | undefined): Finding[] {
  if (!isHostedMigrationPath(path)) return []
  const findings: Finding[] = []
  if (DESTRUCTIVE_SQL.test(source)) {
    findings.push({ path, rule: 'hosted-migration-additive', detail: 'destructive SQL in Fuma hosted migration' })
  }
  let hasSqliteReference = false
  if (sourceFile) {
    visit(sourceFile, (node) => {
      if (ts.isIdentifier(node) && /\bsqlite\b/.test(normalizedWords(node.text))) hasSqliteReference = true
      const value = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
      if (value && /\bsqlite\b/.test(normalizedWords(value))) hasSqliteReference = true
    })
  }
  if (/(?:^|[/_.-])sqlite(?:[/_.-]|$)/i.test(path) || SQLITE_PARITY_REQUIREMENT.test(source) || hasSqliteReference) {
    findings.push({ path, rule: 'hosted-migration-postgres-only', detail: 'Fuma hosted migration defines a SQLite mirror or parity source' })
  }
  return findings
}

function analyze(path: string, source: string): Finding[] {
  const sourceFile = parseScript(path, source)
  return [
    ...singletonSqlFindings(path, source),
    ...perSiteSqliteFindings(path, source, sourceFile),
    ...dedicatedResourceFindings(path, sourceFile),
    ...topologyFindings(path, source),
    ...drizzleFindings(path, sourceFile),
    ...speculativeProfileFindings(path, source, sourceFile),
    ...profileForkFindings(path, sourceFile),
    ...processImportFindings(path, sourceFile),
    ...hostedMigrationFindings(path, source, sourceFile),
  ]
}

function withoutInheritedSingletonDebt(findings: Finding[]): Finding[] {
  const singletonByPath = new Map<string, number>()
  for (const finding of findings) {
    if (finding.rule === 'singleton-scope') {
      singletonByPath.set(finding.path, (singletonByPath.get(finding.path) ?? 0) + 1)
    }
  }

  for (const [path, expectedCount] of Object.entries(INHERITED_SINGLETON_SQL)) {
    expect(singletonByPath.get(path), `${path} inherited singleton debt changed; ratchet the documented count down when removing debt`).toBe(expectedCount)
  }

  return findings.filter((finding) => finding.rule !== 'singleton-scope' || !(finding.path in INHERITED_SINGLETON_SQL))
}

function expectRejected(path: string, source: string, rule: Rule): void {
  expect(analyze(path, source).some((finding) => finding.rule === rule), `${path} fixture must be rejected by ${rule}`).toBe(true)
}

function expectAccepted(path: string, source: string, rule: Rule): void {
  expect(analyze(path, source).filter((finding) => finding.rule === rule), `${path} fixture must be accepted by ${rule}`).toEqual([])
}

function hierarchyIsOrdered(contract: string): boolean {
  const hierarchy = ['user', 'organization', 'workspace', 'site']
  const positions = hierarchy.map((scope) => contract.indexOf(scope))
  return positions.every((position) => position >= 0) && positions.every((position, index) => index === 0 || positions[index - 1]! < position)
}

describe('Fuma platform architecture policy', () => {
  it('tracks the hierarchy and current policy without claiming runtime completion', () => {
    const contract = read(CONTRACT_PATH)
    expect(contract).toContain('user → organization → workspace → site')
    expect(hierarchyIsOrdered(contract)).toBe(true)
    expect(hierarchyIsOrdered('user → workspace → organization → site')).toBe(false)
    expect(contract).toContain('policy foundation')
    expect(contract).toContain('does not implement')
    expect(contract).toContain('capability-composed')
    expect(contract).toContain('PostgreSQL-only')
    expect(contract).toContain('pooled')
    expect(contract).toContain('FUMA-006')
    expect(contract).toContain('Public marketing')
    expect(contract).toMatch(/Commerce[\s\S]*Courses[\s\S]*Directory[\s\S]*Community/)
  })

  it('rejects singleton scope fixtures while documenting the exact inherited debt', () => {
    expectRejected('server/fuma/repositories/sites.ts', "await db`select * from sites where id = 'default'`", 'singleton-scope')
    expectRejected('server/fuma/repositories/sites.ts', "await db`select * from sites where s.id === 'default'`", 'singleton-scope')
    expectRejected('server/fuma/repositories/sites.ts', "await db`select * from sites where 'default' = site.id`", 'singleton-scope')
    expectRejected('server/fuma/repositories/sites.ts', "await db`select * from sites where site.id in ('default')`", 'singleton-scope')
    expectRejected('server/fuma/repositories/sites.ts', 'await db`select * from organizations order by created_at limit 1`', 'singleton-scope')
    expectRejected('server/fuma/repositories/sites.ts', 'await db`select * from public."workspaces" order by created_at limit 1`', 'singleton-scope')
    expect(Object.keys(INHERITED_SINGLETON_SQL)).toEqual([])
  })

  it('rejects every hosted SQLite module, URL, and allocation path', () => {
    expectRejected(
      'scripts/fuma-transition.ts',
      "import { Database } from 'bun:sqlite'",
      'per-site-sqlite',
    )
    expectRejected(
      'server/fuma/persistence/siteStore.ts',
      "import { createSqliteClient } from '../../db/sqlite'; createSqliteClient(siteDatabasePath)",
      'per-site-sqlite',
    )
    expectRejected(
      'server/fuma/config.ts',
      "export const DATABASE_URL = 'sqlite:./fuma.db'",
      'per-site-sqlite',
    )
    expectRejected(
      'server/fuma/persistence/siteStore.ts',
      "openDatabase(join(siteId, 'site.db'))",
      'per-site-sqlite',
    )
  })

  it('rejects unconditional dedicated allocation and permits only a structural premium placement guard', () => {
    expectRejected(
      'server/fuma/placement.ts',
      '// Enterprise placement is configured elsewhere.\nprovisionDedicatedDatabase(customerId)',
      'dedicated-resource-default',
    )
    expectRejected('server/fuma/placement.ts', 'provisionIsolatedDatabase(customerId)', 'dedicated-resource-default')
    expectRejected('server/fuma/placement.ts', 'reserveIsolatedDatabase(customerId)', 'dedicated-resource-default')
    expectRejected('server/fuma/placement.ts', 'deployDedicatedWorker(customerId)', 'dedicated-resource-default')
    expectRejected(
      'server/fuma/placement.ts',
      "if (account.plan === 'enterprise') provisionDedicatedDatabase(customerId)",
      'dedicated-resource-default',
    )
    expectRejected(
      'server/fuma/placement.ts',
      "if (notDedicated && account.plan === 'enterprise') provisionDedicatedDatabase(customerId)",
      'dedicated-resource-default',
    )
    expectRejected(
      'server/fuma/placement.ts',
      "if (placement === 'dedicated' || account.plan === 'enterprise') provisionDedicatedDatabase(customerId)",
      'dedicated-resource-default',
    )
    expectRejected(
      'server/fuma/placement.ts',
      "if (placement !== 'dedicated' && account.plan === 'enterprise') provisionDedicatedDatabase(customerId)",
      'dedicated-resource-default',
    )
    expectAccepted(
      'server/fuma/placement.ts',
      "if (placement === 'dedicated' && account.plan === 'enterprise') { provisionDedicatedDatabase(customerId) }",
      'dedicated-resource-default',
    )
    expectAccepted(
      'server/fuma/placement.ts',
      "if (placement === 'dedicated') { if (account.hasPaidOptIn) provisionIsolatedDatabase(customerId) }",
      'dedicated-resource-default',
    )
    expectAccepted('server/fuma/placement.ts', "assignSharedPlacement(organizationId, 'pooled')", 'dedicated-resource-default')
    expectAccepted('server/fuma/placement.ts', 'getDedicatedDatabase(customerId)', 'dedicated-resource-default')
  })

  it.each([
    ['Kafka', "import { Kafka } from 'kafkajs'"],
    ['Elasticsearch', "import { Client } from '@elastic/elasticsearch'"],
    ['service mesh', 'apiVersion: networking.istio.io/v1'],
    ['microservice framework', "import { ClientProxy } from '@nestjs/microservices'"],
  ])('rejects %s infrastructure', (_name, source) => {
    expectRejected('server/fuma/config.ts', source, 'forbidden-topology')
  })

  it('contains every static Drizzle module form at the Better Auth boundary', () => {
    const fixtures = [
      "import { drizzle } from 'drizzle-orm/postgres-js'",
      "import 'drizzle-orm/postgres-js'",
      "const module = await import('drizzle-orm/postgres-js')",
      "const module = require('drizzle-orm/postgres-js')",
      "const driver = module.require('drizzle-orm/postgres-js')",
      "import drizzle = require('drizzle-orm/postgres-js')",
      "export { drizzle } from 'drizzle-orm/postgres-js'",
    ]
    for (const fixture of fixtures) {
      expectRejected('server/fuma/repositories/site.ts', fixture, 'drizzle-boundary')
      expectAccepted('server/auth/database.ts', fixture, 'drizzle-boundary')
      expectAccepted('server/fuma/auth/compatibility/database.ts', fixture, 'drizzle-boundary')
    }
  })

  it.each(FUTURE_PROFILE_IDS)('rejects speculative %s profile paths, tables, registrations, and declarations', (profileId) => {
    expectRejected(`src/core/profiles/${profileId}/index.ts`, 'export const placeholder = true', 'speculative-profile')
    expectRejected('server/fuma/db/migrations/002_future.ts', `create table ${profileId}_items (id text primary key);`, 'speculative-profile')
    expectRejected('src/core/profiles/registry.ts', `registerProfile({ id: '${profileId}', capabilities: [] })`, 'speculative-profile')
    expectRejected('src/core/profiles/registry.ts', `const id = '${profileId}'; registerProfile({ id, capabilities: [] })`, 'speculative-profile')
    expectRejected('src/core/profiles/registry.ts', `const profileId = '${profileId}'; registerProfile({ id: profileId, capabilities: [] })`, 'speculative-profile')
    expectRejected('src/core/profiles/registry.ts', `const productProfile = { id: '${profileId}', capabilities: [] }`, 'speculative-profile')
  })

  it('accepts Website and Publication profile preset registration', () => {
    expectAccepted(
      'src/core/profiles/registry.ts',
      "registerProfile({ id: 'website', capabilities: ['design'] }); registerProfile({ id: 'publication', capabilities: ['editorial'] })",
      'speculative-profile',
    )
    expectAccepted(
      'src/core/routing/profileRegistry.ts',
      "registerProfile({ id: 'website', capabilities: ['design'] })",
      'profile-name-fork',
    )
  })

  it('rejects profile decisions in if, switch, and conditional branches, including straightforward aliases', () => {
    const fixtures = [
      ["if (profileId === 'website') return websiteRoutes", 'server/fuma/routing/resolve.ts'],
      ["if (profileId !== 'publication') return websiteRoutes", 'server/fuma/routing/resolve.ts'],
      ["if (['website'].includes(profileId)) return websiteRoutes", 'server/fuma/navigation/resolve.ts'],
      ["const launchProfiles = ['website']; if (launchProfiles.includes(profileId)) return websiteRoutes", 'server/fuma/navigation/resolve.ts'],
      ["const launchProfiles = new Set(['publication']); if (launchProfiles.has(profileId)) return editorialRoutes", 'server/fuma/navigation/resolve.ts'],
      ["const launchProfile = 'website'; if (profileId === launchProfile) return websiteRoutes", 'server/fuma/routing/resolve.ts'],
      ["const launchProfiles = ['website']; if (launchProfiles['includes'](profileId)) return websiteRoutes", 'server/fuma/navigation/resolve.ts'],
      ["const p = profileId; if (p === 'website') return websiteRoutes", 'src/core/permissions/resolve.ts'],
      ["switch (profileId) { case 'publication': return editorialPermissions }", 'src/core/permissions/resolve.ts'],
      ["return profileId === 'website' ? websiteRoutes : sharedRoutes", 'server/fuma/persistence/resolve.ts'],
    ] as const
    for (const [source, path] of fixtures) expectRejected(path, source, 'profile-name-fork')
    expectAccepted(
      'server/fuma/routing/profileRegistry.ts',
      "registerProfile({ id: 'website', capabilities: ['pages'] })",
      'profile-name-fork',
    )
  })

  it.each([
    ['server/fuma/runtime/web.ts', "import { startWorker } from './worker'"],
    ['server/fuma/runtime/web/bootstrap.ts', "import { startScheduler } from '../scheduler/bootstrap'"],
    ['server/fuma/runtime/startWeb.ts', "import { startWorker } from './startWorker'"],
    ['server/fuma/runtime/webBootstrap.ts', "import { startWorker } from './workerBootstrap'"],
    ['server/fuma/runtime/web-bootstrap.ts', "import { startWorker } from './worker-bootstrap'"],
    ['server/fuma/runtime/worker.ts', "import { startScheduler } from './scheduler'"],
    ['server/fuma/runtime/worker/bootstrap.ts', "import { startWeb } from '../web/bootstrap'"],
    ['server/fuma/runtime/startWorker.ts', "import { startScheduler } from './startScheduler'"],
    ['server/fuma/runtime/workerBootstrap.ts', "import { startScheduler } from './schedulerBootstrap'"],
    ['server/fuma/runtime/scheduler.ts', "import { startWeb } from './web'"],
    ['server/fuma/runtime/scheduler/bootstrap.ts', "import { startWorker } from '../worker/bootstrap'"],
    ['server/fuma/runtime/startScheduler.ts', "import { startWeb } from './startWeb'"],
    ['server/fuma/runtime/schedulerBootstrap.ts', "import { startWeb } from './webBootstrap'"],
  ])('rejects sibling composition-root import from %s', (path, source) => {
    expectRejected(path, source, 'process-import-boundary')
  })

  it('allows process roots to import shared and domain modules', () => {
    expectAccepted('server/fuma/runtime/web.ts', "import { config } from './shared/config'", 'process-import-boundary')
    expectAccepted('server/fuma/runtime/worker/bootstrap.ts', "import { runJob } from '../../domain/jobs'", 'process-import-boundary')
    expectAccepted('server/fuma/runtime/startScheduler.ts', "import { clock } from '@fuma/domain/clock'", 'process-import-boundary')
  })

  it('recognizes every canonical and plausible hosted migration location', () => {
    expectRejected('server/fuma/db/migrations/002_bad.ts', 'alter table sites drop column owner_id;', 'hosted-migration-additive')
    expectRejected('server/fuma/migrations/002_bad.ts', 'drop table sites;', 'hosted-migration-additive')
    expectRejected('server/db/migrations-hosted/002_bad.ts', 'truncate table sites;', 'hosted-migration-additive')
    expectRejected('server/db/migrations-fuma.ts', 'drop table sites;', 'hosted-migration-additive')
    expectRejected('server/fuma/db/migrations/003_rename.ts', 'alter table sites rename column owner_id to user_id;', 'hosted-migration-additive')
    expectRejected('server/fuma/db/migrations/004_delete.ts', 'delete from sites where archived = true;', 'hosted-migration-additive')
    expectRejected('server/fuma/db/migrations/005_view.ts', 'drop materialized view site_counts;', 'hosted-migration-additive')
    expectRejected('server/fuma/db/migrations-sqlite.ts', 'alter table sites add column workspace_id text;', 'hosted-migration-postgres-only')
    expectRejected('server/fuma/db/migrations/002_bad.ts', 'export const sqliteMigrations = mirrorSqlite()', 'hosted-migration-postgres-only')
    expectRejected(
      'server/fuma/db/migrations/006_alias.ts',
      "const transitionDialect = 'sqlite'; export const migrations = mirrorDialect(transitionDialect)",
      'hosted-migration-postgres-only',
    )
    expectRejected(
      'server/fuma/db/migrations/007_destructive_alias.ts',
      "const destructiveStep = 'drop table sites'; export const migration = { sql: destructiveStep }",
      'hosted-migration-additive',
    )
    const additiveSource = 'alter table sites add column workspace_id text;'
    expect(hostedMigrationFindings(
      'server/fuma/db/migrations/002_sites.ts',
      additiveSource,
      parseScript('server/fuma/db/migrations/002_sites.ts', additiveSource),
    )).toEqual([])
  })

  it('preserves immutable historical migration sources', () => {
    const workspaceRoot = join(ROOT, '../..')
    for (const [path, expectedHash] of Object.entries(HISTORICAL_MIGRATION_SOURCE_HASHES)) {
      const absolutePath = join(workspaceRoot, path)
      expect(existsSync(absolutePath), `${path} is immutable historical migration source and must not be deleted`).toBe(true)
      expect(sha256(readFileSync(absolutePath, 'utf8')), `${path} is immutable; FUMA-006 establishes the separate hosted stream`).toBe(expectedHash)
    }
  })

  it('rejects the final auditor exact bypass corpus and corrected nearby matrix', () => {
    const exactBypasses: ReadonlyArray<readonly [string, string, Rule]> = [
      ['server/fuma/routing/resolve.ts', "if (profileId !== 'publication') return websiteRoutes", 'profile-name-fork'],
      ['server/fuma/permissions/resolve.ts', "if (['website'].includes(profileId)) return websitePermissions", 'profile-name-fork'],
      ['server/fuma/persistence/resolve.ts', "const p = profileId; if (p === 'website') return websiteStore", 'profile-name-fork'],
      ['server/fuma/repositories/site.ts', "import 'drizzle-orm/postgres-js'", 'drizzle-boundary'],
      ['server/fuma/runtime/web/bootstrap.ts', "import { startWorker } from '../worker/bootstrap'", 'process-import-boundary'],
      ['server/fuma/runtime/startWeb.ts', "import { startWorker } from './startWorker'", 'process-import-boundary'],
      ['server/fuma/db/migrations/001_bad.ts', 'drop table sites;', 'hosted-migration-additive'],
      ['server/db/migrations-hosted/001_bad.ts', 'drop table sites;', 'hosted-migration-additive'],
      ['server/db/migrations-fuma.ts', 'alter table sites drop column workspace_id;', 'hosted-migration-additive'],
      ['server/fuma/db/migrations-sqlite.ts', 'export const migrations = []', 'hosted-migration-postgres-only'],
      ['src/core/profiles/registry.ts', "registerProfile({ id: 'commerce', capabilities: [] })", 'speculative-profile'],
      ['server/fuma/placement.ts', '// Enterprise\nprovisionDedicatedDatabase(customerId)', 'dedicated-resource-default'],
      ['server/fuma/placement.ts', 'provisionIsolatedDatabase(customerId)', 'dedicated-resource-default'],
    ]
    const nearbyBypasses: ReadonlyArray<readonly [string, string, Rule]> = [
      ['server/fuma/routing/resolve.ts', "if ('publication' !== profileId) return websiteRoutes", 'profile-name-fork'],
      ['server/fuma/navigation/resolve.ts', "if (new Set(['website']).has(profileId)) return websiteRoutes", 'profile-name-fork'],
      ['server/fuma/permissions/resolve.ts', "let p; p = profileId; if (p === 'website') return websitePermissions", 'profile-name-fork'],
      ['server/fuma/persistence/resolve.ts', "const p = productProfile['id']; if (p === 'publication') return publicationStore", 'profile-name-fork'],
      ['server/fuma/repositories/site.ts', "export * from 'drizzle-orm/postgres-js'", 'drizzle-boundary'],
      ['server/fuma/runtime/web.ts', "export { startWorker as launchWorker } from './worker'", 'process-import-boundary'],
      ['server/fuma/processes/startScheduler.ts', "require('./startWeb')", 'process-import-boundary'],
      ['server/fuma/routing/resolve.ts', "const launchProfiles = ['website']; if (launchProfiles.includes(profileId)) return websiteRoutes", 'profile-name-fork'],
      ['server/fuma/repositories/site.ts', "module.require('drizzle-orm/postgres-js')", 'drizzle-boundary'],
      ['server/fuma/runtime/webBootstrap.ts', "import { startWorker } from './workerBootstrap'", 'process-import-boundary'],
      ['server/fuma/migrations/002_bad.ts', 'drop table sites;', 'hosted-migration-additive'],
      ['src/core/profiles/registry.ts', "const id = 'commerce'; registerProfile({ id, capabilities: [] })", 'speculative-profile'],
      ['server/fuma/placement.ts', 'reserveIsolatedDatabase(customerId)', 'dedicated-resource-default'],
      ['server/fuma/placement.ts', 'deployDedicatedWorker(customerId)', 'dedicated-resource-default'],
    ]

    expect(exactBypasses).toHaveLength(13)
    expect(nearbyBypasses).toHaveLength(14)
    for (const [path, source, rule] of [...exactBypasses, ...nearbyBypasses]) expectRejected(path, source, rule)
  })

  it('accepts a capability-composed, scoped, pooled PostgreSQL example', () => {
    const valid = `
      export const profiles = defineProfiles([
        { id: 'website', capabilityPreset: ['design', 'pages'] },
        { id: 'publication', capabilityPreset: ['design', 'editorial', 'members'] },
      ])
      export function resolveProduct(context: {
        userId: string
        organizationId: string
        workspaceId: string
        siteId: string
      }) {
        return composeCapabilities(context, { placement: 'pooled', database: 'postgresql' })
      }
    `
    expect(analyze('server/fuma/product/compose.ts', valid)).toEqual([])
  })

  it('scans a nonzero real production/config tree and finds no unratcheted violations', () => {
    const files = collectProductionFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((path) => path.startsWith('server/'))).toBe(true)
    expect(files.some((path) => path.startsWith('src/'))).toBe(true)
    expect(files).toContain('package.json')

    const findings = withoutInheritedSingletonDebt(files.flatMap((path) => analyze(path, read(path))))
    expect(findings).toEqual([])
  }, 15_000)
})
