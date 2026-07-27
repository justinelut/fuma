import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join, relative } from 'path'
import * as ts from 'typescript'
import { Value } from '@core/utils/typeboxHelpers'
import {
  FumaRepositoryScopeSchema,
  TENANT_RESOURCE_INVENTORY,
} from '../../../server/fuma/tenancy'

const ROOT = join(import.meta.dir, '../../..')
const REPOSITORY_SCOPE_PATH = 'server/fuma/tenancy/repositoryScope.ts'
const TENANCY_BARREL_PATH = 'server/fuma/tenancy/index.ts'
const WORKSPACE_REPOSITORY_PATH = 'server/fuma/workspaces/repository.ts'
const SITE_REPOSITORY_PATH = 'server/fuma/sites/repository.ts'
const SCOPED_SITE_REPOSITORY_PATH = 'server/fuma/sites/scopedRepository.ts'

type Finding = Readonly<{
  path: string
  line: number
  detail: string
}>

type MethodLike = ts.MethodDeclaration | ts.MethodSignature

type CoverageRegistry = Readonly<{
  path: string
  name: string
  classIds: readonly string[]
}>

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function productionTypeScript(root: string): string[] {
  const paths: string[] = []
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory)) {
      if (['__tests__', 'generated', 'node_modules'].includes(entry)) continue
      const absolute = join(directory, entry)
      const stat = statSync(absolute)
      if (stat.isDirectory()) walk(absolute)
      else if (['.ts', '.tsx'].includes(extname(absolute))
        && !/\.(?:test|spec)\.[^.]+$/.test(absolute)) {
        paths.push(relative(ROOT, absolute).replaceAll('\\', '/'))
      }
    }
  }
  walk(join(ROOT, root))
  return paths.sort()
}

function sourceFile(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function visit(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node)
  ts.forEachChild(node, (child) => visit(child, visitor))
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
}

function nodeName(node: ts.NamedDeclaration): string | undefined {
  const name = node.name
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function parameterText(method: MethodLike, file: ts.SourceFile): string {
  return method.parameters.map((parameter) => parameter.name.getText(file)).join(' ').toLowerCase()
}

function methods(file: ts.SourceFile): MethodLike[] {
  const found: MethodLike[] = []
  visit(file, (node) => {
    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) found.push(node)
  })
  return found
}

function methodOwnerName(method: MethodLike): string | undefined {
  const owner = method.parent
  if (!ts.isClassDeclaration(owner) && !ts.isInterfaceDeclaration(owner)) return undefined
  return owner.name?.text
}

function transactionCallbackCoordinateFindings(path: string, source: string): Finding[] {
  const contractName = path === WORKSPACE_REPOSITORY_PATH
    ? 'WorkspaceRepositoryTransaction'
    : path === SITE_REPOSITORY_PATH
      ? 'SiteRepositoryTransaction'
      : undefined
  if (!contractName) return []
  const implementationName = path === WORKSPACE_REPOSITORY_PATH
    ? 'PostgresWorkspaceTransaction'
    : 'PostgresSiteTransaction'
  const forbiddenCoordinates = path === WORKSPACE_REPOSITORY_PATH
    ? ['organization']
    : ['organization', 'workspace']
  const file = sourceFile(path, source)
  return methods(file).flatMap((method) => {
    const owner = methodOwnerName(method)
    if (owner !== contractName && owner !== implementationName) return []
    const parameters = method.parameters
      .map((parameter) => parameter.getText(file))
      .join(' ')
      .toLowerCase()
    const accepted = forbiddenCoordinates.filter((coordinate) => parameters.includes(coordinate))
    if (accepted.length === 0) return []
    return [{
      path,
      line: lineOf(file, method),
      detail: `${owner}.${nodeName(method) ?? '<anonymous>'} accepts ${accepted.join(', ')} replacement coordinate(s)`,
    }]
  })
}

function expectedCoordinates(path: string): readonly string[] | undefined {
  if (path === WORKSPACE_REPOSITORY_PATH) return ['organization', 'workspace']
  if (path === SITE_REPOSITORY_PATH) return ['organization', 'workspace', 'site']
  return undefined
}

function bareGetByIdFindings(path: string, source: string): Finding[] {
  const expected = expectedCoordinates(path)
  if (!expected) return []
  const file = sourceFile(path, source)
  return methods(file).flatMap((method) => {
    if (nodeName(method) !== 'getById' || methodOwnerName(method)?.endsWith('Transaction')) return []
    const parameters = parameterText(method, file)
    const missing = expected.filter((coordinate) => !parameters.includes(coordinate))
    return missing.length === 0 ? [] : [{
      path,
      line: lineOf(file, method),
      detail: `getById omits ${missing.join(', ')} coordinate(s)`,
    }]
  })
}

function sqlFragments(node: ts.Node, file: ts.SourceFile): ReadonlyArray<Readonly<{
  node: ts.Node
  text: string
}>> {
  const fragments: Array<{ node: ts.Node; text: string }> = []
  visit(node, (candidate) => {
    if (ts.isTaggedTemplateExpression(candidate)) {
      fragments.push({ node: candidate, text: candidate.template.getText(file) })
      return
    }
    if (!ts.isCallExpression(candidate) || candidate.arguments.length === 0) return
    const callee = candidate.expression.getText(file)
    if (!/(?:^|\.)unsafe$/.test(callee)) return
    const first = candidate.arguments[0]
    if (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first)) {
      fragments.push({ node: candidate, text: first.getText(file) })
    }
  })
  return fragments
}

function whereClause(sql: string): string {
  const match = /\bwhere\b([\s\S]*)/i.exec(sql)
  return match?.[1] ?? ''
}

function hasEqualityPredicate(sql: string, column: string): boolean {
  return new RegExp(`\\b${column}\\b\\s*=`, 'i').test(whereClause(sql))
}

function workspaceOperationFindings(path: string, source: string): Finding[] {
  if (path !== WORKSPACE_REPOSITORY_PATH && path !== SITE_REPOSITORY_PATH) return []
  const file = sourceFile(path, source)
  const findings: Finding[] = []
  for (const method of methods(file)) {
    const name = nodeName(method)
    if (!name) continue
    const parameters = parameterText(method, file)
    const required = path === SITE_REPOSITORY_PATH
      ? ['organization', 'workspace']
      : ['organization']
    const isTransactionCallbackMethod = methodOwnerName(method)?.endsWith('Transaction') ?? false
    if (!isTransactionCallbackMethod && (name === 'transaction' || /(?:list|search|count)/i.test(name))) {
      const missing = required.filter((coordinate) => !parameters.includes(coordinate))
      if (missing.length > 0) {
        findings.push({
          path,
          line: lineOf(file, method),
          detail: `${name} omits ${missing.join(', ')} transaction/query scope coordinate(s)`,
        })
      }
    }
    if (!ts.isMethodDeclaration(method) || !method.body || !/(?:list|search|count)/i.test(name)) continue
    for (const fragment of sqlFragments(method.body, file)) {
      const targetsSites = /\bfrom\s+fuma_sites\b/i.test(fragment.text)
      const targetsWorkspaces = /\bfrom\s+fuma_workspaces\b/i.test(fragment.text)
      if (!targetsSites && !targetsWorkspaces) continue
      const sqlRequired = targetsSites ? ['organization_id', 'workspace_id'] : ['organization_id']
      const missing = sqlRequired.filter((column) => !hasEqualityPredicate(fragment.text, column))
      if (missing.length > 0) {
        findings.push({
          path,
          line: lineOf(file, fragment.node),
          detail: `${name} SQL omits ${missing.join(', ')} predicate(s)`,
        })
      }
    }
  }
  return findings
}

function scopedListByWorkspaceFindings(path: string, source: string): Finding[] {
  const file = sourceFile(path, source)
  const findings: Finding[] = []
  for (const method of methods(file)) {
    const name = nodeName(method)
    if (!ts.isMethodDeclaration(method)
      || !method.body
      || (name !== 'findBySlug' && name !== 'countActiveOwnedSites')) continue
    visit(method.body, (node) => {
      if (!ts.isCallExpression(node)
        || !ts.isPropertyAccessExpression(node.expression)
        || node.expression.name.text !== 'listByWorkspace') return
      findings.push({
        path,
        line: lineOf(file, node),
        detail: `${name} calls workspace-wide listByWorkspace`,
      })
    })
  }
  return findings
}

function classMethod(
  file: ts.SourceFile,
  className: string,
  methodName: string,
): ts.MethodDeclaration | undefined {
  let found: ts.MethodDeclaration | undefined
  visit(file, (node) => {
    if (found
      || !ts.isMethodDeclaration(node)
      || nodeName(node) !== methodName
      || !ts.isClassDeclaration(node.parent)
      || node.parent.name?.text !== className) return
    found = node
  })
  return found
}

function callName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text
  return undefined
}

function callsWithin(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  visit(node, (candidate) => {
    if (ts.isCallExpression(candidate)) calls.push(candidate)
  })
  return calls
}

function isTransactionCallbackCall(call: ts.CallExpression, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = call.parent
  while (current && current !== boundary) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent
      return ts.isCallExpression(parent)
        && callName(parent) === 'transaction'
        && parent.arguments.some((argument) => argument === current)
    }
    current = current.parent
  }
  return false
}

function scopedOwnerRevalidationFindings(path: string, source: string): Finding[] {
  const file = sourceFile(path, source)
  const findings: Finding[] = []
  for (const operation of ['get', 'findBySlug', 'countActiveOwnedSites', 'update', 'archive']) {
    const method = classMethod(file, 'BoundSite', operation)
    const transactionCall = method?.body && callsWithin(method.body).find((call) => (
      callName(call) === 'transaction'
      && ts.isPropertyAccessExpression(call.expression)
      && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ))
    if (!method || !transactionCall) {
      findings.push({
        path,
        line: method ? lineOf(file, method) : 1,
        detail: `BoundSite.${operation} does not enter the scoped transaction`,
      })
    }
  }

  const transaction = classMethod(file, 'BoundSite', 'transaction')
  if (!transaction?.body) {
    findings.push({ path, line: 1, detail: 'BoundSite.transaction is missing' })
    return findings
  }
  const assertion = callsWithin(transaction.body).find((call) => (
    callName(call) === 'assertActiveOwnerScope'
    && isTransactionCallbackCall(call, transaction)
  ))
  if (!assertion) {
    findings.push({
      path,
      line: lineOf(file, transaction),
      detail: 'BoundSite.transaction omits transaction-internal assertActiveOwnerScope',
    })
    return findings
  }
  const authority = assertion.arguments[0]
  const authorityKeys = authority && ts.isObjectLiteralExpression(authority)
    ? authority.properties.map((property) => nodeName(property)).filter((name) => name !== undefined)
    : []
  const missing = ['ownerKey', 'generation'].filter((key) => !authorityKeys.includes(key))
  if (missing.length > 0) {
    findings.push({
      path,
      line: lineOf(file, assertion),
      detail: `assertActiveOwnerScope omits ${missing.join(', ')} authority field(s)`,
    })
  }
  return findings
}

function activeOwnerGuardFindings(path: string, source: string): Finding[] {
  const file = sourceFile(path, source)
  const findings: Finding[] = []
  const contractMethod = methods(file).find((method) => (
    methodOwnerName(method) === 'SiteRepositoryTransaction'
    && nodeName(method) === 'assertActiveOwnerScope'
  ))
  if (!contractMethod) {
    findings.push({ path, line: 1, detail: 'SiteRepositoryTransaction omits assertActiveOwnerScope' })
  }

  const implementation = classMethod(file, 'PostgresSiteTransaction', 'assertActiveOwnerScope')
  if (!implementation?.body) {
    findings.push({ path, line: 1, detail: 'PostgresSiteTransaction omits assertActiveOwnerScope' })
    return findings
  }
  const guardSql = sqlFragments(implementation.body, file)
    .find(({ text }) => /\bfrom\s+fuma_tenant_owner_keys\b/i.test(text))
  if (!guardSql) {
    findings.push({
      path,
      line: lineOf(file, implementation),
      detail: 'assertActiveOwnerScope does not query tenant owner-key authority',
    })
    return findings
  }
  const missing = [
    !hasEqualityPredicate(guardSql.text, 'owner_key') && 'owner_key',
    !hasEqualityPredicate(guardSql.text, 'generation') && 'generation',
    !/\bstate\b\s*=\s*['"]active['"]/i.test(whereClause(guardSql.text)) && 'active state',
    !/\bfor\s+share\b/i.test(guardSql.text) && 'FOR SHARE',
  ].filter((value): value is string => Boolean(value))
  if (missing.length > 0) {
    findings.push({
      path,
      line: lineOf(file, guardSql.node),
      detail: `assertActiveOwnerScope SQL omits ${missing.join(', ')}`,
    })
  }
  return findings
}

function exportedCoverageRegistries(path: string, source: string): CoverageRegistry[] {
  const file = sourceFile(path, source)
  const registries: CoverageRegistry[] = []
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const normalized = declaration.name.text.replace(/[^a-z0-9]/gi, '').toLowerCase()
      if (!(normalized.includes('repository')
        && normalized.includes('scope')
        && normalized.includes('coverage'))) continue
      const classIds: string[] = []
      visit(declaration.initializer, (node) => {
        if (ts.isStringLiteralLike(node)) classIds.push(node.text)
      })
      registries.push({ path, name: declaration.name.text, classIds })
    }
  }
  return registries
}

function coverageFindings(
  registry: CoverageRegistry,
  requiredClassIds: readonly string[],
): string[] {
  const findings: string[] = []
  for (const classId of requiredClassIds) {
    const count = registry.classIds.filter((candidate) => candidate === classId).length
    if (count !== 1) findings.push(`${classId}: expected once, found ${count}`)
  }
  return findings
}

function singletonSqlFindings(path: string, source: string): Finding[] {
  const file = sourceFile(path, source)
  const findings: Finding[] = []
  for (const fragment of sqlFragments(file, file)) {
    const sql = fragment.text
    const tenantTable = /\b(?:from|join|into|update)\s+(?:[a-z_][\w]*\.)?[`"]?(fuma_organizations|fuma_workspaces|fuma_sites|organizations|workspaces|sites|site)[`"]?\b/i.exec(sql)?.[1]?.toLowerCase()
    if (!tenantTable) continue
    const hasDefaultSite = /['"]default['"]/i.test(sql)
    const requiredLimitPredicates: Readonly<Record<string, readonly string[]>> = {
      fuma_organizations: ['platform_id', 'id'],
      fuma_workspaces: ['organization_id', 'id'],
      fuma_sites: ['organization_id', 'workspace_id', 'id'],
      organizations: ['id'],
      workspaces: ['organization_id', 'id'],
      sites: ['organization_id', 'workspace_id', 'id'],
      site: ['id'],
    }
    const usesFirstTenant = /\blimit\s+1\b/i.test(sql)
      && (requiredLimitPredicates[tenantTable] ?? []).some((column) => (
        !hasEqualityPredicate(sql, column)
      ))
    if (hasDefaultSite || usesFirstTenant) {
      findings.push({
        path,
        line: lineOf(file, fragment.node),
        detail: hasDefaultSite
          ? `default-site SQL targets ${tenantTable}`
          : `singleton LIMIT 1 SQL targets ${tenantTable}`,
      })
    }
  }
  return findings
}

function formatFindings(findings: readonly Finding[]): string {
  return findings.map(({ path, line, detail }) => `${path}:${line} ${detail}`).join('\n')
}

const requiredSiteOwnedClassIds = TENANT_RESOURCE_INVENTORY
  .filter((entry) => entry.ownerLevel === 'site'
    && (entry.storageKind === 'table-row' || entry.storageKind === 'object'))
  .map(({ id }) => id)
  .toSorted()

describe('FUMA-025 repository scoping architecture', () => {
  it('exports one strict TypeBox-derived repository scope with exact coordinates', () => {
    const source = read(REPOSITORY_SCOPE_PATH)
    const barrel = read(TENANCY_BARREL_PATH)
    expect(barrel).toContain("export * from './repositoryScope'")
    expect(source).toMatch(/export\s+const\s+FumaRepositoryScopeSchema\s*=\s*Type\.Union/)
    expect(source).toMatch(/export\s+type\s+FumaRepositoryScope\s*=\s*DeepReadonly<\s*Static<typeof\s+FumaRepositoryScopeSchema>\s*>/)
    expect(source.match(/additionalProperties:\s*false/g)).toHaveLength(2)

    const exact = {
      platformId: 'platform-architecture',
      organizationId: 'organization-architecture',
      workspaceId: 'workspace-architecture',
      siteId: 'site-architecture',
      ownerKey: 'owner-architecture',
      state: 'active',
      generation: 1,
      transferFence: null,
    }
    expect(Value.Check(FumaRepositoryScopeSchema, exact)).toBe(true)
    expect(Value.Check(FumaRepositoryScopeSchema, { ...exact, routeSiteId: exact.siteId })).toBe(false)
    for (const coordinate of ['platformId', 'organizationId', 'workspaceId', 'siteId', 'ownerKey'] as const) {
      const hostile = { ...exact } as Record<string, unknown>
      delete hostile[coordinate]
      expect(Value.Check(FumaRepositoryScopeSchema, hostile), `scope accepted without ${coordinate}`).toBe(false)
    }
  })

  it('rejects bare workspace/site getById APIs, including hostile declarations', () => {
    const production = [WORKSPACE_REPOSITORY_PATH, SITE_REPOSITORY_PATH]
      .flatMap((path) => bareGetByIdFindings(path, read(path)))
    expect(production, formatFindings(production)).toEqual([])

    const hostileWorkspace = bareGetByIdFindings(WORKSPACE_REPOSITORY_PATH, `
      interface Repository { getById(workspaceId: string): Promise<unknown> }
    `)
    const hostileSite = bareGetByIdFindings(SITE_REPOSITORY_PATH, `
      class Repository { getById(siteId: string) { return siteId } }
    `)
    expect(hostileWorkspace).toHaveLength(1)
    expect(hostileSite).toHaveLength(1)
  })

  it('requires scoped workspace transactions and list/search/count SQL predicates', () => {
    const hostile = workspaceOperationFindings(SITE_REPOSITORY_PATH, `
      interface SiteRepository {
        transaction<T>(work: () => Promise<T>): Promise<T>
        listByWorkspace(workspaceId: string): Promise<unknown[]>
      }
      class PostgresSiteRepository {
        async search(workspaceId: string) {
          return db\`select * from fuma_sites where workspace_id = \${workspaceId}\`
        }
        async count(organizationId: string, workspaceId: string) {
          return db\`select count(*) from fuma_sites where status = 'active'\`
        }
      }
    `)
    expect(hostile.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      expect.stringContaining('transaction omits organization, workspace'),
      expect.stringContaining('listByWorkspace omits organization'),
      expect.stringContaining('search omits organization'),
      expect.stringContaining('search SQL omits organization_id'),
      expect.stringContaining('count SQL omits organization_id, workspace_id'),
    ]))

    const production = [WORKSPACE_REPOSITORY_PATH, SITE_REPOSITORY_PATH]
      .flatMap((path) => workspaceOperationFindings(path, read(path)))
    expect(production, formatFindings(production)).toEqual([])
  })

  it('prevents transaction callback methods from accepting replacement scope coordinates', () => {
    const hostileWorkspace = transactionCallbackCoordinateFindings(WORKSPACE_REPOSITORY_PATH, `
      interface WorkspaceRepositoryTransaction {
        update(organizationId: string, record: unknown): Promise<unknown>
      }
      class PostgresWorkspaceTransaction {
        list(organizationId: string) { return organizationId }
      }
    `)
    expect(hostileWorkspace.map(({ detail }) => detail)).toEqual([
      'WorkspaceRepositoryTransaction.update accepts organization replacement coordinate(s)',
      'PostgresWorkspaceTransaction.list accepts organization replacement coordinate(s)',
    ])

    const hostileSite = transactionCallbackCoordinateFindings(SITE_REPOSITORY_PATH, `
      interface SiteRepositoryTransaction {
        getSite(organizationId: string, workspaceId: string, siteId: string): unknown
      }
      class PostgresSiteTransaction {
        update(workspaceId: string, record: unknown) { return record }
      }
    `)
    expect(hostileSite.map(({ detail }) => detail)).toEqual([
      'SiteRepositoryTransaction.getSite accepts organization, workspace replacement coordinate(s)',
      'PostgresSiteTransaction.update accepts workspace replacement coordinate(s)',
    ])

    const production = [WORKSPACE_REPOSITORY_PATH, SITE_REPOSITORY_PATH]
      .flatMap((path) => transactionCallbackCoordinateFindings(path, read(path)))
    expect(production, formatFindings(production)).toEqual([])
  })

  it('keeps scoped site slug and count operations site-bound instead of workspace-wide', () => {
    const hostile = scopedListByWorkspaceFindings(SCOPED_SITE_REPOSITORY_PATH, `
      class BoundSiteTransaction {
        async findBySlug(slug: string) {
          return (await this.repository.listByWorkspace()).find((site) => site.slug === slug)
        }
        async countActiveOwnedSites() {
          return (await this.repository.listByWorkspace()).length
        }
      }
    `)
    expect(hostile.map(({ detail }) => detail)).toEqual([
      'findBySlug calls workspace-wide listByWorkspace',
      'countActiveOwnedSites calls workspace-wide listByWorkspace',
    ])

    const production = scopedListByWorkspaceFindings(
      SCOPED_SITE_REPOSITORY_PATH,
      read(SCOPED_SITE_REPOSITORY_PATH),
    )
    expect(production, formatFindings(production)).toEqual([])
  })

  it('revalidates active owner authority inside every scoped site transaction', () => {
    const hostileScoped = scopedOwnerRevalidationFindings(SCOPED_SITE_REPOSITORY_PATH, `
      class BoundSite {
        get() { return this.repository.getById() }
        findBySlug(slug: string) { return this.transaction(async (repository) => repository.findBySlug(slug)) }
        countActiveOwnedSites() { return this.transaction(async (repository) => repository.countActiveOwnedSites()) }
        update(input: unknown) { return this.transaction(async (repository) => repository.update(input)) }
        archive() { return this.transaction(async (repository) => repository.archive()) }
        transaction(work: (repository: unknown) => unknown) {
          this.repository.assertActiveOwnerScope({ ownerKey: this.scope.ownerKey })
          return this.repository.transaction(async (transaction) => work(transaction))
        }
      }
    `)
    expect(hostileScoped.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      'BoundSite.get does not enter the scoped transaction',
      'BoundSite.transaction omits transaction-internal assertActiveOwnerScope',
    ]))

    const hostileGuard = activeOwnerGuardFindings(SITE_REPOSITORY_PATH, `
      interface SiteRepositoryTransaction {
        assertActiveOwnerScope(authority: unknown): Promise<void>
      }
      class PostgresSiteTransaction {
        async assertActiveOwnerScope(authority: { ownerKey: string }) {
          await db\`select 1 from fuma_tenant_owner_keys where owner_key = \${authority.ownerKey}\`
        }
      }
    `)
    expect(hostileGuard.map(({ detail }) => detail)).toEqual([
      'assertActiveOwnerScope SQL omits generation, active state, FOR SHARE',
    ])

    const production = [
      ...scopedOwnerRevalidationFindings(
        SCOPED_SITE_REPOSITORY_PATH,
        read(SCOPED_SITE_REPOSITORY_PATH),
      ),
      ...activeOwnerGuardFindings(SITE_REPOSITORY_PATH, read(SITE_REPOSITORY_PATH)),
    ]
    expect(production, formatFindings(production)).toEqual([])
  })

  it('accounts explicitly for every required FUMA-024 site-owned class in one canonical coverage registry', () => {
    const hostileRegistry = exportedCoverageRegistries('fixture.ts', `
      export const FUMA_REPOSITORY_SCOPE_COVERAGE = ['${requiredSiteOwnedClassIds[0]}']
    `)[0]
    if (!hostileRegistry) throw new Error('Hostile coverage registry fixture was not detected.')
    expect(coverageFindings(hostileRegistry, requiredSiteOwnedClassIds).length).toBeGreaterThan(0)

    const registries = productionTypeScript('server/fuma')
      .flatMap((path) => exportedCoverageRegistries(path, read(path)))
    expect(
      registries,
      'No canonical exported repository-scope coverage registry exists; FUMA-024 site-owned classes cannot be audited for FUMA-025 repository adoption.',
    ).toHaveLength(1)
    const registry = registries[0]
    if (!registry) return
    expect(
      coverageFindings(registry, requiredSiteOwnedClassIds),
      `Repository scope coverage is incomplete in ${registry.path}:${registry.name}`,
    ).toEqual([])
  })

  it('contains zero singleton/default-site SQL and detects hostile SQL fixtures', () => {
    const hostile = singletonSqlFindings('fixture.ts', `
      const defaultSite = db\`select * from site where id = 'default' limit 1\`
      const firstWorkspace = db.unsafe('select * from fuma_workspaces order by created_at limit 1')
      const firstActiveSite = db\`select * from fuma_sites where status = 'active' order by created_at limit 1\`
    `)
    expect(hostile.map(({ detail }) => detail)).toEqual([
      'default-site SQL targets site',
      'singleton LIMIT 1 SQL targets fuma_workspaces',
      'singleton LIMIT 1 SQL targets fuma_sites',
    ])
    expect(singletonSqlFindings('fixture.ts', `
      const scoped = db\`select * from fuma_sites
        where organization_id = \${organizationId}
          and workspace_id = \${workspaceId}
          and id = \${siteId}\`
    `)).toEqual([])

    const production = productionTypeScript('server')
      .filter((path) => !path.includes('/migrations/'))
      .filter((path) => path !== 'server/db/migrations-pg.ts' && path !== 'server/db/migrations-sqlite.ts')
      .flatMap((path) => singletonSqlFindings(path, read(path)))
    expect(production, formatFindings(production)).toEqual([])
  })
})
