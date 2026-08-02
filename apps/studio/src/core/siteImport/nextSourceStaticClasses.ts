import ts from 'typescript'
const MAX_ALTERNATIVES = 64
const MAX_STATIC_CLASS_VALUE = 16_384
const MAX_OBJECT_PROPERTIES = 64

export type NextSourceStaticClassAnalysis = Readonly<{
  staticClassNames: readonly string[]
  dynamicOffsets: readonly number[]
}>

type StaticObject = ReadonlyMap<string, readonly StaticAtom[]>
type StaticAtom = string | StaticObject | undefined

type LexicalBinding = Readonly<{
  declaration: ts.VariableDeclaration | null
  kind: 'const' | 'finite' | 'blocked'
  values?: readonly StaticAtom[]
}>

type EvaluationContext = Readonly<{
  bindings: ReadonlyMap<ts.Node, ReadonlyMap<string, LexicalBinding>>
  file: ts.SourceFile
  source: string
}>

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((item) => item.length > 0 && item.length <= 512)
}

function bounded(values: readonly string[]): string[] | null {
  const unique = [...new Set(values)]
  if (unique.length > MAX_ALTERNATIVES || unique.some((value) => value.length > MAX_STATIC_CLASS_VALUE)) return null
  return unique
}

function combine(left: readonly string[], right: readonly string[]): string[] | null {
  if (left.length * right.length > MAX_ALTERNATIVES) return null
  return bounded(left.flatMap((prefix) => right.map((suffix) => `${prefix}${suffix}`)))
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression
  return current
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name))
}

function isFunctionNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function mutableScope(node: ts.Node): ts.SourceFile | ts.Block | null {
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isSourceFile(current) || ts.isBlock(current)) return current
    current = current.parent
  }
  return null
}

function collectBindings(file: ts.SourceFile): Map<ts.Node, Map<string, LexicalBinding>> {
  const scopes = new Map<ts.Node, Map<string, LexicalBinding>>()
  const register = (scope: ts.Node | null, name: string, binding: LexicalBinding): void => {
    if (!scope) return
    const entries = scopes.get(scope) ?? new Map<string, LexicalBinding>()
    entries.set(name, entries.has(name) ? { declaration: null, kind: 'blocked' } : binding)
    scopes.set(scope, entries)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && (ts.isSourceFile(node.parent) || ts.isBlock(node.parent))) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const declaration of node.declarationList.declarations) {
        const names = bindingNames(declaration.name)
        for (const name of names) {
          register(node.parent, name, isConst && ts.isIdentifier(declaration.name) && declaration.initializer
            ? { declaration, kind: 'const' }
            : { declaration: null, kind: 'blocked' })
        }
      }
    }
    if (isFunctionNode(node) && node.body && ts.isBlock(node.body)) {
      for (const parameter of node.parameters) {
        for (const name of bindingNames(parameter.name)) register(node.body, name, { declaration: null, kind: 'blocked' })
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      register(mutableScope(node.parent), node.name.text, { declaration: null, kind: 'blocked' })
    }
    if (ts.isImportDeclaration(node) && ts.isSourceFile(node.parent) && node.importClause) {
      if (node.importClause.name) register(node.parent, node.importClause.name.text, { declaration: null, kind: 'blocked' })
      const named = node.importClause.namedBindings
      if (named && ts.isNamespaceImport(named)) register(node.parent, named.name.text, { declaration: null, kind: 'blocked' })
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) register(node.parent, element.name.text, { declaration: null, kind: 'blocked' })
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isBlock(node.block)) {
      for (const name of bindingNames(node.variableDeclaration.name)) register(node.block, name, { declaration: null, kind: 'blocked' })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return scopes
}


function finiteJsxAttribute(
  attribute: ts.JsxAttribute,
  context: EvaluationContext,
): readonly StaticAtom[] | null {
  if (!attribute.initializer) return null
  if (ts.isStringLiteral(attribute.initializer)) return [attribute.initializer.text]
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return null
  return staticAtoms(attribute.initializer.expression, context, new Set())
}

function collectFiniteLocalComponentProps(
  file: ts.SourceFile,
  bindings: Map<ts.Node, Map<string, LexicalBinding>>,
  source: string,
): void {
  const context: EvaluationContext = { bindings, file, source }
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement)
      || !statement.name
      || !statement.body
      || statement.parameters.length !== 1
      || statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword)
      || !ts.isObjectBindingPattern(statement.parameters[0]!.name)) continue

    const componentName = statement.name.text
    const calls: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = []
    let safeReferences = true
    const inspect = (node: ts.Node): void => {
      if (!safeReferences) return
      if (ts.isIdentifier(node) && node.text === componentName && node !== statement.name) {
        const parent = node.parent
        if (ts.isJsxOpeningElement(parent) && parent.tagName === node) calls.push(parent)
        else if (ts.isJsxSelfClosingElement(parent) && parent.tagName === node) calls.push(parent)
        else if (!(ts.isJsxClosingElement(parent) && parent.tagName === node)) safeReferences = false
      }
      ts.forEachChild(node, inspect)
    }
    inspect(file)
    if (!safeReferences || calls.length === 0 || calls.length > MAX_ALTERNATIVES
      || calls.some((call) => call.attributes.properties.some(ts.isJsxSpreadAttribute))) continue

    const scope = bindings.get(statement.body)
    if (!scope) continue
    for (const element of statement.parameters[0]!.name.elements) {
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue
      const sourceName = element.propertyName ? propertyName(element.propertyName) : element.name.text
      if (sourceName === null) continue
      const values: StaticAtom[] = []
      let finite = true
      for (const call of calls) {
        const matches = call.attributes.properties.filter((attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(file) === sourceName)
        if (matches.length > 1) { finite = false; break }
        const selected = matches[0]
          ? finiteJsxAttribute(matches[0], context)
          : element.initializer ? staticAtoms(element.initializer, context, new Set()) : null
        const strings = selected && stringAtoms(selected)
        if (!strings) { finite = false; break }
        values.push(...strings)
      }
      const boundedValues = finite ? boundedAtoms(values) : null
      if (boundedValues) scope.set(element.name.text, { declaration: null, kind: 'finite', values: boundedValues })
    }
  }
}
function resolveBinding(identifier: ts.Identifier, context: EvaluationContext): LexicalBinding | null {
  let current: ts.Node | undefined = identifier.parent
  while (current) {
    if (ts.isSourceFile(current) || ts.isBlock(current)) {
      const binding = context.bindings.get(current)?.get(identifier.text)
      if (binding) return binding
    }
    current = current.parent
  }
  return null
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function boundedAtoms(values: readonly StaticAtom[]): StaticAtom[] | null {
  const output: StaticAtom[] = []
  const strings = new Set<string>()
  let hasUndefined = false
  for (const value of values) {
    if (typeof value === 'string') {
      if (value.length > MAX_STATIC_CLASS_VALUE || strings.has(value)) continue
      strings.add(value)
      output.push(value)
    } else if (value === undefined) {
      if (hasUndefined) continue
      hasUndefined = true
      output.push(value)
    } else {
      output.push(value)
    }
    if (output.length > MAX_ALTERNATIVES) return null
  }
  return output
}

function stringAtoms(values: readonly StaticAtom[]): string[] | null {
  if (values.some((value) => typeof value !== 'string')) return null
  return bounded(values as readonly string[])
}

function exportedDeclaration(declaration: ts.VariableDeclaration): boolean {
  const statement = declaration.parent.parent
  return ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
}

function accessRoot(node: ts.Node): ts.Node {
  let current = node
  while (
    (ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
    && current.parent.expression === current
  ) current = current.parent
  return current
}

function assignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
}

function objectBindingIsReadOnly(binding: LexicalBinding, context: EvaluationContext): boolean {
  const declaration = binding.declaration
  if (!declaration || !ts.isIdentifier(declaration.name) || exportedDeclaration(declaration)) return false
  const declarationName = declaration.name
  let safe = true
  const visit = (node: ts.Node): void => {
    if (!safe) return
    if (ts.isIdentifier(node) && node.text === declarationName.text && node !== declarationName && resolveBinding(node, context) === binding) {
      const top = accessRoot(node)
      const parent = top.parent
      if (top === node && ts.isVariableDeclaration(parent) && parent.initializer === top) safe = false
      else if (ts.isBinaryExpression(parent) && parent.left === top && assignmentOperator(parent.operatorToken.kind)) safe = false
      else if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && parent.operand === top) safe = false
      else if (ts.isDeleteExpression(parent) && parent.expression === top) safe = false
      else if ((ts.isCallExpression(parent) || ts.isNewExpression(parent))
        && (parent.expression === top || parent.arguments?.some((argument) => argument === top || (ts.isSpreadElement(argument) && argument.expression === top)))) safe = false
      else if (ts.isReturnStatement(parent) || ts.isSpreadElement(parent) || ts.isExportAssignment(parent)) safe = false
      else if (ts.isShorthandPropertyAssignment(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === top)) safe = false
    }
    ts.forEachChild(node, visit)
  }
  visit(context.file)
  return safe
}

function objectAtoms(expression: ts.ObjectLiteralExpression, context: EvaluationContext, seen: ReadonlySet<LexicalBinding>): StaticAtom[] | null {
  if (expression.properties.length > MAX_OBJECT_PROPERTIES) return null
  const object = new Map<string, readonly StaticAtom[]>()
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return null
    const name = propertyName(property.name)
    if (name === null || object.has(name)) return null
    const value = staticAtoms(property.initializer, context, seen)
    if (!value) return null
    object.set(name, value)
  }
  return [object]
}

function bindingAtoms(binding: LexicalBinding, context: EvaluationContext, seen: ReadonlySet<LexicalBinding>): StaticAtom[] | null {
  if (binding.kind === 'finite') return binding.values ? boundedAtoms(binding.values) : null
  if (binding.kind !== 'const' || !binding.declaration?.initializer || seen.has(binding)) return null
  const nextSeen = new Set(seen)
  nextSeen.add(binding)
  const values = staticAtoms(binding.declaration.initializer, context, nextSeen)
  if (!values) return null
  if (values.some((value) => value instanceof Map) && !objectBindingIsReadOnly(binding, context)) return null
  return values
}

function selectedAtoms(objectValues: readonly StaticAtom[], keys: readonly string[] | null): StaticAtom[] | null {
  const values: StaticAtom[] = []
  for (const objectValue of objectValues) {
    if (!(objectValue instanceof Map)) return null
    if (keys === null) {
      for (const propertyValue of objectValue.values()) values.push(...propertyValue)
      values.push(undefined)
    } else {
      for (const key of keys) values.push(...(objectValue.get(key) ?? [undefined]))
    }
  }
  return boundedAtoms(values)
}

function staticAtoms(expression: ts.Expression, context: EvaluationContext, seen: ReadonlySet<LexicalBinding>): StaticAtom[] | null {
  const current = unwrap(expression)
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return [current.text]
  if (current.kind === ts.SyntaxKind.NullKeyword) return [undefined]
  if (ts.isIdentifier(current)) {
    const binding = resolveBinding(current, context)
    return binding ? bindingAtoms(binding, context, seen) : null
  }
  if (ts.isObjectLiteralExpression(current)) return objectAtoms(current, context, seen)
  if (ts.isConditionalExpression(current)) {
    const whenTrue = staticAtoms(current.whenTrue, context, seen)
    const whenFalse = staticAtoms(current.whenFalse, context, seen)
    return whenTrue && whenFalse ? boundedAtoms([...whenTrue, ...whenFalse]) : null
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = staticAtoms(current.left, context, seen)
    if (!left) return null
    const defined = left.filter((value) => value !== undefined)
    if (defined.length === left.length) return boundedAtoms(defined)
    const right = staticAtoms(current.right, context, seen)
    return right ? boundedAtoms([...defined, ...right]) : null
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticAtoms(current.left, context, seen)
    const right = staticAtoms(current.right, context, seen)
    const leftStrings = left && stringAtoms(left)
    const rightStrings = right && stringAtoms(right)
    return leftStrings && rightStrings ? combine(leftStrings, rightStrings) : null
  }
  if (ts.isTemplateExpression(current)) {
    let values: string[] = [current.head.text]
    for (const span of current.templateSpans) {
      const expressions = staticAtoms(span.expression, context, seen)
      const expressionStrings = expressions && stringAtoms(expressions)
      if (!expressionStrings) return null
      const withExpression = combine(values, expressionStrings)
      if (!withExpression) return null
      const withLiteral = combine(withExpression, [span.literal.text])
      if (!withLiteral) return null
      values = withLiteral
    }
    return boundedAtoms(values)
  }
  if (ts.isPropertyAccessExpression(current) && !current.questionDotToken) {
    const object = staticAtoms(current.expression, context, seen)
    return object ? selectedAtoms(object, [current.name.text]) : null
  }
  if (ts.isElementAccessExpression(current) && !current.questionDotToken && current.argumentExpression) {
    const object = staticAtoms(current.expression, context, seen)
    if (!object) return null
    const keyAtoms = staticAtoms(current.argumentExpression, context, seen)
    const keys = keyAtoms && stringAtoms(keyAtoms)
    return selectedAtoms(object, keys)
  }
  return null
}

function staticStrings(expression: ts.Expression, context: EvaluationContext): string[] | null {
  const values = staticAtoms(expression, context, new Set())
  return values ? stringAtoms(values) : null
}

function attributeName(attribute: ts.JsxAttribute): string {
  return attribute.name.getText()
}

export function analyzeNextSourceStaticClasses(source: string): NextSourceStaticClassAnalysis {
  const file = ts.createSourceFile('next-source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) {
    const dynamicOffsets = [...source.matchAll(/(?:className|class)\s*=\s*\{?\s*`[^`]*\$\{/g)].map((match) => match.index)
    return Object.freeze({ staticClassNames: Object.freeze([]), dynamicOffsets: Object.freeze(dynamicOffsets) })
  }

  const bindings = collectBindings(file)
  collectFiniteLocalComponentProps(file, bindings, source)
  const context: EvaluationContext = { bindings, file, source }
  const names = new Set<string>()
  const dynamicOffsets: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && (attributeName(node) === 'className' || attributeName(node) === 'class')) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        for (const name of classTokens(node.initializer.text)) names.add(name)
      } else if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const expression = unwrap(node.initializer.expression)
        const values = staticStrings(expression, context)
        if (values) {
          for (const value of values) for (const name of classTokens(value)) names.add(name)
        } else if (ts.isTemplateExpression(expression)) {
          dynamicOffsets.push(node.getStart(file))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return Object.freeze({
    staticClassNames: Object.freeze([...names].sort()),
    dynamicOffsets: Object.freeze([...new Set(dynamicOffsets)].sort((left, right) => left - right)),
  })
}
