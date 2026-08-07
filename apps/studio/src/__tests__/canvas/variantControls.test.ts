/**
 * The link that finally lets task 72's cva controls reach a panel.
 *
 * Task 72 derived variant controls from a shadcn component's own source and nothing consumed them, for
 * two reasons: no edit op could apply a chosen value (now `setComponentProp`), and a component node
 * stores a module SPECIFIER rather than source, so a panel holding a node could not reach the variants.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  pathForSpecifier,
  variantControlsFor,
  currentPropValue,
} from '@site/panels/ReactPropertiesPanel/variantControls'
import type { ModuleStore } from '@core/react-ir/workspace'

/** The REAL shipped button, so the test cannot pass against a fixture that flatters the deriver. */
const REAL_BUTTON = readFileSync(
  join(import.meta.dir, '..', '..', 'admin', 'fuma', 'ui', 'button.tsx'), 'utf8')
const REAL_CARD = readFileSync(
  join(import.meta.dir, '..', '..', 'admin', 'fuma', 'ui', 'card.tsx'), 'utf8')

function storeWith(entries: Readonly<Record<string, string>>): ModuleStore {
  return {
    async get(path) {
      const source = entries[path]
      return source === undefined ? null : { source, hash: 'h', updatedAt: '' }
    },
    async put() {}, async delete() {},
    async list() { return Object.keys(entries) },
  }
}

describe('resolving a specifier to a repository path', () => {
  it('maps the tenant alias onto a .tsx file', () => {
    expect(pathForSpecifier('@/components/ui/button')).toBe('components/ui/button.tsx')
  })

  it('leaves an explicit .tsx alone rather than doubling the extension', () => {
    expect(pathForSpecifier('@/components/Hero.tsx')).toBe('components/Hero.tsx')
  })

  it('returns NULL for a bare package', () => {
    // Guessing a path for 'react' produces a read that always fails and a panel that always looks
    // broken.
    expect(pathForSpecifier('react')).toBeNull()
    expect(pathForSpecifier('lucide-react')).toBeNull()
  })

  it('refuses traversal', () => {
    expect(pathForSpecifier('@/../secrets')).toBeNull()
  })
})

describe('deriving controls from the REAL shipped button', () => {
  it('produces variant and size controls', async () => {
    const outcome = await variantControlsFor(
      '@/components/ui/button',
      storeWith({ 'components/ui/button.tsx': REAL_BUTTON }),
    )
    expect(outcome.kind).toBe('controls')
    if (outcome.kind !== 'controls') return
    // Measured against the shipped file rather than asserted from memory.
    expect(Object.keys(outcome.controls).sort()).toEqual(['size', 'variant'])
  })

  it('carries the real option set, so the panel offers what the component accepts', async () => {
    const outcome = await variantControlsFor(
      '@/components/ui/button',
      storeWith({ 'components/ui/button.tsx': REAL_BUTTON }),
    )
    if (outcome.kind !== 'controls') throw new Error('expected controls')
    const variant = outcome.controls['variant'] as { options?: readonly string[] }
    expect(variant.options).toContain('destructive')
    expect(variant.options).toContain('ghost')
    // A partial option set is worse than none, because the missing ones look unavailable.
    expect(variant.options!.length).toBeGreaterThanOrEqual(5)
  })
})

describe('no variants is NOT the same as could not look', () => {
  it('reports none for a component that genuinely has no variants', async () => {
    // card is plain styled markup with no cva variants at all - that is not a fault.
    const outcome = await variantControlsFor(
      '@/components/ui/card',
      storeWith({ 'components/ui/card.tsx': REAL_CARD }),
    )
    expect(outcome.kind).toBe('none')
    if (outcome.kind === 'none') expect(outcome.reason.length).toBeGreaterThan(10)
  })

  it('reports UNAVAILABLE when the file is missing', async () => {
    // Reporting a failed read as "this component has no options" is a claim about the component when
    // the truth is about us, and it sends somebody looking for a bug in their own file.
    const outcome = await variantControlsFor('@/components/ui/button', storeWith({}))
    expect(outcome.kind).toBe('unavailable')
  })

  it('reports UNAVAILABLE when the read throws, carrying the reason', async () => {
    const exploding: ModuleStore = {
      async get() { throw new Error('network down') },
      async put() {}, async delete() {}, async list() { return [] },
    }
    const outcome = await variantControlsFor('@/components/ui/button', exploding)
    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('network down')
  })

  it('reports UNAVAILABLE for a bare package rather than pretending it has none', async () => {
    const outcome = await variantControlsFor('lucide-react', storeWith({}))
    expect(outcome.kind).toBe('unavailable')
  })
})

describe('reading the value a node currently has', () => {
  it('returns the literal a prop carries', () => {
    const props = { variant: { kind: 'expression', expression: { kind: 'literal', value: 'ghost' } } }
    expect(currentPropValue(props, 'variant')).toBe('ghost')
  })

  it('returns undefined for an ABSENT prop rather than the cva default', () => {
    // Absent means the component decides. Showing its default as though it were chosen would make the
    // panel claim a decision nobody made.
    expect(currentPropValue({}, 'variant')).toBeUndefined()
    expect(currentPropValue(undefined, 'variant')).toBeUndefined()
  })

  it('returns undefined for a NON-literal prop rather than a misleading value', () => {
    // A member read is data binding, which a select cannot express; showing something would invite
    // overwriting the binding with a constant.
    const bound = { variant: { kind: 'expression', expression: { kind: 'member', scope: 'item', path: ['v'] } } }
    expect(currentPropValue(bound, 'variant')).toBeUndefined()
  })

  it('returns undefined for a node-valued prop', () => {
    const slot = { children: { kind: 'nodes', children: ['a'] } }
    expect(currentPropValue(slot, 'children')).toBeUndefined()
  })
})
