import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { extname, join } from 'path'
import * as ts from 'typescript'

const ROOT = join(import.meta.dir, '../../..')
const MODULE_PATHS = Object.freeze({
  server: ['server/fuma/editor'],
  session: ['src/admin/fuma/editorSession'],
  profile: ['src/admin/fuma/profileEditor'],
  integration: [
    'src/admin/fuma/FumaScopedShell.tsx',
    'src/admin/preauth/HostedStaffShell.tsx',
    'server/router.ts',
  ],
})

type ModuleName = keyof typeof MODULE_PATHS
type SourceUnit = Readonly<{ path: string; source: string }>
type ModuleSources = Readonly<Record<ModuleName, readonly SourceUnit[]>>
type Finding = Readonly<{ module: ModuleName; detail: string }>

const AUTHORITY_PARAMETER_NAMES = [
  'platformId',
  'organizationId',
  'workspaceId',
  'siteId',
  'ownerKey',
  'generation',
  'profileId',
  'editorSessionId',
] as const
const TARGET_KEY_DIMENSIONS = [
  'organizationId',
  'workspaceId',
  'siteId',
] as const
const STORAGE_KEY_DIMENSIONS = [
  'platformId',
  'ownerKey',
  'generation',
  'resourceKind',
  'logicalId',
] as const
const BODY_AUTHORITY_FIELDS = [
  'platformId',
  'organizationId',
  'workspaceId',
  'siteId',
  'ownerKey',
  'generation',
  'profileId',
  'editorSessionId',
  'capabilities',
  'permissions',
  'scope',
] as const
const EXPECTED_ROUTES = Object.freeze([
  'GET /editor/document content.pages.read',
  'PUT /editor/document content.pages.write',
])

function sourceFiles(root: string): string[] {
  if (['.ts', '.tsx'].includes(extname(root)) && existsSync(join(ROOT, root))) {
    return [root]
  }
  const direct = [`${root}.ts`, `${root}.tsx`]
    .filter((path) => existsSync(join(ROOT, path)))
  if (direct.length > 0) return direct
  const absoluteRoot = join(ROOT, root)
  if (!existsSync(absoluteRoot)) return []
  const found: string[] = []
  const visit = (absoluteDirectory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name)
      if (entry.isDirectory()) visit(join(absoluteDirectory, entry.name), relativePath)
      else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) found.push(relativePath)
    }
  }
  visit(absoluteRoot, root)
  return found.sort()
}

function productionSources(): ModuleSources {
  return Object.fromEntries(Object.entries(MODULE_PATHS).map(([name, roots]) => [
    name,
    roots.flatMap((root) => sourceFiles(root))
      .map((path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') })),
  ])) as ModuleSources
}

function parse(unit: SourceUnit): ts.SourceFile {
  return ts.createSourceFile(
    unit.path,
    unit.source,
    ts.ScriptTarget.Latest,
    true,
    extname(unit.path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if ('name' in node && node.name) return node.name.getText()
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text
  }
  return '<anonymous>'
}

function propertyName(node: ts.PropertyName | ts.BindingName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : ts.isPrivateIdentifier(node)
      ? node.text.startsWith('#') ? node.text : `#${node.text}`
      : null
}

function stringLiteralValue(expression: ts.Expression): string | null {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)
    ? current.text
    : null
}

function joined(units: readonly SourceUnit[]): string {
  return units.map(({ source }) => source).join('\n')
}

function unitEnding(units: readonly SourceUnit[], ending: string): SourceUnit | undefined {
  return units.find(({ path }) => path.endsWith(ending))
}

function looseAuthorityParameters(unit: SourceUnit): string[] {
  const sourceFile = parse(unit)
  const offenders: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      const loose = node.parameters.flatMap((parameter) => {
        if (!ts.isIdentifier(parameter.name)) return []
        return AUTHORITY_PARAMETER_NAMES.includes(
          parameter.name.text as (typeof AUTHORITY_PARAMETER_NAMES)[number],
        ) ? [parameter.name.text] : []
      })
      if (loose.length > 0) offenders.push(`${functionName(node)}(${loose.join(', ')})`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return offenders
}

function namedProfileBranches(unit: SourceUnit): string[] {
  const sourceFile = parse(unit)
  const offenders: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node)) {
      const text = node.getText(sourceFile)
      if (/['"](?:website|publication)['"]/i.test(text)) offenders.push(text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return offenders
}

function topLevelSharedEditorState(unit: SourceUnit): string[] {
  const sourceFile = parse(unit)
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return []
    return statement.declarationList.declarations.flatMap((declaration) => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return []
      const name = declaration.name.text
      if (!/(?:history|past|future|undo|redo|import)(?:State|Stack|Queue)?$/i.test(name)) return []
      const initializer = declaration.initializer
      return ts.isArrayLiteralExpression(initializer)
        || ts.isObjectLiteralExpression(initializer)
        || ts.isNewExpression(initializer)
        ? [name]
        : []
    })
  })
}

function namedFunctionTexts(
  units: readonly SourceUnit[],
  expectedName: string,
): ReadonlyArray<Readonly<{ path: string; text: string }>> {
  const found: Array<Readonly<{ path: string; text: string }>> = []
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && functionName(node) === expectedName) {
        found.push({ path: unit.path, text: node.getText(sourceFile) })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return found
}

function functionEntries(
  units: readonly SourceUnit[],
): ReadonlyArray<Readonly<{ name: string; path: string; text: string }>> {
  const found: Array<Readonly<{ name: string; path: string; text: string }>> = []
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && node.body) {
        found.push({
          name: functionName(node),
          path: unit.path,
          text: node.getText(sourceFile),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return found
}

function classMethodTexts(
  units: readonly SourceUnit[],
  className: string,
): ReadonlyMap<string, string> {
  const methods = new Map<string, string>()
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name?.text === className) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue
          const name = propertyName(member.name)
          if (name) methods.set(name, member.getText(sourceFile))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return methods
}

function variableInitializerText(unit: SourceUnit, variableName: string): string | null {
  const sourceFile = parse(unit)
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === variableName
        && declaration.initializer
      ) {
        return declaration.initializer.getText(sourceFile)
      }
    }
  }
  return null
}

function routeDeclarations(units: readonly SourceUnit[]): string[] {
  const found: string[] = []
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const values = new Map<string, string>()
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const name = propertyName(property.name)
          const value = stringLiteralValue(property.initializer)
          if (name && value !== null) values.set(name, value)
        }
        if (values.has('method') && values.has('path') && values.has('permission')) {
          found.push(`${values.get('method')} ${values.get('path')} ${values.get('permission')}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return found.sort()
}

function bodyAuthorityAccesses(units: readonly SourceUnit[]): string[] {
  const offenders: string[] = []
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'body'
        && BODY_AUTHORITY_FIELDS.includes(
          node.name.text as (typeof BODY_AUTHORITY_FIELDS)[number],
        )
      ) {
        offenders.push(`${unit.path}: ${node.getText(sourceFile)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return offenders
}

function requestBodyPropertyNames(units: readonly SourceUnit[]): string[] {
  const names: string[] = []
  for (const unit of units) {
    const sourceFile = parse(unit)
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node)
        && propertyName(node.name) === 'body'
        && ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const property of node.initializer.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const name = propertyName(property.name)
            if (name) names.push(name)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return names
}

function audit(sources: ModuleSources): Finding[] {
  const findings: Finding[] = []
  for (const module of Object.keys(MODULE_PATHS) as ModuleName[]) {
    if (sources[module].length === 0) {
      findings.push({ module, detail: `missing expected ${module} production sources` })
    }
    for (const unit of sources[module]) {
      if (/(?:siteId|scope|authority)\s*(?:=|\?\?|\|\|)\s*['"]default['"]|\b(?:DEFAULT_SITE|singleSite|single_site|getDefaultSite)\b/i.test(unit.source)) {
        findings.push({ module, detail: `${unit.path} derives editor authority from a default/single-site fallback` })
      }
      if (module !== 'integration') {
        for (const signature of looseAuthorityParameters(unit)) {
          findings.push({ module, detail: `${unit.path} accepts loose scalar authority in ${signature}` })
        }
      }
      for (const branch of namedProfileBranches(unit)) {
        findings.push({ module, detail: `${unit.path} branches on a profile name: ${branch.slice(0, 100)}` })
      }
    }
  }

  const serverSource = joined(sources.server)
  if (!serverSource.includes('EditorScopedRepository')) {
    findings.push({ module: 'server', detail: 'missing exported EditorScopedRepository binder' })
  }
  if (!serverSource.includes('FumaRepositoryScope')) {
    findings.push({ module: 'server', detail: 'editor persistence does not consume repository scope authority' })
  }

  const storageKeys = namedFunctionTexts(sources.server, 'key')
  if (storageKeys.length === 0) {
    findings.push({ module: 'server', detail: 'no auditable editor storage key function exists' })
  }
  for (const storageKey of storageKeys) {
    const missing = STORAGE_KEY_DIMENSIONS.filter((dimension) => !storageKey.text.includes(dimension))
    if (missing.length > 0) {
      findings.push({
        module: 'server',
        detail: `${storageKey.path} editor storage key is incomplete; missing ${missing.join(', ')}`,
      })
    }
  }

  const repositoryMethods = classMethodTexts(sources.server, 'BoundEditorRepository')
  for (const operation of ['load', 'save', 'replaceFromImport']) {
    const method = repositoryMethods.get(operation)
    if (!method || !/this\.#operation\s*\(/.test(method)) {
      findings.push({
        module: 'server',
        detail: `BoundEditorRepository.${operation} bypasses per-operation scope revalidation`,
      })
    }
  }
  const operationGuard = repositoryMethods.get('#operation')
  if (!operationGuard) {
    findings.push({ module: 'server', detail: 'missing shared per-operation scope revalidation guard' })
  } else {
    const transaction = operationGuard.indexOf('#storage.transaction')
    const reload = operationGuard.indexOf('loadScopeAuthorityForUpdate')
    const compare = operationGuard.indexOf('exactActiveScope')
    const work = operationGuard.lastIndexOf('work(transaction)')
    if (transaction < 0 || reload < transaction || compare < reload || work < compare) {
      findings.push({
        module: 'server',
        detail: 'scope authority is not reloaded and exactly matched before each editor operation',
      })
    }
  }

  const actualRoutes = routeDeclarations(sources.server)
  if (JSON.stringify(actualRoutes) !== JSON.stringify(EXPECTED_ROUTES)) {
    findings.push({
      module: 'server',
      detail: `scoped editor declarations must be exactly ${EXPECTED_ROUTES.join(' and ')}; found ${actualRoutes.join(', ') || 'none'}`,
    })
  }

  const saveSchema = sources.server
    .map((unit) => variableInitializerText(unit, 'EditorIncrementalSaveSchema'))
    .find((candidate): candidate is string => candidate !== null) ?? null
  if (!saveSchema || !/additionalProperties:\s*false/.test(saveSchema)) {
    findings.push({ module: 'server', detail: 'editor PUT body is not a closed validated contract' })
  } else {
    const authorityFields = BODY_AUTHORITY_FIELDS.filter((field) => (
      new RegExp(`\\b${field}\\s*:`).test(saveSchema)
    ))
    if (authorityFields.length > 0) {
      findings.push({
        module: 'server',
        detail: `editor PUT body accepts caller authority: ${authorityFields.join(', ')}`,
      })
    }
  }
  for (const access of bodyAuthorityAccesses(sources.server)) {
    findings.push({ module: 'server', detail: `editor route reads caller body authority at ${access}` })
  }
  const routesSource = unitEnding(sources.server, '/routes.ts')?.source ?? serverSource
  if (
    !/readValidatedBody\([\s\S]{0,160}(?:EditorIncrementalSaveSchema|EditorDraftMutationSchema)/.test(routesSource)
    || !/const\s*\{\s*context\s*,\s*repositoryScope\s*\}\s*=\s*handlerInput/.test(routesSource)
    || !/\.\.\.repositoryScope/.test(routesSource)
    || !/profileId:\s*context\.profile\.id/.test(routesSource)
  ) {
    findings.push({
      module: 'server',
      detail: 'editor routes do not bind persistence solely from trusted scoped handler authority',
    })
  }

  const targetKeys = [
    ...namedFunctionTexts(sources.session, 'targetKey'),
    ...namedFunctionTexts(sources.profile, 'targetKey'),
  ]
  if (targetKeys.length === 0) {
    findings.push({ module: 'session', detail: 'no auditable browser editor target key exists' })
  }
  for (const targetKey of targetKeys) {
    const missing = TARGET_KEY_DIMENSIONS.filter((dimension) => !targetKey.text.includes(dimension))
    if (missing.length > 0) {
      findings.push({
        module: 'session',
        detail: `${targetKey.path} editor target key is incomplete; missing ${missing.join(', ')}`,
      })
    }
  }

  const sessionSource = joined(sources.session)
  if (!sessionSource.includes('createEditorSessionCoordinator')) {
    findings.push({ module: 'session', detail: 'missing createEditorSessionCoordinator public factory' })
  }
  if (!/#sessions\s*=\s*new Map/.test(sessionSource) || !/#active\s*:/.test(sessionSource)) {
    findings.push({ module: 'session', detail: 'target state is not owned by each tab coordinator instance' })
  }
  const coordinatorMethods = classMethodTexts(sources.session, 'EditorSessionCoordinator')
  for (const [operation, token] of [
    ['#load', 'loadToken'],
    ['save', 'saveToken'],
    ['importDocument', 'importToken'],
  ] as const) {
    const method = coordinatorMethods.get(operation)
    if (
      !method
      || !new RegExp(`\\+\\+session\\.${token}`).test(method)
      || !new RegExp(`session\\.${token}\\s*!==\\s*token`).test(method)
    ) {
      findings.push({ module: 'session', detail: `${token} results are not rejected when stale` })
    }
  }
  const deactivate = coordinatorMethods.get('#deactivate')
  if (
    !deactivate
    || !/loadToken\s*\+=\s*1/.test(deactivate)
    || !/saveToken\s*\+=\s*1/.test(deactivate)
    || !/importToken\s*\+=\s*1/.test(deactivate)
  ) {
    findings.push({ module: 'session', detail: 'target switches do not invalidate every operation epoch' })
  }
  const createSession = coordinatorMethods.get('#createSession')
  if (
    !createSession
    || !/past:\s*\[\]/.test(createSession)
    || !/future:\s*\[\]/.test(createSession)
    || !/importState:\s*['"]idle['"]/.test(createSession)
  ) {
    findings.push({ module: 'session', detail: 'history and import state are not initialized per target session' })
  }
  for (const unit of sources.session) {
    for (const state of topLevelSharedEditorState(unit)) {
      findings.push({ module: 'session', detail: `${unit.path} exposes shared module-level ${state}` })
    }
  }

  const documentPaths = namedFunctionTexts(sources.session, 'documentPath')
  if (documentPaths.length !== 1) {
    findings.push({ module: 'session', detail: 'missing single canonical scoped editor client path builder' })
  } else {
    const path = documentPaths[0]!.text
    const completePath = TARGET_KEY_DIMENSIONS.every((dimension) => (
      path.includes(`encodeURIComponent(target.${dimension})`)
    ))
      && path.includes('/api/fuma/organizations/')
      && path.includes('/workspaces/')
      && path.includes('/sites/')
      && path.includes('/editor/document')
      && path.includes('${organization}')
      && path.includes('${workspace}')
      && path.includes('${site}')
    if (!completePath) {
      findings.push({ module: 'session', detail: 'canonical editor client path omits encoded target ancestry' })
    }
  }
  const canonicalPathRequestCount = (sessionSource.match(/(?:apiRequest|fetchImpl)\(path\s*,/g)?.length ?? 0)
  if (
    !/const\s+path\s*=\s*documentPath\(boundTarget\)/.test(sessionSource)
    || canonicalPathRequestCount !== 2
    || sessionSource.includes('/admin/api/cms/site-document')
  ) {
    findings.push({ module: 'session', detail: 'load and save do not share the canonical scoped editor client path' })
  }
  const clientAuthorityFields = requestBodyPropertyNames(sources.session)
    .filter((field) => BODY_AUTHORITY_FIELDS.includes(
      field as (typeof BODY_AUTHORITY_FIELDS)[number],
    ))
  if (clientAuthorityFields.length > 0) {
    findings.push({
      module: 'session',
      detail: `editor client sends caller authority in its PUT body: ${clientAuthorityFields.join(', ')}`,
    })
  }

  const profileSource = joined(sources.profile)
  if (!profileSource.includes('resolveProfileEditorSurfaces')) {
    findings.push({ module: 'profile', detail: 'missing resolveProfileEditorSurfaces public API' })
  }
  if (!/registry\.compose\(input\.profileId, input\.capabilityOverrides\)/.test(profileSource)) {
    findings.push({ module: 'profile', detail: 'profile editor is not registry/capability-composition driven' })
  }
  if (!/activeCapabilities\.has\(capabilityId\)/.test(profileSource)) {
    findings.push({ module: 'profile', detail: 'editor surfaces are not restricted to composed capabilities' })
  }
  if (
    !/permissions\.get\(contribution\.viewPermission\)\s*===\s*true/.test(profileSource)
    || !/permissions\.get\(contribution\.writePermission\)\s*===\s*true/.test(profileSource)
    || !/if\s*\(!surface\?\.access\.visible\)\s*return null/.test(profileSource)
  ) {
    findings.push({ module: 'profile', detail: 'editor surfaces are not gated only by capability permissions' })
  }

  const scopedShell = unitEnding(sources.integration, '/FumaScopedShell.tsx')?.source ?? ''
  const hostedShell = unitEnding(sources.integration, '/HostedStaffShell.tsx')?.source ?? ''
  if (
    !/const\s+readyContext:\s*FumaScopedShellReadyContext/.test(scopedShell)
    || !/children\(readyContext\)/.test(scopedShell)
    || !/if\s*\(model\.kind\s*===\s*['"]state['"]\)/.test(scopedShell)
    || !/<FumaScopedShell[\s\S]*\{\(shell\)\s*=>\s*\([\s\S]*<HostedProfileEditorSurface[\s\S]*shell=\{shell\}/.test(hostedShell)
  ) {
    findings.push({
      module: 'integration',
      detail: 'hosted editor surface is not rendered exclusively from the scoped shell ready context',
    })
  }

  const router = unitEnding(sources.integration, '/server/router.ts')?.source
    ?? unitEnding(sources.integration, 'server/router.ts')?.source
    ?? ''
  const seam = /([A-Za-z0-9_]*fuma[A-Za-z0-9_]*scoped[A-Za-z0-9_]*)\??:\s*FumaScopedRouteBoundary/i.exec(router)
  if (!seam) {
    findings.push({
      module: 'integration',
      detail: 'central Studio router exposes no FumaScopedRouteBoundary mount seam',
    })
  } else {
    const field = seam[1]!
    const routerUnits = sources.integration.filter(({ path }) => path.endsWith('server/router.ts'))
    const handler = functionEntries(routerUnits).find(({ text }) => (
      text.includes(`runtime.${field}`) && /\.handle\(req\)/.test(text)
    ))
    const routesTable = /const\s+routes[^=]*=\s*\[([\s\S]*?)\]/.exec(router)?.[1] ?? ''
    if (!handler || handler.name === '<anonymous>' || !routesTable.includes(handler.name)) {
      findings.push({
        module: 'integration',
        detail: 'central Studio router does not dispatch the mounted scoped boundary',
      })
    }
  }

  return findings
}

const SAFE_SOURCES: ModuleSources = Object.freeze({
  server: Object.freeze([{
    path: 'server/fuma/editor/model.ts',
    source: `
      const EditorIncrementalSaveSchema = Type.Object({ site: SiteShellSchema }, { additionalProperties: false })
      type FumaRepositoryScope = Readonly<{ platformId: string; organizationId: string;
        workspaceId: string; siteId: string; ownerKey: string; generation: number }>
      function key(identity: FumaRepositoryScope, resourceKind: string, logicalId: string) {
        return { platformId: identity.platformId, ownerKey: identity.ownerKey,
          generation: identity.generation, resourceKind, logicalId }
      }
      function exactActiveScope() { return true }
      function coordinate(identity: FumaRepositoryScope) { return identity }
      class BoundEditorRepository {
        load() { return this.#operation(() => Promise.resolve(null)) }
        save(input: unknown) { return this.#operation(() => Promise.resolve(input)) }
        replaceFromImport(input: unknown) { return this.#operation(() => Promise.resolve(input)) }
        #operation(work: (transaction: unknown) => Promise<unknown>) {
          return this.#storage.transaction(async (transaction: any) => {
            const authority = await transaction.loadScopeAuthorityForUpdate(coordinate(this.identity))
            if (!exactActiveScope(authority, this.identity)) throw new Error('denied')
            return await work(transaction)
          })
        }
      }
      export class EditorScopedRepository {}
      async function bindRepository(ports: any, handlerInput: any) {
        const { context, repositoryScope } = handlerInput
        const editorSessionId = await ports.sessions.resolveEditorSessionKey({ context, repositoryScope })
        return ports.repository.forScope({ ...repositoryScope, profileId: context.profile.id, editorSessionId })
      }
      async function saveDocument(ports: any, handlerInput: any) {
        const body = await readValidatedBody(handlerInput.request, EditorIncrementalSaveSchema)
        const repository = await bindRepository(ports, handlerInput)
        return repository.save(body)
      }
      export function createEditorScopedRouteDeclarations() {
        return [
          { method: 'GET' as const, path: '/editor/document' as const,
            permission: 'content.pages.read' as const, handler: () => null },
          { method: 'PUT' as const, path: '/editor/document' as const,
            permission: 'content.pages.write' as const, handler: saveDocument },
        ]
      }
    `,
  }]),
  session: Object.freeze([{
    path: 'src/admin/fuma/editorSession/model.ts',
    source: `
      function targetKey(target: EditorSessionTarget) {
        return JSON.stringify([target.organizationId, target.workspaceId, target.siteId])
      }
      function documentPath(target: EditorSessionTarget) {
        const organization = encodeURIComponent(target.organizationId)
        const workspace = encodeURIComponent(target.workspaceId)
        const site = encodeURIComponent(target.siteId)
        return \`/api/fuma/organizations/\${organization}/workspaces/\${workspace}/sites/\${site}/editor/document\`
      }
      export class EditorSessionCoordinator {
        #sessions = new Map()
        #active: unknown = null
        #createSession() {
          return { past: [], future: [], importState: 'idle', loadToken: 0, saveToken: 0, importToken: 0 }
        }
        async #load(session: any) {
          const token = ++session.loadToken
          const loaded = await session.adapter.load()
          if (session.loadToken !== token) return
          return loaded
        }
        async save(session: any) {
          const token = ++session.saveToken
          await session.adapter.save()
          if (session.saveToken !== token) return
        }
        async importDocument(session: any) {
          const token = ++session.importToken
          const imported = await session.adapter.importDocument()
          if (session.importToken !== token) return
          return imported
        }
        #deactivate(session: any) {
          session.loadToken += 1
          session.saveToken += 1
          session.importToken += 1
        }
      }
      export function createEditorSessionCoordinator() { return new EditorSessionCoordinator() }
      export function createFumaEditorScopedHttpAdapter(target: EditorSessionTarget) {
        const boundTarget = target
        const path = documentPath(boundTarget)
        return {
          load: () => apiRequest(path, { schema: DocumentSchema }),
          save: (document: any) => apiRequest(path, { method: 'PUT', body: {
            site: document.site, changedPages: document.pages, deletedPageIds: [],
            changedComponents: document.visualComponents, deletedComponentIds: [],
            changedLayouts: document.layouts, deletedLayoutIds: [],
          }, schema: DocumentSchema }),
        }
      }
    `,
  }]),
  profile: Object.freeze([{
    path: 'src/admin/fuma/profileEditor/model.tsx',
    source: `
      export function resolveProfileEditorSurfaces(input: any, registry: any) {
        const composed = registry.compose(input.profileId, input.capabilityOverrides)
        const activeCapabilities = new Set(composed.capabilities.map(({ id }: any) => id))
        const permissions = new Map(input.permissionDecisions)
        return input.contributions
          .filter(({ capabilityId }: any) => activeCapabilities.has(capabilityId))
          .map((contribution: any) => ({
            access: {
              visible: permissions.get(contribution.viewPermission) === true,
              mutable: permissions.get(contribution.writePermission) === true,
            },
          }))
      }
      function targetKey(target: EditorSessionTarget) {
        return JSON.stringify([target.organizationId, target.workspaceId, target.siteId])
      }
      export function HostedProfileEditorSurface({ surface }: any) {
        if (!surface?.access.visible) return null
        return <section />
      }
    `,
  }]),
  integration: Object.freeze([{
    path: 'src/admin/fuma/FumaScopedShell.tsx',
    source: `
      export function FumaScopedShell({ children }: any) {
        if (model.kind === 'error') return null
        if (model.kind === 'state') return null
        const readyContext: FumaScopedShellReadyContext = Object.freeze({ resolution: model.resolution })
        const renderedChildren = children(readyContext)
        return <main>{renderedChildren}</main>
      }
    `,
  }, {
    path: 'src/admin/preauth/HostedStaffShell.tsx',
    source: `
      export function HostedStaffShell() {
        return <FumaScopedShell>{(shell) => (
          <HostedProfileEditorSurface shell={shell} />
        )}</FumaScopedShell>
      }
    `,
  }, {
    path: 'server/router.ts',
    source: `
      import type { FumaScopedRouteBoundary } from './fuma/context'
      interface ServerRuntime { fumaScopedRoutes?: FumaScopedRouteBoundary }
      const routes: readonly RouteHandler[] = [tryServeFumaScopedRoutes]
      function tryServeFumaScopedRoutes(req: Request, runtime: ServerRuntime) {
        return runtime.fumaScopedRoutes?.handle(req) ?? null
      }
    `,
  }]),
})

function replace(
  sources: ModuleSources,
  module: ModuleName,
  before: string,
  after: string,
  unitIndex = 0,
): ModuleSources {
  const unit = sources[module][unitIndex]
  if (!unit) throw new Error(`Missing synthetic ${module} source at index ${unitIndex}`)
  expect(unit.source).toContain(before)
  const next = [...sources[module]]
  next[unitIndex] = { ...unit, source: unit.source.replace(before, after) }
  return { ...sources, [module]: next }
}

function append(sources: ModuleSources, module: ModuleName, addition: string): ModuleSources {
  const first = sources[module][0]
  if (!first) throw new Error(`Missing synthetic ${module} source`)
  return {
    ...sources,
    [module]: [{ ...first, source: `${first.source}\n${addition}` }, ...sources[module].slice(1)],
  }
}

function details(sources: ModuleSources): string[] {
  return audit(sources).map(({ module, detail }) => `${module}: ${detail}`)
}

describe('FUMA-027 multi-site editor architecture', () => {
  it('audits every required production source invariant', () => {
    expect(audit(productionSources())).toEqual([])
  })

  it('rejects default authority, loose tenant arguments, and incomplete target/storage keys', () => {
    expect(audit(SAFE_SOURCES)).toEqual([])

    const defaultSite = append(SAFE_SOURCES, 'server', `const siteAuthority = scope || 'default'`)
    expect(details(defaultSite).some((detail) => detail.includes('default/single-site fallback'))).toBe(true)

    const looseAuthority = append(
      SAFE_SOURCES,
      'server',
      'export function unsafe(organizationId: string, workspaceId: string, siteId: string) { return siteId }',
    )
    expect(details(looseAuthority).some((detail) => detail.includes('loose scalar authority'))).toBe(true)

    const incompleteTarget = replace(
      SAFE_SOURCES,
      'session',
      'target.organizationId, target.workspaceId, target.siteId',
      'target.organizationId, target.siteId',
    )
    expect(details(incompleteTarget).some((detail) => (
      detail.includes('target key is incomplete') && detail.includes('workspaceId')
    ))).toBe(true)

    for (const [before, missing] of [
      ['ownerKey: identity.ownerKey,', 'ownerKey'],
      ['generation: identity.generation,', 'generation'],
    ] as const) {
      const incompleteStorage = replace(SAFE_SOURCES, 'server', before, '')
      expect(details(incompleteStorage).some((detail) => (
        detail.includes('storage key is incomplete') && detail.includes(missing)
      ))).toBe(true)
    }
  })

  it('rejects any repository operation or shared guard that skips fresh exact authority', () => {
    const unguardedLoad = replace(
      SAFE_SOURCES,
      'server',
      'load() { return this.#operation(() => Promise.resolve(null)) }',
      'load() { return Promise.resolve(null) }',
    )
    expect(details(unguardedLoad)).toContain(
      'server: BoundEditorRepository.load bypasses per-operation scope revalidation',
    )

    const inexactGuard = replace(
      SAFE_SOURCES,
      'server',
      "if (!exactActiveScope(authority, this.identity)) throw new Error('denied')",
      "if (!authority) throw new Error('denied')",
    )
    expect(details(inexactGuard)).toContain(
      'server: scope authority is not reloaded and exactly matched before each editor operation',
    )
  })

  it('rejects drifted scoped declarations and caller authority in server or client bodies', () => {
    const wrongPut = replace(SAFE_SOURCES, 'server', "method: 'PUT' as const", "method: 'PATCH' as const")
    expect(details(wrongPut).some((detail) => detail.includes('scoped editor declarations must be exactly'))).toBe(true)

    const serverBodyAuthority = replace(
      SAFE_SOURCES,
      'server',
      'const repository = await bindRepository(ports, handlerInput)',
      'const ownerKey = body.ownerKey\n        const repository = await bindRepository(ports, handlerInput)',
    )
    expect(details(serverBodyAuthority).some((detail) => detail.includes('reads caller body authority'))).toBe(true)

    const clientBodyAuthority = replace(
      SAFE_SOURCES,
      'session',
      'site: document.site, changedPages:',
      'site: document.site, ownerKey: target.ownerKey, changedPages:',
    )
    expect(details(clientBodyAuthority).some((detail) => detail.includes('client sends caller authority'))).toBe(true)
  })

  it('rejects a partial or bypassed canonical browser client path', () => {
    const partialPath = replace(
      SAFE_SOURCES,
      'session',
      '/workspaces/${workspace}',
      '/workspaces/omitted',
    )
    expect(details(partialPath)).toContain(
      'session: canonical editor client path omits encoded target ancestry',
    )

    const bypassedSave = replace(
      SAFE_SOURCES,
      'session',
      "save: (document: any) => apiRequest(path, { method: 'PUT'",
      "save: (document: any) => apiRequest('/admin/api/cms/site-document', { method: 'PUT'",
    )
    expect(details(bypassedSave)).toContain(
      'session: load and save do not share the canonical scoped editor client path',
    )
  })

  it('rejects stale load/save/import results and shared tab import/history state', () => {
    for (const token of ['loadToken', 'saveToken', 'importToken'] as const) {
      const staleBlind = replace(
        SAFE_SOURCES,
        'session',
        `if (session.${token} !== token) return`,
        'if (token < 0) return',
      )
      expect(details(staleBlind)).toContain(
        `session: ${token} results are not rejected when stale`,
      )
    }

    const staleSwitch = replace(
      SAFE_SOURCES,
      'session',
      'session.importToken += 1',
      'session.importToken += 0',
    )
    expect(details(staleSwitch)).toContain(
      'session: target switches do not invalidate every operation epoch',
    )

    const sharedState = append(
      SAFE_SOURCES,
      'session',
      'const historyStack: unknown[] = []\nconst importState = new Map<string, unknown>()',
    )
    expect(details(sharedState).some((detail) => detail.includes('module-level historyStack'))).toBe(true)
    expect(details(sharedState).some((detail) => detail.includes('module-level importState'))).toBe(true)

    const sharedTabs = replace(
      SAFE_SOURCES,
      'session',
      '#sessions = new Map()',
      'sessions = sharedSessions',
    )
    expect(details(sharedTabs)).toContain(
      'session: target state is not owned by each tab coordinator instance',
    )
  })

  it('rejects profile-name branches, non-capability surfaces, and permission bypasses', () => {
    const namedProfile = append(
      SAFE_SOURCES,
      'profile',
      `export function unsafeProfile(input: { profileId: string }) {
        if (input.profileId === 'website') return 'website-editor'
        return input.profileId === 'publication' ? 'publication-editor' : 'other'
      }`,
    )
    expect(details(namedProfile).some((detail) => detail.includes('branches on a profile name'))).toBe(true)

    const allContributions = replace(
      SAFE_SOURCES,
      'profile',
      '.filter(({ capabilityId }: any) => activeCapabilities.has(capabilityId))',
      '.filter(() => true)',
    )
    expect(details(allContributions)).toContain(
      'profile: editor surfaces are not restricted to composed capabilities',
    )

    const visibleByDefault = replace(
      SAFE_SOURCES,
      'profile',
      'visible: permissions.get(contribution.viewPermission) === true',
      'visible: true',
    )
    expect(details(visibleByDefault)).toContain(
      'profile: editor surfaces are not gated only by capability permissions',
    )
  })

  it('rejects editor rendering before shell readiness and an absent central router seam', () => {
    const prematureRender = replace(
      SAFE_SOURCES,
      'integration',
      'const renderedChildren = children(readyContext)',
      'const renderedChildren = children',
    )
    expect(details(prematureRender)).toContain(
      'integration: hosted editor surface is not rendered exclusively from the scoped shell ready context',
    )

    const missingSeam = replace(
      SAFE_SOURCES,
      'integration',
      'interface ServerRuntime { fumaScopedRoutes?: FumaScopedRouteBoundary }',
      'interface ServerRuntime {}',
      2,
    )
    expect(details(missingSeam)).toContain(
      'integration: central Studio router exposes no FumaScopedRouteBoundary mount seam',
    )

    const unmountedSeam = replace(
      SAFE_SOURCES,
      'integration',
      'const routes: readonly RouteHandler[] = [tryServeFumaScopedRoutes]',
      'const routes: readonly RouteHandler[] = []',
      2,
    )
    expect(details(unmountedSeam)).toContain(
      'integration: central Studio router does not dispatch the mounted scoped boundary',
    )
  })
})
