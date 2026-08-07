import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  ControlDeclarationSchema,
  PropertyControlSchema,
  controlOrderOf,
  defaultPropsOf,
  isControlVisible,
  propsInterfaceSourceOf,
  typeOfControl,
  resolveProps,
  validateControls,
  validateProps,
  type ControlDeclaration,
} from '@core/react-ir/propertyControls'

function declare(controls: Record<string, unknown>, order?: string[]): ControlDeclaration {
  return { controls, ...(order ? { order } : {}) } as unknown as ControlDeclaration
}

describe('control schema', () => {
  it('accepts each control kind', () => {
    const controls = [
      { kind: 'string', defaultValue: 'Hello' },
      { kind: 'text', defaultValue: 'Long copy' },
      { kind: 'number', defaultValue: 4, min: 0, max: 10, step: 1, unit: 'px' },
      { kind: 'boolean', defaultValue: true },
      { kind: 'color', defaultValue: 'var(--primary)', tokensOnly: true },
      { kind: 'enum', options: ['sm', 'lg'], optionTitles: ['Small', 'Large'], defaultValue: 'sm' },
      { kind: 'image', accept: ['image/png'] },
      { kind: 'link', defaultValue: '/about' },
      { kind: 'node' },
      { kind: 'token', namespace: 'spacing' },
    ]
    for (const control of controls) {
      expect(Value.Check(PropertyControlSchema, control)).toBe(true)
    }
  })

  it('refuses a field that belongs to a different control kind', () => {
    // A union rather than one wide object, so an author cannot declare something the
    // panel would silently ignore.
    expect(Value.Check(PropertyControlSchema, {
      kind: 'number', options: ['a', 'b'],
    })).toBe(false)
  })

  it('requires an enum to offer at least one option', () => {
    expect(Value.Check(PropertyControlSchema, { kind: 'enum', options: [] })).toBe(false)
  })
})

describe('validating a declaration', () => {
  it('accepts a coherent declaration', () => {
    expect(validateControls(declare({
      size: { kind: 'enum', options: ['sm', 'lg'], defaultValue: 'sm' },
      gap: { kind: 'number', defaultValue: 4, min: 0, max: 16 },
    }))).toEqual([])
  })

  it('rejects a default below the minimum', () => {
    // A default outside its own constraints puts the component in an invalid state
    // the moment it is inserted.
    const problems = validateControls(declare({
      gap: { kind: 'number', defaultValue: -2, min: 0 },
    }))
    expect(problems[0]?.code).toBe('default-violates-constraint')
    expect(problems[0]?.propName).toBe('gap')
  })

  it('rejects a default above the maximum', () => {
    expect(validateControls(declare({
      gap: { kind: 'number', defaultValue: 40, max: 16 },
    }))[0]?.code).toBe('default-violates-constraint')
  })

  it('rejects a string default longer than its own limit', () => {
    expect(validateControls(declare({
      label: { kind: 'string', defaultValue: 'abcdef', maxLength: 3 },
    }))[0]?.code).toBe('default-violates-constraint')
  })

  it('rejects mismatched option titles', () => {
    // Otherwise some values show a label and others show the raw value, which reads
    // as a bug to whoever is using the panel.
    const problems = validateControls(declare({
      size: { kind: 'enum', options: ['sm', 'md', 'lg'], optionTitles: ['Small', 'Large'] },
    }))
    expect(problems[0]?.code).toBe('option-titles-length-mismatch')
    expect(problems[0]?.message).toMatch(/3 options but 2 titles/)
  })

  it('rejects a default that is not one of the options', () => {
    expect(validateControls(declare({
      size: { kind: 'enum', options: ['sm', 'lg'], defaultValue: 'xl' },
    }))[0]?.code).toBe('default-not-an-option')
  })

  it('rejects a slider with no range', () => {
    expect(validateControls(declare({
      gap: { kind: 'number', slider: true, min: 0 },
    }))[0]?.code).toBe('slider-without-bounds')
  })

  it('rejects a visibility rule pointing at a prop that does not exist', () => {
    expect(validateControls(declare({
      endColor: { kind: 'color', hidden: { prop: 'fill', equals: ['solid'] } },
    }))[0]?.code).toBe('visibility-target-missing')
  })

  it('rejects a control whose visibility depends on itself', () => {
    expect(validateControls(declare({
      fill: { kind: 'enum', options: ['solid'], hidden: { prop: 'fill', equals: ['solid'] } },
    }))[0]?.code).toBe('visibility-self-reference')
  })

  it('rejects an array control referencing an undeclared item control', () => {
    expect(validateControls(declare({
      items: { kind: 'array', itemControlId: 'missing' },
    }))[0]?.code).toBe('unresolved-control-reference')
  })

  it('rejects an object control referencing an undeclared field control', () => {
    expect(validateControls(declare({
      layout: { kind: 'object', fieldControlIds: ['gap', 'absent'] },
      gap: { kind: 'number' },
    }))[0]?.code).toBe('unresolved-control-reference')
  })
})

describe('defaults', () => {
  it('collects declared defaults so an inserted component looks intentional', () => {
    expect(defaultPropsOf(declare({
      title: { kind: 'string', defaultValue: 'Hello' },
      gap: { kind: 'number', defaultValue: 4 },
    }))).toEqual({ title: 'Hello', gap: 4 })
  })

  it('implies false for a boolean but nothing for other kinds', () => {
    // False is a real state; an empty string or zero would usually be mistaken for a
    // deliberate value.
    expect(defaultPropsOf(declare({
      visible: { kind: 'boolean' },
      title: { kind: 'string' },
      gap: { kind: 'number' },
    }))).toEqual({ visible: false })
  })
})

describe('panel order', () => {
  it('follows the declared order then sorts the rest', () => {
    expect(controlOrderOf(declare({
      zeta: { kind: 'string' },
      alpha: { kind: 'string' },
      title: { kind: 'string' },
    }, ['title']))).toEqual(['title', 'alpha', 'zeta'])
  })

  it('ignores an ordered name that is not a control', () => {
    expect(controlOrderOf(declare({ a: { kind: 'string' } }, ['ghost', 'a']))).toEqual(['a'])
  })
})

describe('conditional visibility', () => {
  const control = {
    kind: 'color' as const,
    hidden: { prop: 'fill', equals: ['solid'] },
  }

  it('hides a control when the condition matches', () => {
    // Showing a gradient end colour while the fill is solid invites setting a value
    // that does nothing.
    expect(isControlVisible(control, { fill: 'solid' })).toBe(false)
  })

  it('shows it otherwise', () => {
    expect(isControlVisible(control, { fill: 'gradient' })).toBe(true)
    expect(isControlVisible(control, {})).toBe(true)
  })

  it('always shows a control with no condition', () => {
    expect(isControlVisible({ kind: 'string' }, {})).toBe(true)
  })
})

describe('types from controls', () => {
  it('maps each kind to its TypeScript type', () => {
    expect(typeOfControl({ kind: 'string' })).toBe('string')
    expect(typeOfControl({ kind: 'number' })).toBe('number')
    expect(typeOfControl({ kind: 'boolean' })).toBe('boolean')
    expect(typeOfControl({ kind: 'node' })).toBe('ReactNode')
    expect(typeOfControl({ kind: 'color' })).toBe('string')
  })

  it('makes an enum a literal union rather than a bare string', () => {
    // The point of an enum control is that only these values are valid, and the type
    // should say so or the compiler cannot help.
    expect(typeOfControl({ kind: 'enum', options: ['sm', 'lg'] })).toBe('"sm" | "lg"')
  })
})

describe('generated props interface', () => {
  it('generates a typed interface in panel order', () => {
    const source = propsInterfaceSourceOf('Hero', declare({
      title: { kind: 'string', required: true },
      size: { kind: 'enum', options: ['sm', 'lg'], defaultValue: 'sm' },
    }, ['title', 'size']))
    expect(source).toBe([
      'export interface HeroProps {',
      '  title: string',
      '  size?: "sm" | "lg"',
      '}',
    ].join('\n'))
  })

  it('treats a required control with a default as optional', () => {
    // A default makes it always satisfiable, so demanding it at the call site would
    // be false precision.
    const source = propsInterfaceSourceOf('Card', declare({
      gap: { kind: 'number', required: true, defaultValue: 4 },
    }))
    expect(source).toContain('gap?: number')
  })

  it('carries a description through as a doc comment', () => {
    const source = propsInterfaceSourceOf('Card', declare({
      gap: { kind: 'number', description: 'Space between rows.' },
    }))
    expect(source).toContain('/** Space between rows. */')
  })
})

describe('declaration schema', () => {
  it('accepts a declaration with an order', () => {
    expect(Value.Check(ControlDeclarationSchema, {
      controls: { title: { kind: 'string' } },
      order: ['title'],
    })).toBe(true)
  })

  it('refuses an unknown top-level field', () => {
    expect(Value.Check(ControlDeclarationSchema, {
      controls: {}, layout: 'grid',
    })).toBe(false)
  })
})

describe('validating instance props', () => {
  const declaration = declare({
    title: { kind: 'string', required: true },
    size: { kind: 'enum', options: ['sm', 'lg'], defaultValue: 'sm' },
    gap: { kind: 'number', min: 0, max: 16 },
    visible: { kind: 'boolean' },
  })

  it('accepts valid props', () => {
    expect(validateProps(declaration, { title: 'Hi', size: 'lg', gap: 8 })).toEqual([])
  })

  it('reports a prop with no control', () => {
    // An undeclared prop cannot be edited, so whatever set it is the only thing that
    // can ever change it.
    const problems = validateProps(declaration, { title: 'Hi', colour: 'red' })
    expect(problems[0]?.code).toBe('unknown-prop')
    expect(problems[0]?.propName).toBe('colour')
  })

  it('reports a missing required prop', () => {
    expect(validateProps(declaration, {})[0]?.code).toBe('missing-required')
  })

  it('treats a default as satisfying a required control', () => {
    const withDefault = declare({ title: { kind: 'string', required: true, defaultValue: 'Hi' } })
    expect(validateProps(withDefault, {})).toEqual([])
  })

  it('reports the wrong type', () => {
    const problems = validateProps(declaration, { title: 42 })
    expect(problems.find((problem) => problem.code === 'wrong-type')?.message)
      .toMatch(/expects string but received number/)
  })

  it('reports a value outside an enum', () => {
    expect(validateProps(declaration, { title: 'Hi', size: 'xl' })
      .find((problem) => problem.code === 'not-an-option')).toBeDefined()
  })

  it('reports a number outside its range', () => {
    expect(validateProps(declaration, { title: 'Hi', gap: 40 })
      .find((problem) => problem.code === 'out-of-range')?.message)
      .toMatch(/above the maximum 16/)
  })

  it('reports a string longer than its limit', () => {
    const limited = declare({ label: { kind: 'string', maxLength: 3 } })
    expect(validateProps(limited, { label: 'abcdef' })[0]?.code).toBe('too-long')
  })

  it('reports a value stranded on a hidden control', () => {
    // Invisible in the panel but still passed to the component, which is how a value
    // nobody can see ends up affecting the output.
    const conditional = declare({
      fill: { kind: 'enum', options: ['solid', 'gradient'] },
      endColor: { kind: 'color', hidden: { prop: 'fill', equals: ['solid'] } },
    })
    expect(validateProps(conditional, { fill: 'solid', endColor: '#fff' })[0]?.code)
      .toBe('set-while-hidden')
  })
})

describe('resolving props for render', () => {
  it('applies defaults under declared values', () => {
    const declaration = declare({
      title: { kind: 'string', defaultValue: 'Default' },
      size: { kind: 'enum', options: ['sm', 'lg'], defaultValue: 'sm' },
    })
    expect(resolveProps(declaration, { title: 'Given' }))
      .toEqual({ title: 'Given', size: 'sm' })
  })

  it('drops a hidden control so the render agrees with the panel', () => {
    const declaration = declare({
      fill: { kind: 'enum', options: ['solid', 'gradient'], defaultValue: 'solid' },
      endColor: { kind: 'color', defaultValue: '#000', hidden: { prop: 'fill', equals: ['solid'] } },
    })
    expect(resolveProps(declaration, {})).toEqual({ fill: 'solid' })
  })

  it('keeps it once the condition no longer holds', () => {
    const declaration = declare({
      fill: { kind: 'enum', options: ['solid', 'gradient'], defaultValue: 'solid' },
      endColor: { kind: 'color', defaultValue: '#000', hidden: { prop: 'fill', equals: ['solid'] } },
    })
    expect(resolveProps(declaration, { fill: 'gradient' }))
      .toEqual({ fill: 'gradient', endColor: '#000' })
  })
})
