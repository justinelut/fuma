/**
 * Task 61: the built-in modules converted to React.
 *
 * The central claim - that only ONE built-in has behaviour - is asserted against the shipped
 * modules rather than restated, because the whole classification rests on it.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONVERSION_SUMMARY,
  MODULE_CONVERSIONS,
  conversionFor,
  retires,
  reviewConversion,
} from '../../core/react-ir/moduleConversion'
import { ReactIrModuleSchema } from '../../core/react-ir/nodes'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const BASE = join(STUDIO, 'src/modules/base')

describe('the finding the classification rests on', () => {
  it('exactly one built-in module ships client JavaScript', () => {
    // Read the shipped tree: if a second one grows behaviour, this fails and the classification
    // gets revisited rather than quietly becoming wrong.
    const dirs = readdirSync(BASE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const withJs = dirs.filter((dir) => {
      const files = readdirSync(join(BASE, dir))
      return files.some((file) => /RuntimeJs|moduleJs/i.test(file))
    })
    expect(withJs).toEqual(['forms'])
  })

  it('and the rest resolve to an HTML tag', () => {
    for (const dir of ['body', 'image', 'link', 'list', 'svg']) {
      const index = join(BASE, dir, 'index.ts')
      expect(existsSync(index)).toBe(true)
      expect(readFileSync(index, 'utf8')).toContain('htmlTag:')
    }
  })
})

describe('most built-ins retire rather than become components', () => {
  it('nine are plain elements', () => {
    expect(CONVERSION_SUMMARY.nativeElements).toBe(9)
  })

  it('four were structure the node union already models', () => {
    expect(CONVERSION_SUMMARY.enginePrimitives).toBe(4)
  })

  it('and exactly one becomes a React component', () => {
    expect(CONVERSION_SUMMARY.reactComponents).toBe(1)
  })

  it('the component is the one with behaviour', () => {
    const form = conversionFor('base.form')
    expect(form?.kind).toBe('react-component')
    expect(form?.reason).toContain('client behaviour')
  })

  it('the summary states WHY a component per element would be worse', () => {
    expect(CONVERSION_SUMMARY.note).toContain('generated source worse')
    expect(CONVERSION_SUMMARY.note).toContain('our runtime')
  })
})

describe('native elements carry the tags they resolve to', () => {
  it('text offers the heading and paragraph tags', () => {
    const text = conversionFor('base.text')
    expect(text?.kind).toBe('native-element')
    expect(text?.tags).toContain('h1')
    expect(text?.tags).toContain('p')
  })

  it('and the tag set agrees with the shipped module', () => {
    // The mapping is checkable rather than asserted: base.text's own tag vocabulary must contain
    // every tag the conversion claims.
    const tags = readFileSync(join(BASE, 'text/tags.ts'), 'utf8')
    for (const tag of conversionFor('base.text')!.tags!) {
      expect(tags).toContain(`'${tag}'`)
    }
  })

  it('a button may be an anchor, which is a tag decision not a component one', () => {
    expect(conversionFor('base.button')?.tags).toEqual(['button', 'a'])
  })

  it('body has nowhere left to exist under Next', () => {
    expect(conversionFor('base.body')?.reason).toContain('layout.tsx')
  })

  it('every native element states one tag or more', () => {
    for (const entry of MODULE_CONVERSIONS.filter((e) => e.kind === 'native-element')) {
      expect(entry.tags?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('engine primitives map onto node kinds that already exist', () => {
  it('a loop is a repeat node', () => {
    expect(conversionFor('base.loop')?.nodeKind).toBe('repeat')
  })

  it('an outlet is Next\'s own children', () => {
    const outlet = conversionFor('base.outlet')
    expect(outlet?.nodeKind).toBe('outlet')
    expect(outlet?.reason).toContain('props.children')
  })

  it('a slot outlet is the same hole under another name', () => {
    expect(conversionFor('base.slot-outlet')?.nodeKind).toBe('outlet')
    expect(conversionFor('base.slot-outlet')?.reason).toContain('two mechanisms')
  })

  it('a visual component reference is a component node', () => {
    expect(conversionFor('base.visual-component-ref')?.nodeKind).toBe('component')
  })

  it('and every node kind named is one the IR really declares', () => {
    // Naming a kind the union does not have would make the map unimplementable.
    const declared = JSON.stringify(ReactIrModuleSchema)
    for (const entry of MODULE_CONVERSIONS.filter((e) => e.kind === 'engine-primitive')) {
      expect(declared).toContain(`"${entry.nodeKind}"`)
    }
  })
})

describe('retirement is offered as a predicate', () => {
  it('elements and primitives retire', () => {
    expect(retires(conversionFor('base.text')!)).toBe(true)
    expect(retires(conversionFor('base.loop')!)).toBe(true)
  })

  it('the form does not', () => {
    expect(retires(conversionFor('base.form')!)).toBe(false)
  })

  it('thirteen of the fourteen mapped modules retire', () => {
    expect(MODULE_CONVERSIONS.filter(retires)).toHaveLength(13)
  })
})

describe('an unknown module is not guessed at', () => {
  it('returns null rather than defaulting to an element', () => {
    // A plugin's module is exactly the unknown case, and defaulting would drop its behaviour.
    expect(conversionFor('acme.carousel')).toBeNull()
  })
})

describe('the review catches the mistake a bulk rewrite makes', () => {
  it('converting a behaving module to a plain element is refused', () => {
    const problems = reviewConversion({
      moduleId: 'base.form',
      kind: 'native-element',
      shipsClientJs: true,
      resolvesToHtmlTag: true,
    })
    expect(problems.map((p) => p.code)).toContain('behaviour-dropped')
  })

  it('and the message says why the loss is easy to miss', () => {
    const problems = reviewConversion({
      moduleId: 'base.form',
      kind: 'native-element',
      shipsClientJs: true,
      resolvesToHtmlTag: true,
    })
    expect(problems[0]!.message).toContain('still renders')
  })

  it('a needless component is flagged too', () => {
    const problems = reviewConversion({
      moduleId: 'base.text',
      kind: 'react-component',
      shipsClientJs: false,
      resolvesToHtmlTag: true,
    })
    expect(problems.map((p) => p.code)).toContain('needless-component')
  })

  it('a module with no tag cannot become an element', () => {
    const problems = reviewConversion({
      moduleId: 'base.loop',
      kind: 'native-element',
      shipsClientJs: false,
      resolvesToHtmlTag: false,
    })
    expect(problems.map((p) => p.code)).toContain('no-tag-to-become')
  })

  it('and every conversion this module itself declares reviews clean', () => {
    // A classification that fails its own review would be self-contradictory.
    for (const entry of MODULE_CONVERSIONS) {
      const problems = reviewConversion({
        moduleId: entry.moduleId,
        kind: entry.kind,
        shipsClientJs: entry.kind === 'react-component',
        resolvesToHtmlTag: entry.kind === 'native-element',
      })
      expect(problems).toHaveLength(0)
    }
  })
})

describe('every entry justifies itself', () => {
  it('with a reason long enough to be a reason', () => {
    for (const entry of MODULE_CONVERSIONS) {
      expect(entry.reason.length).toBeGreaterThan(40)
    }
  })

  it('and no module is mapped twice', () => {
    const ids = MODULE_CONVERSIONS.map((entry) => entry.moduleId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
