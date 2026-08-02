import ts from 'typescript'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FileMap } from './types'
import type { NextSourceDraftRevision } from './nextSourcePortabilityContracts'
import {
  NextSourceGoogleFontSystemFixPlanSchema,
  type NextSourceGoogleFontSystemFixPlan,
  type NextSourceGoogleFontSystemMapping,
  type NextSourcePatch,
} from './nextSourcePortabilityContracts'

const decoder = new TextDecoder('utf-8', { fatal: true })
const FONT_VARIABLE = /^--font-[a-z0-9-]+$/
const FONT_WEIGHT = /^[1-9]00$/
const GENERIC_FAMILY = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace'])
const ALLOWED_OPTIONS = new Set(['subsets', 'weight', 'style', 'variable', 'display'])
const REQUIRED_OPTIONS = ['subsets', 'weight', 'variable', 'display'] as const

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decode(path: string, bytes: Uint8Array): string {
  try { return decoder.decode(bytes) } catch { throw new Error(`Deterministic font adaptation requires UTF-8 source: ${path}`) }
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function normalizePath(path: string): string | null {
  const output: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (output.length === 0) return null
      output.pop()
    } else output.push(part)
  }
  return output.join('/')
}

function resolveCssPath(sourcePath: string, specifier: string, files: FileMap): string | null {
  const candidate = specifier.startsWith('@/')
    ? normalizePath(`src/${specifier.slice(2)}`)
    : normalizePath(`${dirname(sourcePath)}/${specifier}`)
  return candidate && files.files[candidate] ? candidate : null
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function stringValue(node: ts.Expression, label: string): string {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    throw new Error(`Unsupported next/font/google ${label}; only string literals are deterministic.`)
  }
  return node.text
}

function stringList(node: ts.Expression, label: string): string[] {
  const values = ts.isArrayLiteralExpression(node)
    ? node.elements.map((item) => stringValue(item as ts.Expression, label))
    : [stringValue(node, label)]
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`Unsupported next/font/google ${label}; a non-empty unique literal list is required.`)
  }
  return values
}

function parseOptions(call: ts.CallExpression): Readonly<{
  subsets: string[]
  weights: string[]
  styles: Array<'normal' | 'italic'>
  variable: string
  display: 'swap'
}> {
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0]!)) {
    throw new Error('Unsupported next/font/google options; one literal object is required.')
  }
  const values = new Map<string, ts.Expression>()
  for (const item of call.arguments[0].properties) {
    if (!ts.isPropertyAssignment(item)) throw new Error('Unsupported next/font/google options; spreads and shorthand are denied.')
    const name = propertyName(item.name)
    if (!name || !ALLOWED_OPTIONS.has(name) || values.has(name)) {
      throw new Error(`Unsupported next/font/google option: ${name ?? 'computed'}`)
    }
    values.set(name, item.initializer)
  }
  if (REQUIRED_OPTIONS.some((name) => !values.has(name))) {
    throw new Error('Unsupported next/font/google options; subsets, weight, variable, and display are required; style may use the normal default.')
  }
  const subsets = stringList(values.get('subsets')!, 'subsets')
  const weights = stringList(values.get('weight')!, 'weight')
  const styles = values.has('style') ? stringList(values.get('style')!, 'style') : ['normal']
  const variable = stringValue(values.get('variable')!, 'variable')
  const display = stringValue(values.get('display')!, 'display')
  if (subsets.some((value) => !/^[a-z0-9-]{1,64}$/.test(value))) throw new Error('Unsupported next/font/google subset.')
  if (weights.some((value) => !FONT_WEIGHT.test(value))) throw new Error('Unsupported next/font/google weight.')
  if (styles.some((value) => value !== 'normal' && value !== 'italic')) throw new Error('Unsupported next/font/google style.')
  if (!FONT_VARIABLE.test(variable)) throw new Error('Unsupported next/font/google variable; a lowercase --font-* literal is required.')
  if (display !== 'swap') throw new Error('Unsupported next/font/google display; only swap has a reviewed fallback rewrite.')
  return { subsets, weights, styles: styles as Array<'normal' | 'italic'>, variable, display }
}

function isClassNameTemplateUsage(access: ts.PropertyAccessExpression): boolean {
  let current: ts.Node = access
  let template = false
  while (current.parent && !ts.isStatement(current.parent)) {
    current = current.parent
    if (ts.isTemplateExpression(current)) template = true
    if (ts.isJsxAttribute(current)) return template && current.name.getText() === 'className'
  }
  return false
}

function blankRange(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/[^\r\n]/g, '')
}

function safeFallback(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact || compact.length > 1024 || /[{};]|(?:var|url|calc)\s*\(/i.test(compact)) {
    throw new Error('Unsupported next/font/google fallback; a bounded concrete system stack is required.')
  }
  const parts = compact.split(',').map((part) => part.trim()).filter(Boolean)
  const last = parts.at(-1)?.replace(/^['"]|['"]$/g, '').toLowerCase()
  if (!last || !GENERIC_FAMILY.has(last) || parts.some((part) => !/^(?:-?[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z][A-Za-z0-9 ._-]*"|'[A-Za-z][A-Za-z0-9 ._-]*')$/.test(part))) {
    throw new Error('Unsupported next/font/google fallback; the authored stack must end in a safe generic family.')
  }
  return compact
}

function replaceOnce(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
}

export async function buildNextSourceGoogleFontSystemFix(
  revision: NextSourceDraftRevision,
  files: FileMap,
  diagnosticId: string,
): Promise<NextSourceGoogleFontSystemFixPlan> {
  const diagnostic = revision.analysis.diagnostics.find((item) => item.id === diagnosticId)
  if (!diagnostic || diagnostic.category !== 'unsupported-next-api' || diagnostic.specifier !== 'next/font/google') {
    throw new Error('Deterministic font adaptation requires one exact next/font/google diagnostic.')
  }
  const sourceEntry = files.files[diagnostic.path]
  if (!sourceEntry) throw new Error('Deterministic font adaptation source path is unavailable.')
  const sourceHash = await sha256(sourceEntry.bytes)
  const evidence = revision.analysis.files.find((item) => item.path === diagnostic.path)
  if (!evidence || evidence.sha256 !== sourceHash) throw new Error('Deterministic font adaptation source hash changed.')
  const source = decode(diagnostic.path, sourceEntry.bytes)
  const ast = ts.createSourceFile(diagnostic.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const parseDiagnostics = (ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) throw new Error('Deterministic font adaptation requires parseable TSX source.')

  const imports = ast.statements.filter((item): item is ts.ImportDeclaration =>
    ts.isImportDeclaration(item) && ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === 'next/font/google')
  if (imports.length !== 1 || !imports[0].importClause?.namedBindings || !ts.isNamedImports(imports[0].importClause.namedBindings)) {
    throw new Error('Unsupported next/font/google import; one named static import is required.')
  }
  const imported = imports[0].importClause.namedBindings.elements.map((item) => ({
    importName: item.propertyName?.text ?? item.name.text,
    localBinding: item.name.text,
  }))
  if (imported.length === 0 || imported.length > 8 || new Set(imported.map((item) => item.localBinding)).size !== imported.length) {
    throw new Error('Unsupported next/font/google import binding set.')
  }

  const cssPaths = new Set<string>()
  for (const item of ast.statements) {
    if (!ts.isImportDeclaration(item) || !ts.isStringLiteral(item.moduleSpecifier) || !item.moduleSpecifier.text.endsWith('.css')) continue
    const resolved = resolveCssPath(diagnostic.path, item.moduleSpecifier.text, files)
    if (!resolved) throw new Error(`Imported font stylesheet does not resolve: ${item.moduleSpecifier.text}`)
    cssPaths.add(resolved)
  }
  if (cssPaths.size === 0) throw new Error('Deterministic font adaptation requires an imported CSS typography token stylesheet.')

  const instances = new Map<string, Readonly<{ importName: string; localBinding: string; statement: ts.VariableStatement; call: ts.CallExpression; options: ReturnType<typeof parseOptions> }>>()
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue
      const initializer = declaration.initializer
      if (!ts.isIdentifier(initializer.expression)) continue
      const factoryName = initializer.expression.text
      const binding = imported.find((item) => item.localBinding === factoryName)
      if (!binding) continue
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1 || instances.has(binding.localBinding)) {
        throw new Error('Unsupported next/font/google initialization; one top-level const per font is required.')
      }
      instances.set(binding.localBinding, { ...binding, statement, call: initializer, options: parseOptions(initializer) })
    }
  }
  if (instances.size !== imported.length) throw new Error('Every next/font/google binding must have one reviewed literal initialization.')
  const instanceNames = new Map([...instances.values()].map((item) => {
    const declaration = item.statement.declarationList.declarations[0]!
    return [(declaration.name as ts.Identifier).text, item]
  }))
  if (instanceNames.size !== instances.size) throw new Error('Font instance bindings must be unique.')

  const usageCounts = new Map<string, number>()
  const usageLines = new Set<number>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const importedBinding = imported.find((item) => item.localBinding === node.text)
      if (importedBinding && !ts.isImportSpecifier(node.parent) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        throw new Error(`Unsupported next/font/google factory usage: ${node.text}`)
      }
      if (instanceNames.has(node.text)) {
        const definition = ts.isVariableDeclaration(node.parent) && node.parent.name === node
        const access = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === 'variable'
        if (!definition && (!access || !isClassNameTemplateUsage(node.parent as ts.PropertyAccessExpression))) {
          throw new Error(`Unsupported next/font/google instance usage: ${node.text}; only .variable in a className template is reviewed.`)
        }
        if (access) {
          usageCounts.set(node.text, (usageCounts.get(node.text) ?? 0) + 1)
          usageLines.add(ast.getLineAndCharacterOfPosition(node.parent.getStart(ast)).line + 1)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if ([...instanceNames].some(([name]) => (usageCounts.get(name) ?? 0) === 0)) {
    throw new Error('Every next/font/google instance must contribute .variable to a className template.')
  }

  const cssSources = new Map<string, string>()
  for (const path of cssPaths) cssSources.set(path, decode(path, files.files[path]!.bytes))
  const mappings: NextSourceGoogleFontSystemMapping[] = []
  for (const [instanceBinding, item] of instanceNames) {
    const variable = item.options.variable
    const literal = new RegExp(escapeRegex(variable), 'g')
    const occurrences = [...cssSources].flatMap(([path, css]) => [...css.matchAll(literal)].map((match) => ({ path, index: match.index! })))
    if (occurrences.length !== 1) throw new Error(`Font variable ${variable} must occur exactly once in an imported CSS token declaration.`)
    const stylesheetPath = occurrences[0]!.path
    const css = cssSources.get(stylesheetPath)!
    const tokenPattern = new RegExp(`(--font-[a-z0-9-]+)(\\s*:\\s*)var\\(\\s*${escapeRegex(variable)}\\s*\\)\\s*,\\s*([^;{}]+)(;)`, 'g')
    const matches = [...css.matchAll(tokenPattern)]
    if (matches.length !== 1) throw new Error(`Font variable ${variable} is not the leading family in one concrete Fuma typography token.`)
    const match = matches[0]!
    const tokenVariable = match[1]!
    const fallbackStack = safeFallback(match[3]!)
    cssSources.set(stylesheetPath, replaceOnce(css, match.index!, match.index! + match[0].length, `${tokenVariable}${match[2]}${fallbackStack};`))
    mappings.push({
      importName: item.importName,
      localBinding: item.localBinding,
      instanceBinding,
      requestedFamily: item.importName.replaceAll('_', ' '),
      sourceVariable: variable,
      tokenVariable,
      stylesheetPath,
      stylesheetSha256: await sha256(files.files[stylesheetPath]!.bytes),
      subsets: item.options.subsets,
      weights: item.options.weights,
      styles: item.options.styles,
      display: item.options.display,
      fallbackStack,
    })
  }

  const ranges = [imports[0], ...[...instances.values()].map((item) => item.statement)]
    .map((node) => ({ start: node.getStart(ast), end: node.getEnd() }))
    .sort((left, right) => right.start - left.start)
  let replacement = source
  for (const range of ranges) replacement = replaceOnce(replacement, range.start, range.end, blankRange(replacement, range.start, range.end))
  for (const instanceBinding of instanceNames.keys()) {
    const expression = new RegExp(`\\$\\{\\s*${escapeRegex(instanceBinding)}\\.variable\\s*\\}`, 'g')
    const count = [...replacement.matchAll(expression)].length
    if (count !== usageCounts.get(instanceBinding)) throw new Error(`Font class injection changed before deterministic rewrite: ${instanceBinding}`)
    replacement = replacement.replace(expression, '')
  }
  if (/next\/font\/google/.test(replacement)) throw new Error('Deterministic font rewrite left a next/font/google import behind.')

  const patches: NextSourcePatch[] = [{ path: diagnostic.path, expectedSha256: sourceHash, replacement }]
  for (const [path, css] of [...cssSources].sort(([left], [right]) => left.localeCompare(right))) {
    const original = decode(path, files.files[path]!.bytes)
    if (css !== original) patches.push({ path, expectedSha256: await sha256(files.files[path]!.bytes), replacement: css })
  }
  const diagnosticIds = [
    diagnosticId,
    ...revision.analysis.diagnostics
      .filter((item) => item.category === 'dynamic-tailwind-denied'
        && item.path === diagnostic.path
        && item.line !== undefined
        && usageLines.has(item.line))
      .map(({ id }) => id),
  ]
  const value = {
    schemaVersion: 1,
    kind: 'next-font-google-system-fallback',
    sourceRevisionId: revision.revisionId,
    destination: revision.destination,
    diagnosticId,
    diagnosticIds,
    sourcePath: diagnostic.path,
    sourcePathSha256: sourceHash,
    inputSourceHashSha256: revision.sourceHashSha256,
    policyVersion: revision.analysis.policyVersion,
    mappings,
    patches,
    styleChange: 'review-required-system-fallback',
    networkAccessed: false,
    fontDownloaded: false,
    importedCodeExecuted: false,
    dependencyChanged: false,
  }
  const parsed = safeParseValue(NextSourceGoogleFontSystemFixPlanSchema, value)
  if (!parsed.ok) throw new Error('Deterministic font adaptation produced invalid bounded evidence.')
  return parsed.value
}
