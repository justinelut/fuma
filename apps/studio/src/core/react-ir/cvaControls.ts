/**
 * Making shadcn components configurable on the canvas.
 *
 * TASK 35's DERIVATION CANNOT DO THIS, and that was measured rather than assumed. Running the real
 * deriveControls() over the shipped button and card returns ZERO controls and the note
 * `no-props-interface`, whose own message says such a component "cannot be edited visually". The
 * reason is that shadcn does not declare a props interface at all - it writes them inline:
 *
 *     }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }
 *
 * There is no `*Props` interface to find, so the mechanism that reads one finds nothing.
 *
 * AND DERIVING FROM THAT TYPE WOULD BE THE WRONG ANSWER EVEN IF IT WERE POSSIBLE.
 * `React.ComponentProps<"button">` is every DOM attribute a button accepts - a couple of hundred
 * members. A control per member produces a panel nobody can use, which is worse than no panel
 * because it buries the two fields that matter.
 *
 * THE EDITABLE SURFACE IS THE cva VARIANTS. `variant` and `size` are exactly the design decisions a
 * designer makes about a button, they are already a closed set of names, and the set is declared in
 * the component's own source - so it cannot drift from what the component accepts. They map onto the
 * EXISTING enum control, so the panel needs no new concept and task 37's rendering already handles
 * them.
 */
import type { PropertyControl } from './propertyControls'

export type VariantGroup = Readonly<{
  /** The prop name, e.g. 'variant' or 'size'. */
  prop: string
  /** The accepted values, in declaration order. */
  options: readonly string[]
  /** The value cva applies when the prop is absent, if it declares one. */
  defaultValue: string | null
}>

export type CvaDerivation = Readonly<{
  /** The cva binding name, e.g. 'buttonVariants'. Null when the component declares none. */
  variantsName: string | null
  groups: readonly VariantGroup[]
  notes: readonly Readonly<{ code: string; message: string }>[]
}>

/**
 * Reads the variant groups out of a component's `cva(...)` call.
 *
 * Deliberately a source scan over the variants block rather than a type-level evaluation: the values
 * are string literal KEYS in an object, which is exactly what a scan can read reliably, whereas
 * resolving `VariantProps<typeof buttonVariants>` needs a full type checker and a program - far more
 * machinery, and it would produce the same answer.
 */
export function deriveCvaVariants(source: string): CvaDerivation {
  const notes: { code: string; message: string }[] = []

  const binding = /const\s+(\w+)\s*=\s*cva\(/.exec(source)
  if (!binding) {
    return Object.freeze({
      variantsName: null,
      groups: Object.freeze([]),
      // Not a fault: card, input and table are plain styled markup with no variants at all.
      notes: Object.freeze([{
        code: 'no-variants',
        message: 'The component declares no cva variants, so it has no configurable design options. That is legitimate for plain styled markup - the canvas offers its class tokens instead.',
      }]),
    })
  }

  const variantsStart = source.indexOf('variants:', binding.index)
  if (variantsStart === -1) {
    return Object.freeze({
      variantsName: binding[1]!,
      groups: Object.freeze([]),
      notes: Object.freeze([{
        code: 'cva-without-variants',
        message: 'A cva call with no variants block only ever produces its base classes, so the wrapper adds nothing a class token could not.',
      }]),
    })
  }

  const block = balancedBlock(source, source.indexOf('{', variantsStart))
  if (block === null) {
    return Object.freeze({
      variantsName: binding[1]!,
      groups: Object.freeze([]),
      notes: Object.freeze([{
        code: 'variants-unreadable',
        message: 'The variants block could not be read to its closing brace, so no options are offered rather than a partial set - half a set of options is worse than none, because the missing ones look unavailable.',
      }]),
    })
  }

  const defaults = readDefaults(source, binding.index)
  const groups: VariantGroup[] = []

  for (const group of topLevelKeys(block)) {
    // The value is a brace-wrapped object, and topLevelKeys splits a BODY. Passing the wrapped form
    // leaves every option at depth 1, so nothing registers and the group looks empty.
    const options = topLevelKeys(unwrapBraces(group.value))
      .map((entry) => entry.key)
      .filter((key) => key.length > 0)
    if (options.length === 0) continue
    groups.push(Object.freeze({
      prop: group.key,
      options: Object.freeze(options),
      defaultValue: defaults[group.key] ?? null,
    }))
  }

  return Object.freeze({ variantsName: binding[1]!, groups: Object.freeze(groups), notes: Object.freeze(notes) })
}

/** Turns the variant groups into controls the existing panel already renders. */
export function controlsFromVariants(
  groups: readonly VariantGroup[],
): Readonly<Record<string, PropertyControl>> {
  const controls: Record<string, PropertyControl> = {}
  for (const group of groups) {
    const control: PropertyControl = {
      kind: 'enum',
      title: humaniseVariant(group.prop),
      options: [...group.options],
      // Segmented when the set is small enough to read at a glance; a dropdown otherwise, because
      // eight segmented buttons in a narrow panel wrap into an unreadable grid.
      ...(group.options.length <= 4 ? { segmented: true } : {}),
      ...(group.defaultValue !== null ? { defaultValue: group.defaultValue } : {}),
    }
    controls[group.prop] = control
  }
  return Object.freeze(controls)
}

/** 'variant' reads as jargon in a panel; 'Style' is what the choice actually is. */
export function humaniseVariant(prop: string): string {
  if (prop === 'variant') return 'Style'
  if (prop === 'size') return 'Size'
  return prop.charAt(0).toUpperCase() + prop.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase().trim()
}

/** Reads `defaultVariants: { ... }` so the panel shows what the component does when left alone. */
function readDefaults(source: string, from: number): Record<string, string> {
  const at = source.indexOf('defaultVariants:', from)
  if (at === -1) return {}
  const block = balancedBlock(source, source.indexOf('{', at))
  if (block === null) return {}
  const defaults: Record<string, string> = {}
  for (const entry of topLevelKeys(block)) {
    const value = /["']([^"']+)["']/.exec(entry.value)
    if (value) defaults[entry.key] = value[1]!
  }
  return defaults
}

/**
 * Returns the contents of a braced block, matching braces so a nested object does not end it early.
 *
 * A naive search for the next '}' stops inside the first variant, which would report one option and
 * hide the rest - the kind of partial result that reads as the component having fewer choices.
 */
function balancedBlock(source: string, open: number): string | null {
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

/**
 * Splits an object body into its top-level `key: value` entries.
 *
 * Depth-aware, because a variant's value is itself an object and a comma inside it is not a
 * separator. Quote-aware too: shadcn's class strings contain braces and commas
 * (`[&_svg:not([class*='size-'])]:size-4`), and counting those as structure would misread the block.
 */
function topLevelKeys(body: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = []
  let depth = 0
  let quote: string | null = null
  let keyStart = 0
  let colon = -1

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!

    if (quote !== null) {
      if (char === quote && body[i - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{' || char === '[' || char === '(') { depth += 1; continue }
    if (char === '}' || char === ']' || char === ')') { depth -= 1; continue }

    if (depth === 0 && char === ':' && colon === -1) { colon = i; continue }
    if (depth === 0 && char === ',') {
      if (colon !== -1) {
        entries.push({
          key: cleanKey(body.slice(keyStart, colon)),
          value: body.slice(colon + 1, i).trim(),
        })
      }
      keyStart = i + 1
      colon = -1
    }
  }
  if (colon !== -1) {
    entries.push({ key: cleanKey(body.slice(keyStart, colon)), value: body.slice(colon + 1).trim() })
  }
  return entries.filter((entry) => entry.key.length > 0)
}

/** A shadcn variant key may be quoted ("icon-sm") because it is not an identifier. */
function cleanKey(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').trim()
}

/**
 * Strips the outer braces from an object value so its body can be split.
 *
 * topLevelKeys splits a BODY, so handing it `{ a: 1 }` puts every entry at depth 1 where nothing
 * registers - the group then reads as having no options at all.
 */
function unwrapBraces(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1)
  return trimmed
}
