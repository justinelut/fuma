/**
 * Typed property controls for code components.
 *
 * This is the contract that makes a hand-written component editable on the canvas.
 * A component declares what its props *are* — not merely their TypeScript types but
 * how they should be edited — and the properties panel builds itself from that
 * declaration. Without it a code component is a black box: the panel can show a
 * text field for a string, but it cannot know that the string is a colour, that it
 * must be one of four values, or that it means nothing unless another prop is set.
 *
 * The important consequence is that the control declaration, not the panel, is the
 * source of truth. Adding a prop to a component makes it editable without touching
 * the editor, which is what keeps a growing component library from requiring a
 * matching pile of bespoke inspector code.
 *
 * Two rules the model enforces:
 *
 *   - A control's default must satisfy its own constraints. A default outside the
 *     declared range would put the component in an invalid state the moment it was
 *     inserted, before anyone edited anything.
 *   - An enum's options and labels stay the same length, so a value can always be
 *     shown with the label the author wrote rather than falling back to the raw
 *     value in some cases and not others.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

/** How a value should be edited, and therefore what it means. */
export const ControlKindSchema = Type.Union([
  Type.Literal('string'),
  /** Multi-line text. Separate from string because the control differs. */
  Type.Literal('text'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('color'),
  /** One of a fixed set. */
  Type.Literal('enum'),
  /** A media reference resolved through the media library. */
  Type.Literal('image'),
  /** A file reference, for downloads and documents. */
  Type.Literal('file'),
  /** A URL, internal or external, validated as a link. */
  Type.Literal('link'),
  /** Rendered children, filled by nesting on the canvas. */
  Type.Literal('node'),
  /** A repeated group of controls. */
  Type.Literal('array'),
  /** A nested group of controls, edited as a unit. */
  Type.Literal('object'),
  /** A design token reference rather than a literal value. */
  Type.Literal('token'),
])
export type ControlKind = Static<typeof ControlKindSchema>

/**
 * When a control is shown.
 *
 * A control that only matters under some condition should disappear otherwise:
 * showing a "gradient end colour" field when the fill is set to solid invites
 * someone to set a value that does nothing.
 */
export const ControlVisibilitySchema = Type.Object({
  /** Name of the sibling control this depends on. */
  prop: Type.String({ minLength: 1, maxLength: 128 }),
  /** Shown when the sibling equals one of these values. */
  equals: Type.Array(
    Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
    { minItems: 1, maxItems: 16 },
  ),
}, { additionalProperties: false })
export type ControlVisibility = Static<typeof ControlVisibilitySchema>

const ControlBaseFields = {
  /** Label shown in the panel. Falls back to the prop name. */
  title: Type.Optional(Type.String({ maxLength: 128 })),
  /** Longer explanation, for a prop whose effect is not obvious. */
  description: Type.Optional(Type.String({ maxLength: 512 })),
  /** Whether the component requires it. */
  required: Type.Optional(Type.Boolean()),
  hidden: Type.Optional(ControlVisibilitySchema),
}

/**
 * One property control.
 *
 * A union rather than one object with every field, so a number control cannot carry
 * enum options and an author cannot declare something the panel would ignore.
 */
export const PropertyControlSchema = Type.Union([
  Type.Object({
    kind: Type.Union([Type.Literal('string'), Type.Literal('text')]),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.String({ maxLength: 4096 })),
    placeholder: Type.Optional(Type.String({ maxLength: 128 })),
    maxLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('number'),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.Number()),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    /** Step for the stepper and slider. */
    step: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    /** Unit suffix shown in the control, e.g. `px`, `%`. */
    unit: Type.Optional(Type.String({ maxLength: 16 })),
    /** Show a slider rather than a stepper. Needs both bounds to be meaningful. */
    slider: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('boolean'),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.Boolean()),
    /** Labels for the two states, where on/off would be unclear. */
    enabledTitle: Type.Optional(Type.String({ maxLength: 64 })),
    disabledTitle: Type.Optional(Type.String({ maxLength: 64 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('color'),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.String({ maxLength: 128 })),
    /**
     * Restrict to theme colours rather than allowing any value. Worth having
     * because an arbitrary hex bypasses the design system and dark mode with it.
     */
    tokensOnly: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('enum'),
    ...ControlBaseFields,
    /** Values passed to the component. */
    options: Type.Array(Type.Union([Type.String(), Type.Number()]), {
      minItems: 1, maxItems: 64,
    }),
    /** Labels shown in the panel, one per option. */
    optionTitles: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 64 })),
    defaultValue: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    /** Render as segmented buttons rather than a dropdown. */
    segmented: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Union([Type.Literal('image'), Type.Literal('file')]),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.String({ maxLength: 2048 })),
    /** Accepted MIME types or extensions. */
    accept: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('link'),
    ...ControlBaseFields,
    defaultValue: Type.Optional(Type.String({ maxLength: 2048 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('node'),
    ...ControlBaseFields,
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('token'),
    ...ControlBaseFields,
    /** Which token namespace to offer, e.g. `spacing`, `color`, `font`. */
    namespace: Type.String({ minLength: 1, maxLength: 64 }),
    defaultValue: Type.Optional(Type.String({ maxLength: 128 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('array'),
    ...ControlBaseFields,
    /**
     * Control for each item. Recursion is expressed by id rather than inline so the
     * schema stays finite and a cycle is impossible to construct.
     */
    itemControlId: Type.String({ minLength: 1, maxLength: 128 }),
    maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 256 })),
  }, { additionalProperties: false }),

  Type.Object({
    kind: Type.Literal('object'),
    ...ControlBaseFields,
    /** Controls for each field, by prop name. */
    fieldControlIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      minItems: 1, maxItems: 64,
    }),
  }, { additionalProperties: false }),
])
export type PropertyControl = Static<typeof PropertyControlSchema>

/** A component's complete control declaration. */
export const ControlDeclarationSchema = Type.Object({
  /** Controls by prop name. */
  controls: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), PropertyControlSchema),
  /** Display order in the panel. Names absent from this list follow, sorted. */
  order: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 128 })),
}, { additionalProperties: false })
export type ControlDeclaration = Static<typeof ControlDeclarationSchema>

export type ControlProblem = Readonly<{
  code:
    | 'default-violates-constraint'
    | 'option-titles-length-mismatch'
    | 'default-not-an-option'
    | 'slider-without-bounds'
    | 'visibility-target-missing'
    | 'visibility-self-reference'
    | 'unresolved-control-reference'
  propName: string
  message: string
}>

/**
 * Validate a declaration.
 *
 * Checks the things that would otherwise produce a panel that misbehaves quietly:
 * a default the component rejects, an enum whose labels do not line up with its
 * values, a visibility rule pointing at a prop that does not exist.
 */
export function validateControls(declaration: ControlDeclaration): readonly ControlProblem[] {
  const problems: ControlProblem[] = []
  const names = new Set(Object.keys(declaration.controls))

  const report = (code: ControlProblem['code'], propName: string, message: string): void => {
    problems.push(Object.freeze({ code, propName, message }))
  }

  for (const [propName, control] of Object.entries(declaration.controls)) {
    // A default outside its own constraints puts the component in an invalid state
    // the moment it is inserted, before anyone has edited anything.
    if (control.kind === 'number' && control.defaultValue !== undefined) {
      if (control.min !== undefined && control.defaultValue < control.min) {
        report('default-violates-constraint', propName,
          `Default ${control.defaultValue} is below the minimum ${control.min}.`)
      }
      if (control.max !== undefined && control.defaultValue > control.max) {
        report('default-violates-constraint', propName,
          `Default ${control.defaultValue} is above the maximum ${control.max}.`)
      }
    }

    if (control.kind === 'number' && control.slider
      && (control.min === undefined || control.max === undefined)) {
      // A slider with no range has nothing to slide between.
      report('slider-without-bounds', propName,
        'A slider needs both min and max, or it has no range to represent.')
    }

    if (control.kind === 'enum') {
      if (control.optionTitles && control.optionTitles.length !== control.options.length) {
        // Mismatched lengths mean some values show a label and others show the raw
        // value, which looks like a bug to whoever is using the panel.
        report('option-titles-length-mismatch', propName,
          `${control.options.length} options but ${control.optionTitles.length} titles. `
          + 'Every option needs a label or none should have one.')
      }
      if (control.defaultValue !== undefined && !control.options.includes(control.defaultValue)) {
        report('default-not-an-option', propName,
          `Default ${JSON.stringify(control.defaultValue)} is not among the options.`)
      }
    }

    if (control.kind === 'string' || control.kind === 'text') {
      if (control.defaultValue !== undefined && control.maxLength !== undefined
        && control.defaultValue.length > control.maxLength) {
        report('default-violates-constraint', propName,
          `Default is ${control.defaultValue.length} characters, longer than the `
          + `maximum ${control.maxLength}.`)
      }
    }

    if (control.hidden) {
      if (control.hidden.prop === propName) {
        report('visibility-self-reference', propName,
          'A control cannot depend on its own value to decide whether it is shown.')
      } else if (!names.has(control.hidden.prop)) {
        report('visibility-target-missing', propName,
          `Visibility depends on "${control.hidden.prop}", which is not a declared control.`)
      }
    }

    if (control.kind === 'array' && !names.has(control.itemControlId)) {
      report('unresolved-control-reference', propName,
        `Item control "${control.itemControlId}" is not declared.`)
    }
    if (control.kind === 'object') {
      for (const fieldName of control.fieldControlIds) {
        if (!names.has(fieldName)) {
          report('unresolved-control-reference', propName,
            `Field control "${fieldName}" is not declared.`)
        }
      }
    }
  }

  return Object.freeze(problems)
}

/**
 * Default props derived from a declaration.
 *
 * Used when inserting a component, so it renders as its author intended rather than
 * appearing blank and needing every field filled before it looks like anything.
 */
export function defaultPropsOf(declaration: ControlDeclaration): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [propName, control] of Object.entries(declaration.controls)) {
    if ('defaultValue' in control && control.defaultValue !== undefined) {
      props[propName] = control.defaultValue
      continue
    }
    // No declared default: only booleans get an implied one, because false is a
    // real state while an empty string or zero is usually a placeholder that would
    // be mistaken for a deliberate value.
    if (control.kind === 'boolean') props[propName] = false
  }
  return props
}

/** Panel order: declared order first, then everything else alphabetically. */
export function controlOrderOf(declaration: ControlDeclaration): readonly string[] {
  const declared = (declaration.order ?? []).filter((name) => name in declaration.controls)
  const remaining = Object.keys(declaration.controls)
    .filter((name) => !declared.includes(name))
    .sort()
  return Object.freeze([...declared, ...remaining])
}

/**
 * Whether a control is currently shown, given the props in effect.
 *
 * Evaluated against live props rather than baked in, because the answer changes as
 * the author edits a sibling field.
 */
export function isControlVisible(
  control: PropertyControl,
  props: Readonly<Record<string, unknown>>,
): boolean {
  if (!control.hidden) return true
  const value = props[control.hidden.prop]
  return !control.hidden.equals.some((candidate) => candidate === value)
}

/**
 * The TypeScript type a control implies.
 *
 * Generated from the control rather than written twice, so the panel and the
 * component's own signature cannot drift apart.
 */
export function typeOfControl(control: PropertyControl): string {
  switch (control.kind) {
    case 'string':
    case 'text':
    case 'color':
    case 'link':
    case 'image':
    case 'file':
    case 'token':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'node':
      return 'ReactNode'
    case 'enum':
      // A literal union, not `string`: the whole point of an enum control is that
      // only these values are valid, and the type should say so.
      return control.options.map((option) => JSON.stringify(option)).join(' | ')
    case 'array':
      return 'readonly unknown[]'
    case 'object':
      return 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}

/** The props interface for a component, generated from its controls. */
export function propsInterfaceSourceOf(
  symbol: string,
  declaration: ControlDeclaration,
): string {
  const lines = controlOrderOf(declaration).map((propName) => {
    const control = declaration.controls[propName]
    if (!control) return ''
    // A control with a default is always satisfiable, so it is optional regardless
    // of whether it was marked required.
    const hasDefault = 'defaultValue' in control && control.defaultValue !== undefined
    const optional = control.required && !hasDefault ? '' : '?'
    const comment = control.description ? `  /** ${control.description} */\n` : ''
    return `${comment}  ${propName}${optional}: ${typeOfControl(control)}`
  }).filter((line) => line.length > 0)

  return `export interface ${symbol}Props {\n${lines.join('\n')}\n}`
}

export type PropProblem = Readonly<{
  code:
    | 'unknown-prop'
    | 'missing-required'
    | 'wrong-type'
    | 'not-an-option'
    | 'out-of-range'
    | 'too-long'
    | 'set-while-hidden'
  propName: string
  message: string
}>

/**
 * Validate an instance's props against its component's controls.
 *
 * Run when a component is inserted or edited, and again before generating source,
 * because a prop that violates its control produces a component in a state its
 * author never allowed for — usually visible as a rendering bug far from the cause.
 *
 * Hidden controls are checked too. A value set while its control was visible and
 * then orphaned when a sibling changed is worth reporting: it is invisible in the
 * panel but still passed to the component.
 */
export function validateProps(
  declaration: ControlDeclaration,
  props: Readonly<Record<string, unknown>>,
): readonly PropProblem[] {
  const problems: PropProblem[] = []
  const report = (code: PropProblem['code'], propName: string, message: string): void => {
    problems.push(Object.freeze({ code, propName, message }))
  }

  for (const propName of Object.keys(props)) {
    if (!(propName in declaration.controls)) {
      // Not merely untidy: an undeclared prop cannot be edited, so whatever set it
      // is the only thing that can ever change it.
      report('unknown-prop', propName,
        `"${propName}" is not a declared control, so the panel cannot edit it.`)
    }
  }

  for (const [propName, control] of Object.entries(declaration.controls)) {
    const value = props[propName]
    const hasDefault = 'defaultValue' in control && control.defaultValue !== undefined

    if (value === undefined) {
      // A default satisfies a required control, so absence is only a problem
      // when there is nothing to fall back to.
      if (control.required && !hasDefault) {
        report('missing-required', propName, `"${propName}" is required and has no default.`)
      }
      continue
    }

    if (!isControlVisible(control, props)) {
      report('set-while-hidden', propName,
        `"${propName}" has a value but its control is hidden, so the value is invisible in `
        + 'the panel while still reaching the component.')
    }

    const expected = expectedTypeOf(control)
    if (expected && typeof value !== expected) {
      report('wrong-type', propName,
        `"${propName}" expects ${expected} but received ${typeof value}.`)
      continue
    }

    if (control.kind === 'enum' && !control.options.includes(value as string | number)) {
      report('not-an-option', propName,
        `${JSON.stringify(value)} is not among the declared options for "${propName}".`)
    }

    if (control.kind === 'number' && typeof value === 'number') {
      if (control.min !== undefined && value < control.min) {
        report('out-of-range', propName, `${value} is below the minimum ${control.min}.`)
      }
      if (control.max !== undefined && value > control.max) {
        report('out-of-range', propName, `${value} is above the maximum ${control.max}.`)
      }
    }

    if ((control.kind === 'string' || control.kind === 'text')
      && typeof value === 'string'
      && control.maxLength !== undefined
      && value.length > control.maxLength) {
      report('too-long', propName,
        `${value.length} characters exceeds the maximum ${control.maxLength}.`)
    }
  }

  return Object.freeze(problems)
}

/**
 * The runtime type a control's value should have, or null where `typeof` cannot say.
 *
 * `node`, `array` and `object` are excluded because a ReactNode may legitimately be
 * a string, a number or an object, so a typeof check would reject valid values.
 */
function expectedTypeOf(control: PropertyControl): 'string' | 'number' | 'boolean' | null {
  switch (control.kind) {
    case 'string':
    case 'text':
    case 'color':
    case 'link':
    case 'image':
    case 'file':
    case 'token':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return null
  }
}

/**
 * Props with defaults applied, ready to render.
 *
 * Declared values win over defaults, and a hidden control contributes nothing —
 * passing a value the author cannot see would make the rendered result disagree
 * with the panel.
 */
export function resolveProps(
  declaration: ControlDeclaration,
  props: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...defaultPropsOf(declaration), ...props }
  for (const [propName, control] of Object.entries(declaration.controls)) {
    if (!isControlVisible(control, resolved)) delete resolved[propName]
  }
  return resolved
}
