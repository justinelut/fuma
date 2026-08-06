/**
 * Constrained expression model for the React IR.
 *
 * The legacy node model stores props as `Record<string, unknown>`, which cannot
 * tell a literal string from an identifier, a member expression, a template
 * literal, a conditional or a callback. Generating TSX from that is guesswork,
 * and reading TSX back into it is impossible: `"user.name"` could be text or a
 * property access and nothing in the data says which.
 *
 * So expressions are explicit and deliberately small. Every form here can be
 * round-tripped: emitted as TSX, parsed back, and compared for equality. Anything
 * outside this set is not silently approximated — it becomes an opaque code node,
 * which the builder renders and moves but never claims to understand.
 *
 * What is excluded, and why:
 *
 *   - arbitrary function calls: their result cannot be previewed without running
 *     them, and their arguments can be anything
 *   - assignments and mutation: an IR node is a value, not a statement
 *   - loops and control flow beyond a finite conditional: repetition is a
 *     `RepeatNode`, which carries its data source explicitly
 *   - spreads: they hide which props exist, so the property panel cannot show a
 *     truthful surface
 *
 * Those exclusions are what make the visual surface honest about what it can edit.
 */

import { Type, withFallback, type Static } from '@core/utils/typeboxHelpers'

/**
 * Scopes a member expression may read from.
 *
 * A closed set, because each one has to be resolvable at generation time to
 * either a loader variable, a component prop or a route value. An open set would
 * let an expression reference something that does not exist at the point the
 * generated component runs.
 */
export const ExpressionScopeSchema = Type.Union([
  /** The row a repeat is currently iterating. */
  Type.Literal('item'),
  /** The row an enclosing repeat is iterating, for nested repetition. */
  Type.Literal('parentItem'),
  /** The entry a template renders against. */
  Type.Literal('entry'),
  /** Page-level fields: title, slug, description. */
  Type.Literal('page'),
  /** Site-level fields: name, locale, base URL. */
  Type.Literal('site'),
  /** Route values: path params and query. */
  Type.Literal('route'),
  /** A prop declared by the component this node lives in. */
  Type.Literal('prop'),
])
export type ExpressionScope = Static<typeof ExpressionScopeSchema>

/**
 * A dotted path segment list, e.g. `['author', 'name']`.
 *
 * Stored as segments rather than a dotted string so a field whose name contains
 * a dot cannot silently change meaning, and so codegen never has to re-parse.
 */
export const MemberPathSchema = Type.Array(
  Type.String({ minLength: 1, maxLength: 128 }),
  { minItems: 1, maxItems: 8 },
)
export type MemberPath = Static<typeof MemberPathSchema>

/** How a resolved value is rendered when it reaches the page. */
export const ExpressionFormatSchema = Type.Union([
  /** Escaped text. The default, and the only safe one for untrusted values. */
  Type.Literal('text'),
  /** Pre-sanitised rich text, rendered as markup. */
  Type.Literal('html'),
  /** Validated URL, for href and src. */
  Type.Literal('url'),
  /** A media reference resolved through the media pipeline. */
  Type.Literal('media'),
  /** A date formatted for display. */
  Type.Literal('date'),
  /** A number formatted for display. */
  Type.Literal('number'),
])
export type ExpressionFormat = Static<typeof ExpressionFormatSchema>

const LiteralExpressionSchema = Type.Object({
  kind: Type.Literal('literal'),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
}, { additionalProperties: false })

const MemberExpressionSchema = Type.Object({
  kind: Type.Literal('member'),
  scope: ExpressionScopeSchema,
  path: MemberPathSchema,
  format: withFallback(ExpressionFormatSchema, 'text'),
  /**
   * Rendered when the resolved value is null, undefined or empty. Kept as a
   * literal rather than an arbitrary expression so a fallback can never itself
   * fail to resolve.
   */
  fallback: Type.Optional(Type.Union([Type.String(), Type.Null()])),
}, { additionalProperties: false })

/**
 * A finite conditional. Both branches are complete expressions, which is what
 * makes the outcome enumerable: the builder can show every value this can
 * produce, and Tailwind can see every class string it might emit.
 */
const ConditionalExpressionSchema = Type.Recursive((Self) => Type.Object({
  kind: Type.Literal('conditional'),
  test: Type.Object({
    scope: ExpressionScopeSchema,
    path: MemberPathSchema,
    /** Comparison against a literal. Absent means a truthiness test. */
    operator: Type.Optional(Type.Union([
      Type.Literal('equals'),
      Type.Literal('notEquals'),
      Type.Literal('exists'),
      Type.Literal('empty'),
    ])),
    value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
  }, { additionalProperties: false }),
  whenTrue: Self,
  whenFalse: Self,
}, { additionalProperties: false }))

/**
 * A template literal built from alternating text and interpolated parts.
 *
 * Bounded on purpose. An unbounded template is where dynamic Tailwind classes
 * come from, and Tailwind's scanner cannot see a class name that is assembled at
 * runtime — the existing importer already rejects those with a
 * `dynamic-tailwind-denied` diagnostic and tells the author to use a finite map
 * of complete class strings instead. Keeping templates small keeps that promise
 * enforceable rather than aspirational.
 */
const TemplateExpressionSchema = Type.Object({
  kind: Type.Literal('template'),
  /** Literal text segments; always one more than `parts`. */
  quasis: Type.Array(Type.String({ maxLength: 512 }), { minItems: 2, maxItems: 9 }),
  parts: Type.Array(MemberExpressionSchema, { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false })

/**
 * The expression union.
 *
 * Recursive through the conditional branches, so `Type.Recursive` wraps the whole
 * union rather than the conditional alone — otherwise a branch could not itself
 * be a conditional and chained cases would be unrepresentable.
 */
export const ExpressionSchema = Type.Recursive((Self) => Type.Union([
  LiteralExpressionSchema,
  MemberExpressionSchema,
  TemplateExpressionSchema,
  Type.Object({
    kind: Type.Literal('conditional'),
    test: Type.Object({
      scope: ExpressionScopeSchema,
      path: MemberPathSchema,
      operator: Type.Optional(Type.Union([
        Type.Literal('equals'),
        Type.Literal('notEquals'),
        Type.Literal('exists'),
        Type.Literal('empty'),
      ])),
      value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
    }, { additionalProperties: false }),
    whenTrue: Self,
    whenFalse: Self,
  }, { additionalProperties: false }),
]))
export type Expression = Static<typeof ExpressionSchema>

export type LiteralExpression = Static<typeof LiteralExpressionSchema>
export type MemberExpression = Static<typeof MemberExpressionSchema>
export type TemplateExpression = Static<typeof TemplateExpressionSchema>
export type ConditionalExpression = Static<typeof ConditionalExpressionSchema>

/** Narrow to a literal without a cast. */
export function isLiteralExpression(expression: Expression): expression is LiteralExpression {
  return expression.kind === 'literal'
}

export function isMemberExpression(expression: Expression): expression is MemberExpression {
  return expression.kind === 'member'
}

export function isTemplateExpression(expression: Expression): expression is TemplateExpression {
  return expression.kind === 'template'
}

export function isConditionalExpression(
  expression: Expression,
): expression is ConditionalExpression {
  return expression.kind === 'conditional'
}

/**
 * Every value an expression can produce, when that set is finite.
 *
 * Returns null when the set is open — any member expression reads data unknown at
 * build time. Callers use this to decide whether something is safe to treat as a
 * complete Tailwind class string, and the null case is what must be refused
 * rather than guessed at.
 */
export function enumerateLiteralOutcomes(expression: Expression): readonly string[] | null {
  if (isLiteralExpression(expression)) {
    return expression.value === null ? [] : [String(expression.value)]
  }
  if (isConditionalExpression(expression)) {
    const whenTrue = enumerateLiteralOutcomes(expression.whenTrue)
    const whenFalse = enumerateLiteralOutcomes(expression.whenFalse)
    if (whenTrue === null || whenFalse === null) return null
    return [...whenTrue, ...whenFalse]
  }
  // A member read resolves at runtime, and a template contains at least one.
  return null
}

/** Convenience: does this expression resolve to a knowable, finite value set? */
export function isStaticallyEnumerable(expression: Expression): boolean {
  return enumerateLiteralOutcomes(expression) !== null
}
