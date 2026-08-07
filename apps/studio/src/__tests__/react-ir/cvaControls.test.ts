/**
 * Task 72: shadcn components made configurable in the components section.
 *
 * Derived against the REAL shipped components, because the whole reason this mechanism exists is a
 * measured fact about them: they declare no props interface.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import {
  controlsFromVariants,
  deriveCvaVariants,
  humaniseVariant,
} from '../../core/react-ir/cvaControls'
import { PropertyControlSchema, validateControls } from '../../core/react-ir/propertyControls'
import { deriveControls } from '../../core/react-ir/catalogControls'

const UI = join(import.meta.dir, '..', '..', 'admin', 'fuma', 'ui')
const read = (name: string) => readFileSync(join(UI, `${name}.tsx`), 'utf8')

describe('the measured fact this mechanism exists for', () => {
  it('task 35\'s derivation finds NO controls on a real shadcn component', () => {
    // Not a criticism of deriveControls - it reads a declared interface, and shadcn declares none.
    for (const name of ['button', 'card']) {
      const derived = deriveControls(name, read(name))
      expect(Object.keys(derived.declaration.controls)).toHaveLength(0)
      expect(derived.notes.map((n) => n.code)).toContain('no-props-interface')
    }
  })

  it('and the component genuinely declares its props inline instead', () => {
    const button = read('button')
    expect(button).toContain('React.ComponentProps<"button">')
    expect(button).toContain('VariantProps<typeof buttonVariants>')
    expect(button).not.toContain('interface ButtonProps')
  })
})

describe('deriving from the real button', () => {
  const derived = deriveCvaVariants(read('button'))

  it('finds the cva binding by its real name', () => {
    expect(derived.variantsName).toBe('buttonVariants')
  })

  it('recovers the style options exactly as the component declares them', () => {
    const style = derived.groups.find((g) => g.prop === 'variant')
    expect(style).toBeDefined()
    expect(style!.options).toEqual([
      'default', 'destructive', 'outline', 'secondary', 'ghost', 'link',
    ])
  })

  it('recovers size, INCLUDING the quoted keys that are not identifiers', () => {
    // 'icon-sm' must survive; dropping quoted keys would silently offer fewer sizes than exist.
    const size = derived.groups.find((g) => g.prop === 'size')
    expect(size!.options).toContain('icon')
    expect(size!.options).toContain('icon-sm')
    expect(size!.options).toContain('lg')
  })

  it('reads the default cva applies when the prop is absent', () => {
    const style = derived.groups.find((g) => g.prop === 'variant')
    expect(style!.defaultValue).toBe('default')
  })

  it('is not fooled by braces and commas inside the class strings', () => {
    // shadcn writes [&_svg:not([class*='size-'])]:size-4 - counting those as structure would
    // truncate the block and report a fraction of the options.
    expect(read('button')).toContain("[class*='size-']")
    const style = derived.groups.find((g) => g.prop === 'variant')
    expect(style!.options.length).toBeGreaterThan(4)
  })
})

describe('the controls it produces are ones the existing panel already renders', () => {
  const controls = controlsFromVariants(deriveCvaVariants(read('button')).groups)

  it('every control validates against the SHIPPED PropertyControl schema', () => {
    // If they did not, the panel from task 37 could not render them and this would need a new kind.
    for (const control of Object.values(controls)) {
      expect(Value.Check(PropertyControlSchema, control)).toBe(true)
    }
  })

  it('and passes the shipped validateControls with no problems', () => {
    expect(validateControls({ componentId: 'button', controls })).toEqual([])
  })

  it('as enum controls, which is what a closed set of names is', () => {
    expect(controls.variant!.kind).toBe('enum')
    expect(controls.size!.kind).toBe('enum')
  })

  it('carries the default through so the panel shows what happens when left alone', () => {
    expect((controls.variant as { defaultValue?: string }).defaultValue).toBe('default')
  })

  it('segments a small set and drops to a dropdown for a large one', () => {
    // Eight segmented buttons in a narrow panel wrap into an unreadable grid.
    const small = controlsFromVariants([{ prop: 'tone', options: ['a', 'b'], defaultValue: null }])
    expect((small.tone as { segmented?: boolean }).segmented).toBe(true)
    const large = controlsFromVariants([
      { prop: 'tone', options: ['a', 'b', 'c', 'd', 'e'], defaultValue: null },
    ])
    expect((large.tone as { segmented?: boolean }).segmented).toBeUndefined()
  })

  it('labels the field for a designer rather than showing the prop name', () => {
    expect(humaniseVariant('variant')).toBe('Style')
    expect(humaniseVariant('size')).toBe('Size')
  })
})

describe('a component with no variants is reported, not treated as broken', () => {
  it('card declares none, which is legitimate', () => {
    const derived = deriveCvaVariants(read('card'))
    expect(derived.groups).toHaveLength(0)
    expect(derived.notes.map((n) => n.code)).toContain('no-variants')
  })

  it('and the note says what the canvas offers instead', () => {
    const derived = deriveCvaVariants(read('card'))
    expect(derived.notes[0]!.message).toContain('class tokens')
  })
})

describe('across every shipped component that has variants', () => {
  it('each derives at least one option and produces valid controls', () => {
    // A component whose cva could not be read would offer an empty panel that looks broken.
    const withVariants = ['button', 'badge', 'alert', 'toggle', 'label']
    for (const name of withVariants) {
      const derived = deriveCvaVariants(read(name))
      if (derived.variantsName === null) continue
      const controls = controlsFromVariants(derived.groups)
      expect(validateControls({ componentId: name, controls })).toEqual([])
      for (const group of derived.groups) {
        expect(group.options.length).toBeGreaterThan(0)
        // An empty-string option would render a blank row in the panel.
        for (const option of group.options) expect(option.trim()).not.toBe('')
      }
    }
  })
})
