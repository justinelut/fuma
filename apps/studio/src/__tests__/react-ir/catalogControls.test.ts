/**
 * Promoting a catalog component into the code-component pipeline.
 *
 * The gap this closes is silent in both directions: the canvas could not offer a properties
 * panel for a catalog component because nothing declared its props, and an insertion could
 * pass any prop with any value — a misspelled name was stored, the component rendered without
 * it, and the designer saw an element missing its text with nothing reporting a problem.
 */

import { describe, it, expect } from 'bun:test'
import {
  checkInsertionProps,
  deriveControls,
  humanise,
  isVisuallyEditable,
} from '@core/react-ir/catalogControls'
import { propsInterfaceSourceOf, validateControls } from '@core/react-ir/propertyControls'

const heroSource = `import type { ReactNode } from 'react'

export interface HeroProps {
  title: string
  subtitle?: string
  count: number
  featured: boolean
  align: 'left' | 'center' | 'right'
  children?: ReactNode
}

export function Hero(props: HeroProps) { return <section /> }
`

const derived = deriveControls('hero', heroSource)

describe('controls are derived from the component own source', () => {
  it('derives a string control', () => {
    expect(derived.declaration.controls['title']).toEqual({
      kind: 'string', title: 'Title', required: true,
    })
  })

  it('derives number and boolean controls', () => {
    expect(derived.declaration.controls['count']?.kind).toBe('number')
    expect(derived.declaration.controls['featured']?.kind).toBe('boolean')
  })

  it('derives a string-literal union as an enum with its options', () => {
    // Exactly the case a select control exists for.
    const control = derived.declaration.controls['align']
    expect(control?.kind).toBe('enum')
    expect((control as { options?: string[] }).options).toEqual(['left', 'center', 'right'])
  })

  it('derives ReactNode as a node control, which is the slot shape', () => {
    expect(derived.declaration.controls['children']?.kind).toBe('node')
  })

  it('takes requiredness from the interface, so panel and signature cannot disagree', () => {
    expect(derived.declaration.controls['title']?.required).toBe(true)
    expect(derived.declaration.controls['subtitle']?.required).toBe(false)
  })

  it('produces a declaration the control validator accepts', () => {
    // A derived declaration that the model itself rejects would put a broken panel on screen.
    expect(validateControls(derived.declaration)).toEqual([])
  })

  it('round-trips back to the same interface members', () => {
    const regenerated = propsInterfaceSourceOf('Hero', derived.declaration)
    for (const member of [
      'title: string', 'subtitle?: string', 'count: number', 'featured: boolean',
      'align: "left" | "center" | "right"', 'children?: ReactNode',
    ]) {
      expect(regenerated).toContain(member)
    }
  })

  it('emits no member the component does not declare', () => {
    // The regenerated interface is checked for absences too: a phantom prop would be demanded
    // at insertion and would never be read.
    expect(propsInterfaceSourceOf('Hero', derived.declaration)).not.toContain('Item')
  })
})

describe('what cannot be derived is reported rather than guessed', () => {
  it('reports a function prop instead of inventing a control', () => {
    // A control of the wrong kind is an editor that writes values the component will not
    // accept, which is worse than the prop being absent from the panel.
    const result = deriveControls('x', `export interface XProps { onPick?: (n: number) => void }`)
    expect(result.notes.some((note) => note.code === 'unsupported-type' && note.prop === 'onPick'))
      .toBe(true)
    expect(result.declaration.controls['onPick']).toBeUndefined()
  })

  it('reports an array and says why the model cannot express it yet', () => {
    // Every declared control is treated as a prop, so a companion item control would add a
    // prop the component does not take.
    const result = deriveControls('x', `export interface XProps { tags?: string[] }`)
    const note = result.notes.find((candidate) => candidate.prop === 'tags')
    expect(note?.message).toContain('does not take')
    expect(result.declaration.controls['tags']).toBeUndefined()
  })

  it('reports a component with no props interface', () => {
    const result = deriveControls('bare', `export function Bare() { return <div /> }`)
    expect(result.notes[0]?.code).toBe('no-props-interface')
    expect(result.declaration.controls).toEqual({})
  })

  it('treats a component with no props as installable but not editable', () => {
    // It still renders; it simply has nothing to configure. Saying so beats an empty panel
    // that looks broken.
    const result = deriveControls('bare', `export function Bare() { return <div /> }`)
    expect(isVisuallyEditable(result)).toBe(false)
    expect(isVisuallyEditable(derived)).toBe(true)
  })

  it('prefers an interface named Props over another', () => {
    const source = `interface Other { a: string }
export interface CardProps { title: string }
`
    expect(Object.keys(deriveControls('card', source).declaration.controls)).toEqual(['title'])
  })

  it('does not guess among several unnamed interfaces', () => {
    const source = `interface A { a: string }
interface B { b: string }
`
    expect(deriveControls('x', source).notes[0]?.code).toBe('no-props-interface')
  })
})

describe('insertion prop values are checked against the declaration', () => {
  it('accepts values that match', () => {
    const check = checkInsertionProps(derived.declaration, {
      title: 'Hello', count: 2, featured: true, align: 'left',
    })
    expect(check.accepted).toBe(true)
    expect(check.problems).toEqual([])
  })

  it('catches a misspelled prop name', () => {
    // Previously stored without complaint: the component rendered without its title and the
    // designer saw a missing heading with nothing reporting why.
    const check = checkInsertionProps(derived.declaration, {
      titel: 'Hello', count: 2, featured: true, align: 'left',
    })
    expect(check.accepted).toBe(false)
    expect(check.problems.some((problem) => problem.code === 'unknown-prop')).toBe(true)
    expect(check.problems.some((problem) => problem.code === 'missing-required')).toBe(true)
  })

  it('catches a wrong-typed value', () => {
    const check = checkInsertionProps(derived.declaration, {
      title: 'Hello', count: 'two', featured: true, align: 'left',
    })
    expect(check.problems.find((problem) => problem.code === 'wrong-type')?.message)
      .toContain('expects number')
  })

  it('catches a value outside the declared options', () => {
    const check = checkInsertionProps(derived.declaration, {
      title: 'Hello', count: 2, featured: true, align: 'middle',
    })
    expect(check.problems.some((problem) => problem.code === 'not-an-option')).toBe(true)
  })

  it('catches a missing required prop', () => {
    const check = checkInsertionProps(derived.declaration, { count: 2, featured: true, align: 'left' })
    expect(check.problems.some((problem) => problem.code === 'missing-required')).toBe(true)
  })

  it('does not demand an optional prop', () => {
    const check = checkInsertionProps(derived.declaration, {
      title: 'Hello', count: 2, featured: true, align: 'left',
    })
    expect(check.problems.some((problem) => problem.propName === 'subtitle')).toBe(false)
  })
})

describe('labels are readable', () => {
  it('splits camelCase', () => {
    // A panel full of camelCase reads as a debug view rather than an interface.
    expect(humanise('ctaLabel')).toBe('Cta label')
  })

  it('handles snake and kebab case', () => {
    expect(humanise('hero_title')).toBe('Hero title')
    expect(humanise('hero-title')).toBe('Hero title')
  })

  it('leaves a single word capitalised', () => {
    expect(humanise('title')).toBe('Title')
  })
})

describe('derivation is not stored', () => {
  it('produces the same result from the same source every time', () => {
    // Derived rather than stored deliberately: a stored copy drifts the moment somebody edits
    // the component, and then the panel offers a prop the component no longer takes.
    expect(JSON.stringify(deriveControls('hero', heroSource)))
      .toBe(JSON.stringify(deriveControls('hero', heroSource)))
  })

  it('follows a source change immediately', () => {
    const changed = deriveControls('hero', heroSource.replace('title: string', 'heading: string'))
    expect(changed.declaration.controls['heading']).toBeDefined()
    expect(changed.declaration.controls['title']).toBeUndefined()
  })
})
