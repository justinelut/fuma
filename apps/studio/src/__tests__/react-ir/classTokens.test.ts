import { describe, it, expect } from 'bun:test'
import {
  conflictKeyOf,
  isScannable,
  mergeClassTokens,
  parseClassString,
  parseClassToken,
  removeClassFamily,
  serializeClassToken,
  serializeClassTokens,
  splitClassString,
} from '@core/react-ir/classTokens'

describe('splitting a class attribute', () => {
  it('splits on whitespace in the ordinary case', () => {
    expect(splitClassString('mx-auto  px-6\n py-12')).toEqual(['mx-auto', 'px-6', 'py-12'])
  })

  it('keeps an arbitrary value containing a space as one token', () => {
    // The naive split produces `bg-[url('a` and `b.png')]`, neither of which is a
    // class, and Tailwind emits nothing for either.
    expect(splitClassString("bg-[url('a b.png')] p-4"))
      .toEqual(["bg-[url('a b.png')]", 'p-4'])
  })

  it('keeps nested brackets together', () => {
    expect(splitClassString('grid-cols-[repeat(2,minmax(0,1fr))] gap-2'))
      .toEqual(['grid-cols-[repeat(2,minmax(0,1fr))]', 'gap-2'])
  })

  it('respects an escaped character', () => {
    expect(splitClassString("content-['hello\\_world'] mt-2"))
      .toEqual(["content-['hello\\_world']", 'mt-2'])
  })

  it('returns nothing for an empty or blank attribute', () => {
    expect(splitClassString('')).toEqual([])
    expect(splitClassString('   \n  ')).toEqual([])
  })
})

describe('parsing a token', () => {
  it('reads a plain utility', () => {
    expect(parseClassToken('bg-primary')).toEqual({
      variants: [], base: 'bg-primary', important: false,
    })
  })

  it('reads stacked variants', () => {
    const token = parseClassToken('dark:md:hover:bg-primary')
    expect(token.variants).toEqual(['dark', 'md', 'hover'])
    expect(token.base).toBe('bg-primary')
  })

  it('does not treat a colon inside brackets as a variant separator', () => {
    // `supports-[display:grid]` is one variant; splitting on every colon would
    // produce a nonsense variant named `supports-[display`.
    const token = parseClassToken('supports-[display:grid]:grid')
    expect(token.variants).toEqual(['supports-[display:grid]'])
    expect(token.base).toBe('grid')
  })

  it('handles an arbitrary selector variant', () => {
    const token = parseClassToken('[&>*]:mt-2')
    expect(token.variants).toEqual(['[&>*]'])
    expect(token.base).toBe('mt-2')
  })

  it('handles a data-attribute variant', () => {
    const token = parseClassToken('data-[state=open]:rotate-180')
    expect(token.variants).toEqual(['data-[state=open]'])
    expect(token.base).toBe('rotate-180')
  })

  it('reads a slash modifier', () => {
    expect(parseClassToken('bg-primary/20')).toMatchObject({
      base: 'bg-primary', modifier: '20',
    })
  })

  it('does not mistake a slash inside a value for a modifier', () => {
    const token = parseClassToken('bg-[url(/images/a.png)]')
    expect(token.base).toBe('bg-[url(/images/a.png)]')
    expect(token.modifier).toBeUndefined()
  })

  it('accepts the important marker in either position', () => {
    // v4 places it last, v3 first. A token pasted from older code should be
    // understood rather than mangled.
    expect(parseClassToken('bg-red-500!').important).toBe(true)
    expect(parseClassToken('!bg-red-500').important).toBe(true)
    expect(parseClassToken('!bg-red-500').base).toBe('bg-red-500')
  })

  it('reads an arbitrary property', () => {
    const token = parseClassToken('[mask-type:luminance]')
    expect(token.variants).toEqual([])
    expect(token.base).toBe('[mask-type:luminance]')
  })
})

describe('serialising a token', () => {
  it('round-trips every form', () => {
    for (const token of [
      'bg-primary',
      'md:hover:bg-primary',
      'supports-[display:grid]:grid',
      'data-[state=open]:rotate-180',
      '[&>*]:mt-2',
      'bg-primary/20',
      "bg-[url('a b.png')]",
      '[mask-type:luminance]',
      'grid-cols-[repeat(2,minmax(0,1fr))]',
    ]) {
      expect(serializeClassToken(parseClassToken(token))).toBe(token)
    }
  })

  it('normalises the important marker to the v4 position', () => {
    expect(serializeClassToken(parseClassToken('!bg-red-500'))).toBe('bg-red-500!')
  })

  it('round-trips a whole attribute', () => {
    const input = "mx-auto md:px-6 bg-[url('a b.png')] bg-primary/20"
    expect(serializeClassTokens(parseClassString(input))).toBe(input)
  })
})

describe('conflict detection', () => {
  it('treats the same family under the same variants as conflicting', () => {
    expect(conflictKeyOf(parseClassToken('p-4'))).toBe(conflictKeyOf(parseClassToken('p-8')))
  })

  it('treats an arbitrary value as the same family as a scale step', () => {
    expect(conflictKeyOf(parseClassToken('top-[10px]')))
      .toBe(conflictKeyOf(parseClassToken('top-4')))
  })

  it('treats t-shirt sizes as the same family', () => {
    // The group that is easy to miss. Without it the whole type scale never
    // conflicts with itself and whichever class Tailwind emits last silently wins.
    expect(conflictKeyOf(parseClassToken('text-4xl')))
      .toBe(conflictKeyOf(parseClassToken('text-5xl')))
    expect(conflictKeyOf(parseClassToken('text-base')))
      .toBe(conflictKeyOf(parseClassToken('text-4xl')))
    expect(conflictKeyOf(parseClassToken('rounded-sm')))
      .toBe(conflictKeyOf(parseClassToken('rounded-lg')))
  })

  it('keeps overloaded prefixes apart', () => {
    // `text-` sets size, colour and alignment in Tailwind. Those are different
    // properties and collapsing them would replace an alignment with a font size.
    expect(conflictKeyOf(parseClassToken('text-4xl')))
      .not.toBe(conflictKeyOf(parseClassToken('text-center')))
    expect(conflictKeyOf(parseClassToken('text-4xl')))
      .not.toBe(conflictKeyOf(parseClassToken('text-primary')))
  })

  it('does not conflict across variants', () => {
    // `p-4` and `md:p-8` both apply, at different widths, so replacing one with
    // the other would destroy the responsive intent.
    expect(conflictKeyOf(parseClassToken('p-4')))
      .not.toBe(conflictKeyOf(parseClassToken('md:p-8')))
  })

  it('keys an arbitrary property by the property it sets', () => {
    expect(conflictKeyOf(parseClassToken('[mask-type:luminance]'))).toBe('|mask-type')
  })
})

describe('merging tokens', () => {
  it('replaces a conflicting token in place rather than appending', () => {
    // Appending would leave both in the attribute and make the outcome depend on
    // Tailwind's emission order, which an author should not have to reason about.
    expect(mergeClassTokens(['p-4', 'mx-auto'], ['p-8'])).toEqual(['p-8', 'mx-auto'])
  })

  it('keeps position stable so rendering order is unchanged', () => {
    expect(mergeClassTokens(['flex', 'p-4', 'gap-2'], ['p-8']))
      .toEqual(['flex', 'p-8', 'gap-2'])
  })

  it('adds a non-conflicting token at the end', () => {
    expect(mergeClassTokens(['flex'], ['gap-2'])).toEqual(['flex', 'gap-2'])
  })

  it('keeps a responsive override alongside its base', () => {
    expect(mergeClassTokens(['p-4'], ['md:p-8'])).toEqual(['p-4', 'md:p-8'])
  })

  it('collapses an exact duplicate', () => {
    expect(mergeClassTokens(['flex', 'p-4'], ['p-4'])).toEqual(['flex', 'p-4'])
  })

  it('normalises as it merges', () => {
    expect(mergeClassTokens([], ['!bg-red-500'])).toEqual(['bg-red-500!'])
  })
})

describe('removing a family', () => {
  it('clears every token targeting one property', () => {
    const tokens = ['flex', 'p-4', 'gap-2']
    const family = conflictKeyOf(parseClassToken('p-4'))
    expect(removeClassFamily(tokens, family)).toEqual(['flex', 'gap-2'])
  })
})

describe('scannability', () => {
  it('accepts a complete literal class', () => {
    expect(isScannable('bg-primary')).toBe(true)
    expect(isScannable('supports-[display:grid]:grid')).toBe(true)
  })

  it('rejects a class assembled at runtime', () => {
    // Tailwind's scanner sees literals only. A runtime-assembled class produces no
    // CSS and the element renders unstyled with no error, so it has to be refused
    // at the point of editing rather than discovered later.
    expect(isScannable('bg-${color}-500')).toBe(false)
    expect(isScannable('bg-{color}')).toBe(false)
  })
})
