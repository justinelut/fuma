/**
 * Promote a catalog component into the code-component pipeline.
 *
 * The catalog stores components and records the prop values each insertion passed, but it
 * declares **no prop surface at all** — `props` is `Record<string, Unknown>`. Two consequences
 * follow, and both are silent:
 *
 *   - The canvas cannot render a properties panel for a catalog component, because nothing
 *     says what its props are or how to edit them.
 *   - An insertion can pass any prop with any value. A misspelled prop name is stored, the
 *     component renders without it, and the designer sees an element missing its text with
 *     nothing anywhere reporting a problem.
 *
 * The fix is to derive `ControlDeclaration` from the component's own source rather than
 * storing a second copy. **Derived, not stored, deliberately:** a stored copy is a duplicate
 * of the truth, and it drifts the moment somebody edits the component — at which point the
 * panel offers a prop the component no longer takes, which is worse than offering nothing.
 * Deriving also means no migration: the source is already persisted.
 */

import ts from 'typescript'
import {
  validateProps,
  type ControlDeclaration,
  type PropertyControl,
  type PropProblem,
} from './propertyControls'

export type DerivationNote = Readonly<{
  code: 'no-props-interface' | 'unsupported-type' | 'no-component-found'
  /** Prop the note concerns, when it concerns one. */
  prop: string | null
  message: string
}>

export type DerivedControls = Readonly<{
  declaration: ControlDeclaration
  /**
   * What could not be derived.
   *
   * A prop whose type the control model cannot express is reported rather than guessed: a
   * control of the wrong kind is an editor that writes values the component will not accept,
   * which is worse than the prop being absent from the panel.
   */
  notes: readonly DerivationNote[]
}>

/**
 * Map a TypeScript type to a control kind.
 *
 * Returns null when the model has no honest equivalent. Guessing `string` for an unknown type
 * would produce a text box that writes a value the component rejects.
 */
function controlKindForType(node: ts.TypeNode): PropertyControl['kind'] | null {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return 'string'
    case ts.SyntaxKind.NumberKeyword: return 'number'
    case ts.SyntaxKind.BooleanKeyword: return 'boolean'
    default: break
  }

  // `ReactNode` is the slot shape, which the model calls a node control.
  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : null
    if (name === 'ReactNode' || name === 'ReactElement') return 'node'
    return null
  }

  // A union of string literals is an enum: exactly the case a select control exists for.
  if (ts.isUnionTypeNode(node) && node.types.every(isStringLiteralType)) return 'enum'

  if (ts.isArrayTypeNode(node)) return 'array'

  return null
}

function isStringLiteralType(node: ts.TypeNode): boolean {
  return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
}

function enumOptionsOf(node: ts.TypeNode): readonly string[] {
  if (!ts.isUnionTypeNode(node)) return []
  return Object.freeze(node.types
    .filter(isStringLiteralType)
    .map((member) => ((member as ts.LiteralTypeNode).literal as ts.StringLiteral).text))
}

/**
 * Derive property controls from a component's source.
 *
 * Reads the props interface the component declares. A prop is optional in the interface
 * exactly when it is not required in the panel, so the two cannot disagree — which they would
 * if requiredness were recorded separately.
 */
export function deriveControls(
  componentId: string,
  source: string,
): DerivedControls {
  const parsed = ts.createSourceFile(
    `${componentId}.tsx`, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX,
  )

  const notes: DerivationNote[] = []
  const controls: Record<string, PropertyControl> = {}

  const propsInterface = findPropsInterface(parsed)
  if (!propsInterface) {
    notes.push(Object.freeze({
      code: 'no-props-interface',
      prop: null,
      message:
        `${componentId} declares no props interface, so the canvas has nothing to offer. A `
        + 'component with no props is legitimate; one that takes props without declaring them '
        + 'cannot be edited visually.',
    }))
    return Object.freeze({
      declaration: Object.freeze({ componentId, controls: Object.freeze({}) }),
      notes: Object.freeze(notes),
    })
  }

  for (const member of propsInterface.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue
    const name = ts.isIdentifier(member.name) ? member.name.text
      : ts.isStringLiteral(member.name) ? member.name.text
        : null
    if (name === null) continue

    // ARRAYS ARE DELIBERATELY NOT DERIVED, and this is a limitation of the control model
    // rather than an oversight. An array control references its item control by id, and every
    // declared control IS a prop as far as the model is concerned — `propsInterfaceSourceOf`
    // emits one interface member per control and `validateProps` demands a value for each
    // required one. So declaring the companion item control would put a prop on the interface
    // that the component does not take, and demand a value for it at insertion. There is no
    // flag for "declared but not a prop", so the honest move is to report the gap.
    if (ts.isArrayTypeNode(member.type)) {
      notes.push(Object.freeze({
        code: 'unsupported-type',
        prop: name,
        message:
          `"${name}" is an array. The control model expresses a list through a companion item `
          + 'control, and every declared control is treated as a prop — so declaring it would add '
          + 'a prop the component does not take. Left out until the model can mark a control as '
          + 'internal.',
      }))
      continue
    }

    const kind = controlKindForType(member.type)
    if (kind === null) {
      notes.push(Object.freeze({
        code: 'unsupported-type',
        prop: name,
        message:
          `"${name}" has a type the control model cannot express, so it is left out of the panel `
          + 'rather than given a control of the wrong kind. An editor that writes a value the '
          + 'component rejects is worse than the prop being absent.',
      }))
      continue
    }

    // A prop optional in the interface is not required in the panel. Deriving it from the same
    // place means the panel and the signature cannot disagree.
    const required = member.questionToken === undefined

    controls[name] = buildControl(kind, name, required, member.type)
  }

  return Object.freeze({
    declaration: Object.freeze({ componentId, controls: Object.freeze(controls) }),
    notes: Object.freeze(notes),
  })
}

function buildControl(
  kind: PropertyControl['kind'],
  name: string,
  required: boolean,
  type: ts.TypeNode,
): PropertyControl {
  const title = humanise(name)

  if (kind === 'enum') {
    const options = enumOptionsOf(type)
    return Object.freeze({
      kind: 'enum',
      title,
      required,
      options: Object.freeze([...options]),
      // Titles deliberately omitted rather than invented: a generated label that differs from
      // the value is a label nobody chose, and the raw value at least matches the code.
    }) as PropertyControl
  }

  return Object.freeze({ kind, title, required }) as PropertyControl
}

/**
 * A readable label from a prop name.
 *
 * `ctaLabel` becomes "Cta label" rather than being shown as written, because a panel full of
 * camelCase reads as a debug view rather than an interface.
 */
export function humanise(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/** The props interface a component declares, or null. */
function findPropsInterface(source: ts.SourceFile): ts.InterfaceDeclaration | null {
  const interfaces = source.statements.filter(ts.isInterfaceDeclaration)
  // Prefer one named `<Something>Props`, which is the convention the generator emits, and fall
  // back to a single declared interface rather than guessing among several.
  return interfaces.find((declaration) => declaration.name.text.endsWith('Props'))
    ?? (interfaces.length === 1 ? interfaces[0] ?? null : null)
}

export type InsertionCheck = Readonly<{
  accepted: boolean
  problems: readonly PropProblem[]
}>

/**
 * Check the prop values an insertion passes against the component's declared controls.
 *
 * This is the half the catalog was missing. Without it a misspelled prop name is stored, the
 * component renders without it, and the designer sees an element missing its text with nothing
 * reporting a problem.
 */
export function checkInsertionProps(
  declaration: ControlDeclaration,
  props: Readonly<Record<string, unknown>>,
): InsertionCheck {
  const problems = validateProps(declaration, props)
  return Object.freeze({ accepted: problems.length === 0, problems })
}

/**
 * Whether a component can be edited on the canvas at all.
 *
 * A component with no derivable controls is still installable and still renders — it simply
 * has nothing to configure. Reported so the interface can say that rather than showing an
 * empty panel that looks broken.
 */
export function isVisuallyEditable(derived: DerivedControls): boolean {
  return Object.keys(derived.declaration.controls).length > 0
}
