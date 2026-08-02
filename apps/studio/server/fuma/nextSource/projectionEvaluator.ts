import * as ts from 'typescript'
import {
  MAX_STATIC_COLLECTION_ITEMS,
  canonical,
  fail,
  isStaticObject,
  sourceText,
  type ProjectionContext,
  type StaticValue,
} from './projectionShared'

const MAX_STATIC_JSON_DEPTH = 32
const MAX_STATIC_JSON_VALUES = 10_000
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function staticBindingValues(
  name: ts.BindingName,
  value: StaticValue,
  context: ProjectionContext,
  label: string,
): ReadonlyMap<string, StaticValue> {
  if (ts.isIdentifier(name)) return new Map([[name.text, value]])
  const bindings = new Map<string, StaticValue>()
  const bind = (bindingName: string, nested: StaticValue): void => {
    if (bindings.has(bindingName)) fail(`${label} repeats binding ${bindingName}.`, context)
    bindings.set(bindingName, nested)
  }
  if (ts.isObjectBindingPattern(name)) {
    if (!isStaticObject(value)) fail(`${label} object destructuring requires one object value.`, context)
    for (const element of name.elements) {
      if (element.dotDotDotToken || element.initializer || !ts.isIdentifier(element.name) || (element.propertyName && !ts.isIdentifier(element.propertyName) && !ts.isStringLiteralLike(element.propertyName))) {
        fail(`${label} object destructuring must be flat and explicit.`, context)
      }
      const key = element.propertyName?.text ?? element.name.text
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label} value is missing property ${key}.`, context)
      bind(element.name.text, value[key]!)
    }
    return bindings
  }
  if (!Array.isArray(value)) fail(`${label} tuple destructuring requires one bounded array value.`, context)
  for (const [index, element] of name.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken || element.initializer || element.propertyName || !ts.isIdentifier(element.name)) {
      fail(`${label} tuple destructuring must be flat, contiguous, and explicit.`, context)
    }
    if (index >= value.length) fail(`${label} tuple is missing index ${index}.`, context)
    bind(element.name.text, value[index]!)
  }
  return bindings
}

export function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression
  return current
}

export function staticValue(expression: ts.Expression, context: ProjectionContext): StaticValue {
  const value = unwrap(expression)
  if (ts.isStringLiteralLike(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false
  if (value.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isIdentifier(value) && context.bindings.has(value.text)) return context.bindings.get(value.text)!
  if (ts.isArrayLiteralExpression(value)) {
    if (value.elements.length > MAX_STATIC_COLLECTION_ITEMS) fail('Static collections exceed the bounded projection item limit.', context)
    return Object.freeze(value.elements.map((element) => {
      if (ts.isSpreadElement(element)) fail('Static collections cannot use spread elements.', context)
      return staticValue(element, context)
    }))
  }
  if (ts.isObjectLiteralExpression(value)) {
    if (value.properties.length > MAX_STATIC_COLLECTION_ITEMS) fail('Static objects exceed the bounded projection property limit.', context)
    const output: Record<string, StaticValue> = {}
    for (const property of value.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        output[property.name.text] = staticValue(property.name, context)
        continue
      }
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) fail('Static objects cannot use spreads, methods, accessors, or computed keys.', context)
      const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : fail('Static object property name is unsupported.', context)
      if (FORBIDDEN_OBJECT_KEYS.has(key)) fail(`Static object property ${key} is forbidden.`, context)
      if (Object.prototype.hasOwnProperty.call(output, key)) fail(`Static object repeats property ${key}.`, context)
      output[key] = staticValue(property.initializer, context)
    }
    return Object.freeze(output)
  }
  if (ts.isPropertyAccessExpression(value)) {
    const owner = staticValue(value.expression, context)
    if (Array.isArray(owner) && value.name.text === 'length') return owner.length
    if (!isStaticObject(owner) || !Object.prototype.hasOwnProperty.call(owner, value.name.text)) fail(`Static property ${value.name.text} is unavailable.`, context)
    return owner[value.name.text]!
  }
  if (ts.isElementAccessExpression(value) && value.argumentExpression) {
    const owner = staticValue(value.expression, context)
    const key = staticValue(value.argumentExpression, context)
    if (Array.isArray(owner) && typeof key === 'number' && Number.isSafeInteger(key) && key >= 0 && key < owner.length) return owner[key]!
    if (isStaticObject(owner) && (typeof key === 'string' || typeof key === 'number')) {
      const property = String(key)
      if (Object.prototype.hasOwnProperty.call(owner, property)) return owner[property]!
    }
    fail('Static element access is unavailable or out of bounds.', context)
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    const method = value.expression.name.text
    if (ts.isIdentifier(value.expression.expression) && value.expression.expression.text === 'Object' && !context.bindings.has('Object') && (method === 'keys' || method === 'values' || method === 'entries')) {
      if (value.arguments.length !== 1) fail(`Static Object.${method} accepts exactly one bounded object.`, context)
      const owner = staticValue(value.arguments[0]!, context)
      if (!isStaticObject(owner)) fail(`Static Object.${method} requires one bounded object.`, context)
      const entries = Object.entries(owner)
      if (method === 'keys') return Object.freeze(entries.map(([key]) => key))
      if (method === 'values') return Object.freeze(entries.map(([, nested]) => nested))
      return Object.freeze(entries.map(([key, nested]) => Object.freeze([key, nested])))
    }
    if (method === 'trim' || method === 'trimStart' || method === 'trimEnd' || method === 'toLowerCase' || method === 'toUpperCase') {
      const owner = staticValue(value.expression.expression, context)
      if (typeof owner !== 'string' || value.arguments.length !== 0) fail(`Static ${method} requires one bounded string and no arguments.`, context)
      const result = method === 'trim' ? owner.trim()
        : method === 'trimStart' ? owner.trimStart()
          : method === 'trimEnd' ? owner.trimEnd()
            : method === 'toLowerCase' ? owner.toLowerCase()
              : owner.toUpperCase()
      if (result.length > 100_000) fail('Static string operation exceeds the bounded output limit.', context)
      return result
    }
    if (method === 'startsWith' || method === 'endsWith' || method === 'includes' || method === 'indexOf' || method === 'lastIndexOf') {
      const owner = staticValue(value.expression.expression, context)
      if (typeof owner === 'string') {
        if (value.arguments.length < 1 || value.arguments.length > 2) fail(`Static string ${method} accepts one string and an optional safe integer position.`, context)
        const search = staticValue(value.arguments[0]!, context)
        if (typeof search !== 'string') fail(`Static string ${method} search value must be a string literal.`, context)
        const position = value.arguments[1] === undefined ? undefined : staticValue(value.arguments[1], context)
        if (position !== undefined && (typeof position !== 'number' || !Number.isSafeInteger(position))) fail(`Static string ${method} position must be a safe integer.`, context)
        if (method === 'startsWith') return position === undefined ? owner.startsWith(search) : owner.startsWith(search, position)
        if (method === 'endsWith') return position === undefined ? owner.endsWith(search) : owner.endsWith(search, position)
        if (method === 'includes') return position === undefined ? owner.includes(search) : owner.includes(search, position)
        if (method === 'indexOf') return position === undefined ? owner.indexOf(search) : owner.indexOf(search, position)
        return position === undefined ? owner.lastIndexOf(search) : owner.lastIndexOf(search, position)
      }
      if (!Array.isArray(owner) || method === 'startsWith' || method === 'endsWith') fail(`Static ${method} requires one bounded scalar string or array.`, context)
      if (value.arguments.length < 1 || value.arguments.length > 2) fail(`Static ${method} accepts a scalar needle and optional safe integer start index.`, context)
      const needle = staticValue(value.arguments[0]!, context)
      if (needle !== null && typeof needle === 'object') fail(`Static ${method} accepts only a scalar needle.`, context)
      const start = value.arguments[1] === undefined ? undefined : staticValue(value.arguments[1], context)
      if (start !== undefined && (typeof start !== 'number' || !Number.isSafeInteger(start))) fail(`Static ${method} start index must be a safe integer.`, context)
      if (method === 'includes') return start === undefined ? owner.includes(needle) : owner.includes(needle, start)
      if (method === 'indexOf') return start === undefined ? owner.indexOf(needle) : owner.indexOf(needle, start)
      return start === undefined ? owner.lastIndexOf(needle) : owner.lastIndexOf(needle, start)
    }
    if (method === 'at') {
      const owner = staticValue(value.expression.expression, context)
      if ((!Array.isArray(owner) && typeof owner !== 'string') || value.arguments.length !== 1) fail('Static at accepts one bounded string or array and exactly one safe integer index.', context)
      const index = staticValue(value.arguments[0]!, context)
      if (typeof index !== 'number' || !Number.isSafeInteger(index)) fail('Static at index must be a safe integer.', context)
      return owner.at(index) ?? null
    }
    if (method === 'split') {
      const owner = staticValue(value.expression.expression, context)
      if (typeof owner !== 'string' || value.arguments.length < 1 || value.arguments.length > 2) fail('Static split requires one bounded string, one string separator, and an optional bounded limit.', context)
      if (ts.isRegularExpressionLiteral(unwrap(value.arguments[0]!))) fail('Static split separator must be a string literal, never a regular expression.', context)
      const separator = staticValue(value.arguments[0]!, context)
      if (typeof separator !== 'string') fail('Static split separator must be a string literal, never a regular expression.', context)
      const limit = value.arguments[1] === undefined ? undefined : staticValue(value.arguments[1], context)
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_STATIC_COLLECTION_ITEMS)) {
        fail('Static split limit must be a non-negative safe integer within the collection bound.', context)
      }
      const result = owner.split(separator, limit)
      if (result.length > MAX_STATIC_COLLECTION_ITEMS) fail('Static split exceeds the bounded projection item limit.', context)
      return Object.freeze(result)
    }
    if (method === 'join') {
      const owner = staticValue(value.expression.expression, context)
      if (!Array.isArray(owner) || value.arguments.length > 1) fail('Static join requires one bounded scalar array and at most one string separator.', context)
      const separator = value.arguments[0] === undefined ? ',' : staticValue(value.arguments[0], context)
      if (typeof separator !== 'string') fail('Static join separator must be a string literal.', context)
      if (owner.some((item) => item !== null && typeof item === 'object')) fail('Static join accepts only scalar array values.', context)
      const result = owner.map((item) => item === null ? '' : String(item)).join(separator)
      if (result.length > 100_000) fail('Static string operation exceeds the bounded output limit.', context)
      return result
    }
    if (method === 'filter' || method === 'find' || method === 'some' || method === 'every') {
      const owner = staticValue(value.expression.expression, context)
      if (!Array.isArray(owner)) fail(`Static ${method} requires one bounded array.`, context)
      if (value.arguments.length !== 1) fail(`Static ${method} accepts exactly one inline predicate.`, context)
      const callback = unwrap(value.arguments[0]!)
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) fail('Static collection predicates must be inline functions.', context)
      if (callback.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword) || (ts.isFunctionExpression(callback) && callback.asteriskToken)) {
        fail('Static collection predicates cannot be async or generators.', context)
      }
      if (callback.parameters.length < 1 || callback.parameters.length > 2) fail('Static collection predicates accept item and optional index parameters only.', context)
      const callbackExpression = (() => {
        if (!ts.isBlock(callback.body)) return unwrap(callback.body)
        const statements = callback.body.statements.filter((statement) => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))
        if (statements.length !== 1 || !ts.isReturnStatement(statements[0]) || !statements[0].expression) fail('Static collection predicates must contain one unconditional return.', context)
        return unwrap(statements[0].expression)
      })()
      const matches = (item: StaticValue, index: number): boolean => {
        const bindings = new Map(context.bindings)
        const localNames = new Set<string>()
        const bind = (name: string, nested: StaticValue): void => {
          if (localNames.has(name)) fail(`Static collection predicate repeats binding ${name}.`, context)
          localNames.add(name)
          bindings.set(name, nested)
        }
        const parameter = callback.parameters[0]!
        if (parameter.dotDotDotToken || parameter.initializer) fail('Static collection predicate item bindings cannot use rest or defaults.', context)
        for (const [name, nested] of staticBindingValues(parameter.name, item, context, 'Static collection predicate')) bind(name, nested)
        const indexParameter = callback.parameters[1]
        if (indexParameter) {
          if (indexParameter.dotDotDotToken || indexParameter.initializer || !ts.isIdentifier(indexParameter.name)) fail('Static collection predicate index binding must be one identifier.', context)
          bind(indexParameter.name.text, index)
        }
        const result = staticValue(callbackExpression, { ...context, bindings })
        if (typeof result !== 'boolean') fail('Static collection predicates must resolve to booleans.', context)
        return result
      }
      if (method === 'filter') return Object.freeze(owner.filter(matches))
      if (method === 'find') return owner.find(matches) ?? null
      if (method === 'some') return owner.some(matches)
      return owner.every(matches)
    }
    if (method === 'slice') {
      const owner = staticValue(value.expression.expression, context)
      if ((!Array.isArray(owner) && typeof owner !== 'string') || value.arguments.length > 2) fail('Static slice requires one bounded string or array and at most two indexes.', context)
      const indexes = value.arguments.map((argument) => staticValue(argument, context))
      if (indexes.some((index) => typeof index !== 'number' || !Number.isSafeInteger(index))) fail('Static slice indexes must be safe integers.', context)
      const result = owner.slice(indexes[0] as number | undefined, indexes[1] as number | undefined)
      if (typeof result === 'string') {
        if (result.length > 100_000) fail('Static string operation exceeds the bounded output limit.', context)
        return result
      }
      return Object.freeze(result)
    }
  }
  if (ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isTemplateExpression(value)) {
    let output = value.head.text
    for (const span of value.templateSpans) {
      const nested = staticValue(span.expression, context)
      if (nested !== null && typeof nested === 'object') fail('Template substitutions must resolve to scalar values.', context)
      output += `${nested ?? ''}${span.literal.text}`
    }
    return output
  }
  if (ts.isConditionalExpression(value)) return staticValue(value.condition, context) ? staticValue(value.whenTrue, context) : staticValue(value.whenFalse, context)
  if (ts.isPrefixUnaryExpression(value)) {
    const operand = staticValue(value.operand, context)
    if (value.operator === ts.SyntaxKind.ExclamationToken) return !operand
    if (value.operator === ts.SyntaxKind.PlusToken && typeof operand === 'number') return operand
    if (value.operator === ts.SyntaxKind.MinusToken && typeof operand === 'number') return -operand
  }
  if (ts.isBinaryExpression(value)) {
    const left = staticValue(value.left, context)
    if (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return left ? staticValue(value.right, context) : left
    if (value.operatorToken.kind === ts.SyntaxKind.BarBarToken) return left || staticValue(value.right, context)
    if (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return left ?? staticValue(value.right, context)
    const right = staticValue(value.right, context)
    if (value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (typeof left === 'number' && typeof right === 'number') return left + right
      if ((left === null || typeof left !== 'object') && (right === null || typeof right !== 'object')) return `${left ?? ''}${right ?? ''}`
    }
    if (value.operatorToken.kind === ts.SyntaxKind.MinusToken && typeof left === 'number' && typeof right === 'number') return left - right
    if (value.operatorToken.kind === ts.SyntaxKind.AsteriskToken && typeof left === 'number' && typeof right === 'number') return left * right
    if (value.operatorToken.kind === ts.SyntaxKind.SlashToken && typeof left === 'number' && typeof right === 'number' && right !== 0) return left / right
    if (value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return canonical(left) === canonical(right)
    if (value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) return canonical(left) !== canonical(right)
    if (value.operatorToken.kind === ts.SyntaxKind.LessThanToken) {
      if (typeof left === 'number' && typeof right === 'number') return left < right
      if (typeof left === 'string' && typeof right === 'string') return left < right
    }
    if (value.operatorToken.kind === ts.SyntaxKind.GreaterThanToken) {
      if (typeof left === 'number' && typeof right === 'number') return left > right
      if (typeof left === 'string' && typeof right === 'string') return left > right
    }
  }
  fail('JSX values must resolve to bounded static literals through the non-executing evaluator.', context)
}

export function literal(expression: ts.Expression, context: ProjectionContext): string | number | boolean | null {
  const value = staticValue(expression, context)
  if (value !== null && typeof value === 'object') fail('JSX attributes and text expressions must resolve to bounded scalar literals.', context)
  return value
}

function checkedJsonValue(value: unknown, context: ProjectionContext, state: { count: number }, depth = 0): StaticValue {
  state.count += 1
  if (state.count > MAX_STATIC_JSON_VALUES || depth > MAX_STATIC_JSON_DEPTH) fail('Imported JSON exceeds the bounded static data limit.', context)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Imported JSON numbers must be finite.', context)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STATIC_COLLECTION_ITEMS) fail('Imported JSON arrays exceed the bounded item limit.', context)
    return Object.freeze(value.map((item) => checkedJsonValue(item, context, state, depth + 1)))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length > MAX_STATIC_COLLECTION_ITEMS) fail('Imported JSON objects exceed the bounded property limit.', context)
    const output: Record<string, StaticValue> = {}
    for (const [key, nested] of entries) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) fail(`Imported JSON property ${key} is forbidden.`, context)
      output[key] = checkedJsonValue(nested, context, state, depth + 1)
    }
    return Object.freeze(output)
  }
  fail('Imported JSON contains a non-data value.', context)
}

function mutableBindings(context: ProjectionContext): Map<string, StaticValue> {
  if (context.bindings instanceof Map) return context.bindings
  const bindings = new Map(context.bindings)
  context.bindings = bindings
  return bindings
}

function bindImportedJson(context: ProjectionContext): void {
  const module = context.moduleByPath.get(context.sourcePath)
  for (const statement of context.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifierText = statement.moduleSpecifier.text
    const imported = module?.imports.find(({ specifier, resolvedPath, kind }) => specifier === specifierText && resolvedPath?.endsWith('.json') && kind !== 'type-static' && kind !== 'type-reexport')
    if (!imported?.resolvedPath) continue
    const clause = statement.importClause
    if (!clause?.name || clause.isTypeOnly || clause.namedBindings) fail('Static JSON data requires one default import.', context)
    const importName = clause.name.text
    const bindings = mutableBindings(context)
    if (bindings.has(importName)) fail(`Static data import redeclares ${importName}.`, context)
    let parsed: unknown
    try { parsed = JSON.parse(sourceText(context.files, imported.resolvedPath)) } catch { fail('Imported JSON must be valid immutable data.', context) }
    bindings.set(importName, checkedJsonValue(parsed, context, { count: 0 }))
  }
}

function bindStaticDeclaration(declaration: ts.VariableDeclaration, context: ProjectionContext): void {
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer || declaration.exclamationToken) fail('Projected local data declarations must be initialized identifiers.', context)
  const bindings = mutableBindings(context)
  if (bindings.has(declaration.name.text)) fail(`Projected local data redeclares ${declaration.name.text}.`, context)
  bindings.set(declaration.name.text, staticValue(declaration.initializer, context))
}

function bindStaticVariableStatement(statement: ts.VariableStatement, context: ProjectionContext): void {
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) fail('Projected local data declarations must use const.', context)
  for (const declaration of statement.declarationList.declarations) bindStaticDeclaration(declaration, context)
}

export function prepareSourceStaticBindings(context: ProjectionContext): void {
  bindImportedJson(context)
  for (const statement of context.sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      const initializer = unwrap(declaration.initializer)
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) continue
      bindStaticDeclaration(declaration, context)
    }
  }
}

export function returnExpression(node: ts.FunctionLikeDeclaration, context: ProjectionContext): ts.Expression {
  if (!node.body) fail('Default page component has no body.', context)
  if (!ts.isBlock(node.body)) return unwrap(node.body)
  const meaningful = node.body.statements.filter((statement) => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))
  const returns = meaningful.filter((statement): statement is ts.ReturnStatement => ts.isReturnStatement(statement))
  if (returns.length !== 1 || returns[0] !== meaningful.at(-1) || !returns[0].expression) fail('Default page component must contain immutable local data followed by one unconditional JSX return.', context)
  for (const statement of meaningful.slice(0, -1)) {
    if (!ts.isVariableStatement(statement)) fail('Default page component may contain only immutable local data before its return.', context)
    bindStaticVariableStatement(statement, context)
  }
  return unwrap(returns[0].expression)
}

export function defaultPageExpression(sourceFile: ts.SourceFile, context: ProjectionContext): ts.Expression {
  prepareSourceStaticBindings(context)
  const declarations = new Map<string, ts.FunctionLikeDeclaration>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const initializer = unwrap(declaration.initializer)
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) declarations.set(declaration.name.text, initializer)
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) return returnExpression(statement, context)
  }
  const assignment = sourceFile.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals)
  if (!assignment) fail('Route must have one static default page component export.', context)
  const expression = unwrap(assignment.expression)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return returnExpression(expression, context)
  if (ts.isIdentifier(expression)) {
    const declaration = declarations.get(expression.text)
    if (!declaration) fail('Default page component declaration is unavailable.', context)
    return returnExpression(declaration, context)
  }
  fail('Default export must be a static function or function identifier.', context)
}
