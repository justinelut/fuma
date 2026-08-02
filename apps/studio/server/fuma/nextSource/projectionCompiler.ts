import * as ts from 'typescript'
import {
  BUILTIN_CONTAINER_TAGS,
  SAFE_CONTAINER_TAGS,
  SAFE_HTML_ATTRIBUTES,
  TEXT_TAGS,
  NextSourceProjectionError,
  addNode,
  fail,
  sourceText,
  type MutableNode,
  type ProjectionContext,
  type StaticValue,
} from './projectionShared'
import { literal, prepareSourceStaticBindings, returnExpression, staticBindingValues, staticValue, unwrap } from './projectionEvaluator'

function attributeName(name: ts.JsxAttributeName, context: ProjectionContext): string {
  if (!ts.isIdentifier(name)) fail('Namespaced JSX attributes are unsupported.', context)
  return name.text === 'className' ? 'class' : name.text.toLowerCase()
}

function attributeValue(attribute: ts.JsxAttribute, context: ProjectionContext): string | number | boolean | null {
  if (!attribute.initializer) return true
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) fail('JSX attributes must have static literal values.', context)
  return literal(attribute.initializer.expression, context)
}

function staticStyle(expression: ts.Expression, context: ProjectionContext): Record<string, string | number> {
  if (!ts.isObjectLiteralExpression(expression)) fail('The style prop must be one static object literal.', context)
  const output: Record<string, string | number> = {}
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || property.name === undefined || ts.isComputedPropertyName(property.name)) fail('The style prop cannot use spreads, methods, or computed keys.', context)
    const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : fail('The style prop contains an unsupported key.', context)
    const value = literal(property.initializer, context)
    if (typeof value !== 'string' && typeof value !== 'number') fail('Style values must be static strings or numbers.', context)
    output[key] = value
  }
  return output
}

function attributes(properties: ts.JsxAttributes, context: ProjectionContext): Readonly<{
  values: Record<string, string | number | boolean | null>
  html: Record<string, string>
  styles?: Record<string, string | number>
}> {
  const values: Record<string, string | number | boolean | null> = {}
  const html: Record<string, string> = {}
  let styles: Record<string, string | number> | undefined
  for (const property of properties.properties) {
    if (!ts.isJsxAttribute(property)) fail('JSX spread attributes are unsupported.', context)
    const rawName = attributeName(property.name, context)
    if (rawName.startsWith('on')) fail(`Event handler ${rawName} requires an adapted native data interaction.`, context)
    if (rawName === 'dangerouslysetinnerhtml') fail('dangerouslySetInnerHTML is unsupported.', context)
    if (rawName === 'style') {
      if (!property.initializer || !ts.isJsxExpression(property.initializer) || !property.initializer.expression) fail('The style prop must be one static object literal.', context)
      styles = staticStyle(property.initializer.expression, context)
      continue
    }
    const value = attributeValue(property, context)
    values[rawName] = value
    if (SAFE_HTML_ATTRIBUTES.test(rawName)) html[rawName] = value === true ? '' : String(value ?? '')
  }
  return styles ? { values, html, styles } : { values, html }
}

function jsxTagName(name: ts.JsxTagNameExpression, context: ProjectionContext): string {
  if (!ts.isIdentifier(name)) fail('Namespaced or member-expression JSX tags are unsupported.', context)
  return name.text
}

function intrinsicTag(name: ts.JsxTagNameExpression, context: ProjectionContext): string {
  const tag = jsxTagName(name, context)
  if (tag !== tag.toLowerCase()) fail('Imported or local React component could not be resolved to the supported static subset.', context)
  return tag
}

function staticTextChild(child: ts.JsxChild, context: ProjectionContext): string | null {
  if (ts.isJsxText(child)) return child.text.replace(/\s+/g, ' ')
  if (ts.isJsxExpression(child)) {
    if (!child.expression) return ''
    const value = literal(child.expression, context)
    if (value === null || typeof value === 'boolean') return ''
    return String(value)
  }
  return null
}

function allStaticText(children: readonly ts.JsxChild[], context: ProjectionContext): string | null {
  const parts: string[] = []
  for (const child of children) {
    const value = staticTextChild(child, context)
    if (value === null) return null
    parts.push(value)
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function callbackBindings(parameter: ts.ParameterDeclaration, value: StaticValue, context: ProjectionContext): ReadonlyMap<string, StaticValue> {
  if (parameter.dotDotDotToken || parameter.initializer) fail('Static collection callbacks cannot use rest or default parameters.', context)
  return staticBindingValues(parameter.name, value, context, 'Static collection callback')
}

function jsxCallbackExpression(callback: ts.ArrowFunction | ts.FunctionExpression, context: ProjectionContext): ts.Expression {
  if (!ts.isBlock(callback.body)) return unwrap(callback.body)
  const statements = callback.body.statements.filter((statement) => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))
  if (statements.length !== 1 || !ts.isReturnStatement(statements[0]) || !statements[0].expression) fail('Static collection callbacks must contain one unconditional JSX return.', context)
  return unwrap(statements[0].expression)
}

function projectExpressionChildren(expression: ts.Expression, parent: MutableNode, context: ProjectionContext, path: string): boolean {
  const value = unwrap(expression)
  if (ts.isConditionalExpression(value)) return projectExpressionChildren(staticValue(value.condition, context) ? value.whenTrue : value.whenFalse, parent, context, path)
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (!staticValue(value.left, context)) return true
    return projectExpressionChildren(value.right, parent, context, path)
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'map') {
    const collection = staticValue(value.expression.expression, context)
    if (!Array.isArray(collection)) fail('Static JSX map source must resolve to one bounded array.', context)
    if (value.arguments.length !== 1) fail('Static JSX map accepts exactly one local callback.', context)
    const callback = unwrap(value.arguments[0]!)
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) fail('Static JSX map callback must be an inline function.', context)
    if (callback.parameters.length < 1 || callback.parameters.length > 2) fail('Static JSX map callback accepts item and optional index parameters only.', context)
    const body = jsxCallbackExpression(callback, context)
    for (const [index, item] of collection.entries()) {
      const itemBindings = callbackBindings(callback.parameters[0]!, item, context)
      const indexParameter = callback.parameters[1]
      if (indexParameter && !ts.isIdentifier(indexParameter.name)) fail('Static JSX map index binding must be an identifier.', context)
      const indexBinding = indexParameter && ts.isIdentifier(indexParameter.name) ? [[indexParameter.name.text, index] as const] : []
      const nestedContext: ProjectionContext = { ...context, bindings: new Map([...context.bindings, ...itemBindings, ...indexBinding]) }
      if (!projectExpressionChildren(body, parent, nestedContext, `${path}.${index}`)) fail('Static JSX map callback must return JSX, a fragment, or a statically empty branch.', nestedContext)
    }
    return true
  }
  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value)) {
    const projected = convertJsx(value, parent.id, context, path)
    for (const node of projected) parent.children.push(node.id)
    return true
  }
  const scalar = staticValue(value, context)
  if (scalar === null || scalar === false || scalar === true) return true
  if (typeof scalar === 'object') fail('Static JSX collections must be rendered through an explicit bounded map.', context)
  const projected = addNode(context, path, 'base.text', { text: String(scalar), tag: 'none', htmlAttributes: {} }, parent.id)
  parent.children.push(projected.id)
  return true
}

function childNodes(children: readonly ts.JsxChild[], parent: MutableNode, context: ProjectionContext, path: string): void {
  let childIndex = 0
  for (const child of children) {
    if (ts.isJsxExpression(child) && !child.expression) continue
    if (ts.isJsxText(child)) {
      const normalized = child.text.replace(/\s+/g, ' ').trim()
      if (!normalized) continue
      const projected = addNode(context, `${path}.${childIndex}`, 'base.text', { text: normalized, tag: 'none', htmlAttributes: {} }, parent.id)
      parent.children.push(projected.id)
      childIndex += 1
      continue
    }
    if (ts.isJsxExpression(child) && child.expression) {
      projectExpressionChildren(child.expression, parent, context, `${path}.${childIndex}`)
      childIndex += 1
      continue
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      const projected = convertJsx(child, parent.id, context, `${path}.${childIndex}`)
      for (const node of projected) parent.children.push(node.id)
      childIndex += 1
      continue
    }
    fail('Unsupported JSX child.', context)
  }
}

function convertElement(tag: string, properties: ts.JsxAttributes, children: readonly ts.JsxChild[], parentId: string | null, context: ProjectionContext, path: string): MutableNode {
  const parsedAttributes = attributes(properties, context)
  const className = parsedAttributes.values.class
  if (className !== undefined && typeof className !== 'string') fail('className must be a static string.', context)
  const htmlAttributes = { ...parsedAttributes.html }
  if (TEXT_TAGS.has(tag)) {
    const text = allStaticText(children, context)
    if (text !== null) return addNode(context, path, 'base.text', { text, tag, htmlAttributes }, parentId, parsedAttributes.styles, className)
  }
  if (tag === 'a') {
    const href = parsedAttributes.values.href
    const target = parsedAttributes.values.target
    if (href !== undefined && typeof href !== 'string') fail('Link href must be a static string.', context)
    if (target !== undefined && !['_self', '_blank', '_parent', '_top'].includes(String(target))) fail('Link target is invalid.', context)
    const node = addNode(context, path, 'base.link', { href: href ?? '#', text: allStaticText(children, context) ?? '', target: target ?? '_self', htmlAttributes }, parentId, parsedAttributes.styles, className)
    if (allStaticText(children, context) === null) childNodes(children, node, context, `${path}.children`)
    return node
  }
  if (tag === 'button') {
    const label = allStaticText(children, context)
    if (label === null) fail('Buttons may contain only static text in the supported compiler subset.', context)
    return addNode(context, path, 'base.button', { label, href: '', target: '_self', disabled: parsedAttributes.values.disabled === true, htmlAttributes }, parentId, parsedAttributes.styles, className)
  }
  if (tag === 'img') {
    if (children.length > 0) fail('Image elements cannot contain children.', context)
    const src = parsedAttributes.values.src
    const alt = parsedAttributes.values.alt
    if (typeof src !== 'string' || !src.startsWith('/') || src.includes('?') || src.includes('#') || !context.assetUrls.has(src)) fail('Image projection requires an exact hash-bound imported public asset URL.', context)
    if (typeof alt !== 'string') fail('Imported images require explicit static alt text, including an empty string for decorative images.', context)
    const imageAttributes: Record<string, string> = { ...htmlAttributes, src, alt }
    for (const name of ['width', 'height', 'loading', 'decoding', 'fetchpriority', 'sizes'] as const) {
      const value = parsedAttributes.values[name]
      if (value === undefined || value === null) continue
      if (typeof value !== 'string' && typeof value !== 'number') fail(`Image attribute ${name} must be a static string or number.`, context)
      imageAttributes[name] = String(value)
    }
    if (imageAttributes.loading && !['lazy', 'eager'].includes(imageAttributes.loading)) fail('Image loading must be lazy or eager.', context)
    if (imageAttributes.decoding && !['async', 'sync', 'auto'].includes(imageAttributes.decoding)) fail('Image decoding must be async, sync, or auto.', context)
    if (imageAttributes.fetchpriority && !['high', 'low', 'auto'].includes(imageAttributes.fetchpriority)) fail('Image fetchPriority must be high, low, or auto.', context)
    return addNode(context, path, 'base.container', { tag: 'custom', customTag: 'img', htmlAttributes: imageAttributes }, parentId, parsedAttributes.styles, className)
  }
  if (tag === 'picture' || tag === 'source') fail('Picture/source projection requires an adapted hash-bound media composition.', context)
  if (!SAFE_CONTAINER_TAGS.has(tag)) fail(`Intrinsic element <${tag}> is outside the supported semantic compiler subset.`, context)
  if ((tag === 'br' || tag === 'hr') && children.length > 0) fail(`Void element <${tag}> cannot have children.`, context)
  const node = addNode(context, path, 'base.container', { tag: BUILTIN_CONTAINER_TAGS.has(tag) ? tag : 'custom', customTag: BUILTIN_CONTAINER_TAGS.has(tag) ? '' : tag, htmlAttributes }, parentId, parsedAttributes.styles, className)
  childNodes(children, node, context, `${path}.children`)
  return node
}

type ComponentFunction = Readonly<{ declaration: ts.FunctionLikeDeclaration; exported: boolean; defaultExport: boolean }>
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean { return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)) }

function componentFunctions(sourceFile: ts.SourceFile): Map<string, ComponentFunction> {
  const output = new Map<string, ComponentFunction>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) output.set(statement.name.text, { declaration: statement, exported: hasModifier(statement, ts.SyntaxKind.ExportKeyword), defaultExport: hasModifier(statement, ts.SyntaxKind.DefaultKeyword) })
    if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const initializer = unwrap(declaration.initializer)
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) output.set(declaration.name.text, { declaration: initializer, exported, defaultExport: false })
      }
    }
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause) || statement.moduleSpecifier) continue
    for (const element of statement.exportClause.elements) {
      const existing = output.get(element.propertyName?.text ?? element.name.text)
      if (existing) output.set(element.name.text, { ...existing, exported: true })
    }
  }
  return output
}

function sourceFileFor(path: string, context: ProjectionContext): ts.SourceFile {
  const cached = context.sourceFiles.get(path)
  if (cached) return cached
  const source = sourceText(context.files, path)
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, scriptKind)
  const parseDiagnostics = (parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) throw new NextSourceProjectionError('Component source contains TypeScript/JSX syntax errors.', path)
  context.sourceFiles.set(path, parsed)
  return parsed
}

function importedComponent(localName: string, context: ProjectionContext): Readonly<{ sourcePath: string; exportName: string }> | null {
  for (const statement of context.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    let exportName: string | null = clause.name?.text === localName ? 'default' : null
    if (!exportName && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const binding = clause.namedBindings.elements.find((element) => !element.isTypeOnly && element.name.text === localName)
      if (binding) exportName = binding.propertyName?.text ?? binding.name.text
    }
    if (!exportName) continue
    const specifierText = statement.moduleSpecifier.text
    const imported = context.moduleByPath.get(context.sourcePath)?.imports.find(({ specifier, resolvedPath, kind }) => specifier === specifierText && Boolean(resolvedPath) && kind !== 'type-static' && kind !== 'type-reexport')
    if (!imported?.resolvedPath) fail(`Component ${localName} does not resolve to an analyzed local source module.`, context)
    return { sourcePath: imported.resolvedPath, exportName }
  }
  return null
}

function frameworkComponent(localName: string, context: ProjectionContext): 'link' | 'image' | null {
  for (const statement of context.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue
    if (statement.importClause?.name?.text !== localName) continue
    const specifier = statement.moduleSpecifier.text
    const imported = context.moduleByPath.get(context.sourcePath)?.imports.find((item) => item.specifier === specifier && item.policy === 'supported')
    if (!imported) return null
    if (specifier === 'next/link') return 'link'
    if (specifier === 'next/image') return 'image'
  }
  return null
}

function assertFrameworkProps(kind: 'link' | 'image', properties: ts.JsxAttributes, context: ProjectionContext): void {
  const common = ['key', 'className', 'style', 'id', 'title', 'role', 'tabIndex', 'lang', 'dir']
  const allowed = new Set(kind === 'link'
    ? [...common, 'href', 'target', 'prefetch', 'replace', 'scroll', 'shallow', 'locale']
    : [...common, 'src', 'alt', 'width', 'height', 'loading', 'decoding', 'fetchPriority', 'sizes', 'fill', 'priority', 'quality', 'placeholder', 'blurDataURL', 'unoptimized'])
  for (const property of properties.properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) fail(`Allowlisted next/${kind} does not accept spread or namespaced props.`, context)
    if (!allowed.has(property.name.text) && !/^(?:aria|data)-[a-z0-9-]+$/.test(property.name.text)) fail(`Allowlisted next/${kind} prop ${property.name.text} requires adaptation.`, context)
  }
}

function defaultComponentFunction(sourceFile: ts.SourceFile): ComponentFunction | null {
  const functions = componentFunctions(sourceFile)
  const direct = [...functions.values()].find(({ defaultExport }) => defaultExport)
  if (direct) return direct
  const assignment = sourceFile.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals)
  if (!assignment) return null
  const expression = unwrap(assignment.expression)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return { declaration: expression, exported: true, defaultExport: true }
  if (!ts.isIdentifier(expression)) return null
  const referenced = functions.get(expression.text)
  return referenced ? { ...referenced, exported: true, defaultExport: true } : null
}

function componentFunction(tag: string, context: ProjectionContext): Readonly<{ sourcePath: string; sourceFile: ts.SourceFile; definition: ComponentFunction; identity: string }> {
  const local = componentFunctions(context.sourceFile).get(tag)
  if (local) return { sourcePath: context.sourcePath, sourceFile: context.sourceFile, definition: local, identity: `${context.sourcePath}#${tag}` }
  const imported = importedComponent(tag, context)
  if (!imported) fail(`Component ${tag} is neither a local static component nor an analyzed local import.`, context)
  const sourceFile = sourceFileFor(imported.sourcePath, context)
  if (imported.exportName === 'default') {
    const definition = defaultComponentFunction(sourceFile)
    if (!definition) throw new NextSourceProjectionError(`Default component export for ${tag} is unavailable.`, imported.sourcePath)
    return { sourcePath: imported.sourcePath, sourceFile, definition, identity: `${imported.sourcePath}#default` }
  }
  const definition = componentFunctions(sourceFile).get(imported.exportName)
  if (!definition?.exported) throw new NextSourceProjectionError(`Named component export ${imported.exportName} is unavailable.`, imported.sourcePath)
  return { sourcePath: imported.sourcePath, sourceFile, definition, identity: `${imported.sourcePath}#${imported.exportName}` }
}

function componentPropValues(tag: string, properties: ts.JsxAttributes, children: readonly ts.JsxChild[], context: ProjectionContext): Map<string, StaticValue> {
  const values = new Map<string, StaticValue>()
  for (const property of properties.properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) fail(`Component ${tag} cannot use spread or namespaced props.`, context)
    if (values.has(property.name.text)) fail(`Component ${tag} repeats prop ${property.name.text}.`, context)
    const initializer = property.initializer
    const value = !initializer ? true : ts.isStringLiteral(initializer) ? initializer.text : ts.isJsxExpression(initializer) && initializer.expression ? staticValue(initializer.expression, context) : fail(`Component ${tag} prop ${property.name.text} must be a bounded static value.`, context)
    if (property.name.text !== 'key') values.set(property.name.text, value)
  }
  const childText = allStaticText(children, context)
  if (childText === null) fail(`Component ${tag} children must be bounded static text.`, context)
  if (childText) values.set('children', childText)
  return values
}

function componentBindings(tag: string, declaration: ts.FunctionLikeDeclaration, values: ReadonlyMap<string, StaticValue>, context: ProjectionContext): Map<string, StaticValue> {
  if (declaration.parameters.length === 0) {
    if (values.size > 0) fail(`Component ${tag} receives props but declares no supported prop binding.`, context)
    return new Map()
  }
  if (declaration.parameters.length !== 1) fail(`Component ${tag} must declare at most one prop object.`, context)
  const parameter = declaration.parameters[0]!
  if (parameter.dotDotDotToken || !ts.isObjectBindingPattern(parameter.name)) fail(`Component ${tag} props must use one flat object-destructuring pattern.`, context)
  const bindings = new Map<string, StaticValue>()
  const accepted = new Set<string>()
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name) || (element.propertyName && !ts.isIdentifier(element.propertyName) && !ts.isStringLiteralLike(element.propertyName))) fail(`Component ${tag} props cannot use rest, computed, or nested bindings.`, context)
    const propName = element.propertyName?.text ?? element.name.text
    accepted.add(propName)
    const supplied = values.get(propName)
    bindings.set(element.name.text, supplied !== undefined ? supplied : element.initializer ? literal(element.initializer, context) : null)
  }
  for (const propName of values.keys()) if (!accepted.has(propName)) fail(`Component ${tag} received unsupported prop ${propName}.`, context)
  return bindings
}

function convertComponent(tag: string, properties: ts.JsxAttributes, children: readonly ts.JsxChild[], parentId: string | null, context: ProjectionContext, path: string): MutableNode[] {
  const framework = frameworkComponent(tag, context)
  if (framework) {
    assertFrameworkProps(framework, properties, context)
    if (framework === 'image' && children.length > 0) fail('Allowlisted next/image cannot contain children.', context)
    return [convertElement(framework === 'link' ? 'a' : 'img', properties, children, parentId, context, path)]
  }
  const resolved = componentFunction(tag, context)
  const definitionContext: ProjectionContext = { ...context, sourcePath: resolved.sourcePath, sourceFile: resolved.sourceFile, bindings: new Map() }
  prepareSourceStaticBindings(definitionContext)
  const values = componentPropValues(tag, properties, children, context)
  const bindings = componentBindings(tag, resolved.definition.declaration, values, definitionContext)
  if (context.componentStack.has(resolved.identity)) fail(`Component cycle detected at ${resolved.identity}.`, context)
  context.componentStack.add(resolved.identity)
  try {
    const nestedContext: ProjectionContext = { ...definitionContext, bindings: new Map([...definitionContext.bindings, ...bindings]) }
    const expression = returnExpression(resolved.definition.declaration, nestedContext)
    if (!ts.isJsxElement(expression) && !ts.isJsxSelfClosingElement(expression) && !ts.isJsxFragment(expression)) fail(`Component ${tag} must return static JSX.`, nestedContext)
    return convertJsx(expression, parentId, nestedContext, path)
  } finally { context.componentStack.delete(resolved.identity) }
}

export function convertJsx(jsx: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, parentId: string | null, context: ProjectionContext, path: string): MutableNode[] {
  if (ts.isJsxFragment(jsx)) {
    const synthetic = addNode(context, path, 'base.container', { tag: 'div', customTag: '', htmlAttributes: { 'data-fuma-fragment': '' } }, parentId)
    childNodes(jsx.children, synthetic, context, `${path}.children`)
    return [synthetic]
  }
  if (ts.isJsxSelfClosingElement(jsx)) {
    const tag = jsxTagName(jsx.tagName, context)
    return tag === tag.toLowerCase() ? [convertElement(intrinsicTag(jsx.tagName, context), jsx.attributes, [], parentId, context, path)] : convertComponent(tag, jsx.attributes, [], parentId, context, path)
  }
  const openTag = jsxTagName(jsx.openingElement.tagName, context)
  const closeTag = jsxTagName(jsx.closingElement.tagName, context)
  if (openTag !== closeTag) fail('JSX opening and closing tags differ.', context)
  return openTag === openTag.toLowerCase()
    ? [convertElement(intrinsicTag(jsx.openingElement.tagName, context), jsx.openingElement.attributes, jsx.children, parentId, context, path)]
    : convertComponent(openTag, jsx.openingElement.attributes, jsx.children, parentId, context, path)
}
