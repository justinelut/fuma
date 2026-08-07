/**
 * Task 74: the AI authors components first and composes pages from them.
 *
 * Measured against real IR modules built with the shipped schema, and asserted in BOTH directions -
 * the check must fire on a wall of inline markup and must NOT fire on a section already composed from
 * shadcn components, because that second shape is exactly what task 71 requires.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import {
  COMPONENT_FIRST_RULE,
  COMPOSED_CHILD_RATIO,
  SECTION_DESCENDANT_THRESHOLD,
  isComponentFirst,
  measureSections,
  reviewComponentFirst,
} from '../../core/ai/componentFirst'
import { ReactIrModuleSchema, REACT_IR_VERSION, type ReactIrModule } from '../../core/react-ir/nodes'
import { kindForAuthoredPath, validateAuthoredModule } from '../../core/ai/tsxAuthoring'

const STUDIO = join(import.meta.dir, '..', '..', '..')

/** Builds a real module so the measurement runs against the shipped schema, not a stand-in. */
function moduleOf(
  kind: ReactIrModule['kind'],
  nodes: Record<string, unknown>,
  rootNodeId = 'root',
): ReactIrModule {
  const built = {
    version: REACT_IR_VERSION,
    // The module carries its own id, and propsInterface is an ARRAY of control declarations rather
    // than a record - both established by reading the shipped schema's validation errors rather than
    // by assuming the shape.
    id: 'module-under-test',
    path: kind === 'component' ? 'components/Thing.tsx' : 'app/page.tsx',
    symbol: kind === 'component' ? 'Thing' : 'Page',
    kind,
    boundary: 'server',
    rootNodeId,
    nodes,
    propsInterface: [],
  } as unknown as ReactIrModule
  // Asserting validity here means a schema change surfaces as a failure in this file rather than as
  // a measurement quietly running over a shape the engine would refuse.
  expect(Value.Check(ReactIrModuleSchema, built)).toBe(true)
  return built
}

function element(id: string, children: readonly string[] = []) {
  return { id, kind: 'element', tag: 'div', attributes: {}, children: [...children] }
}

function component(id: string, children: readonly string[] = []) {
  // The real schema nests the library reference rather than putting symbol/source on the node.
  return {
    id,
    kind: 'component',
    component: { id: 'ui.card', symbol: 'Card', source: '@/components/ui/card' },
    children: [...children],
  }
}

/** A section of raw markup with enough descendants to cross the threshold. */
function inlineSection(prefix: string, size: number) {
  const childIds = Array.from({ length: size }, (_, i) => `${prefix}-${i}`)
  const nodes: Record<string, unknown> = { [prefix]: element(prefix, childIds) }
  for (const id of childIds) nodes[id] = element(id)
  return { nodes, childIds }
}

describe('a wall of inline markup is reported', () => {
  const section = inlineSection('hero', SECTION_DESCENDANT_THRESHOLD + 2)
  const page = moduleOf('page', {
    root: element('root', ['hero']),
    ...section.nodes,
  })

  it('the section is measured as needing extraction', () => {
    const measured = measureSections(page)
    expect(measured).toHaveLength(1)
    expect(measured[0]!.shouldExtract).toBe(true)
    expect(measured[0]!.composed).toBe(false)
  })

  it('and the note names the real cost rather than a style preference', () => {
    const notes = reviewComponentFirst(page)
    expect(notes.map((n) => n.code)).toContain('section-not-extracted')
    const message = notes.find((n) => n.code === 'section-not-extracted')!.message
    expect(message).toContain('no properties panel')
    expect(message).toContain('editing source')
  })

  it('and the note carries the node id, so a message points at the section not the page', () => {
    const notes = reviewComponentFirst(page)
    expect(notes.find((n) => n.code === 'section-not-extracted')!.nodeId).toBe('hero')
  })

  it('so the page is not component-first', () => {
    expect(isComponentFirst(page)).toBe(false)
  })
})

describe('THE REFINEMENT: a section built from shadcn components is NOT flagged', () => {
  it('because that is precisely the shape task 71 requires', () => {
    // Ten component children, well past the size threshold. Flagging this would punish the behaviour
    // the sibling rule demands, and a check that fights its own family gets ignored.
    const cardIds = Array.from({ length: 10 }, (_, i) => `card-${i}`)
    const nodes: Record<string, unknown> = {
      root: element('root', ['features']),
      features: element('features', cardIds),
    }
    for (const id of cardIds) nodes[id] = component(id)
    const page = moduleOf('page', nodes)

    const measured = measureSections(page)
    expect(measured[0]!.descendantCount).toBeGreaterThan(SECTION_DESCENDANT_THRESHOLD)
    expect(measured[0]!.composed).toBe(true)
    expect(measured[0]!.shouldExtract).toBe(false)
    expect(reviewComponentFirst(page)).toHaveLength(0)
  })

  it('a container wrapping components counts as composed even with a heading beside them', () => {
    // `<section><h2/><Card/><Card/></section>` is the right shape, so demanding EVERY child be a
    // component would flag it. Half is the bar.
    const page = moduleOf('page', {
      root: element('root', ['features']),
      features: element('features', ['heading', 'a', 'b']),
      heading: element('heading'),
      a: component('a'),
      b: component('b'),
    })
    expect(measureSections(page)[0]!.composed).toBe(true)
  })

  it('and the ratio is stated rather than implied', () => {
    expect(COMPOSED_CHILD_RATIO).toBeGreaterThan(0)
    expect(COMPOSED_CHILD_RATIO).toBeLessThanOrEqual(1)
  })

  it('a section that is ITSELF a component needs no extracting', () => {
    const page = moduleOf('page', {
      root: element('root', ['hero']),
      hero: component('hero'),
    })
    expect(measureSections(page)[0]!.composed).toBe(true)
    expect(reviewComponentFirst(page)).toHaveLength(0)
  })
})

describe('a short page is left alone', () => {
  it('because a threshold is a judgement and refusing a simple page would be wrong', () => {
    const page = moduleOf('page', {
      root: element('root', ['intro']),
      intro: element('intro', ['h', 'p']),
      h: element('h'),
      p: element('p'),
    })
    expect(measureSections(page)[0]!.shouldExtract).toBe(false)
    expect(reviewComponentFirst(page)).toHaveLength(0)
  })
})

describe('the strongest signal is its own problem', () => {
  it('a large page composing NOTHING is reported separately from any one section', () => {
    // Three sections EACH below the per-section bar (7 descendants against a threshold of 8) that
    // together make a page where nothing at all is configurable - which no single section note
    // would catch, because no single section is the problem.
    const a = inlineSection('a', 6)
    const b = inlineSection('b', 6)
    const c = inlineSection('c', 6)
    const page = moduleOf('page', {
      root: element('root', ['a', 'b', 'c']),
      ...a.nodes,
      ...b.nodes,
      ...c.nodes,
    })
    const notes = reviewComponentFirst(page)
    // Proving the distinction: no section is individually flagged, and the page still is.
    expect(notes.map((n) => n.code)).not.toContain('section-not-extracted')
    expect(notes.map((n) => n.code)).toContain('page-composes-nothing')
    expect(notes.find((n) => n.code === 'page-composes-nothing')!.message).toContain('source edit')
  })

  it('and it does NOT fire once the page composes anything', () => {
    const a = inlineSection('a', 5)
    const page = moduleOf('page', {
      root: element('root', ['a', 'c']),
      ...a.nodes,
      c: component('c'),
    })
    expect(reviewComponentFirst(page).map((n) => n.code)).not.toContain('page-composes-nothing')
  })
})

describe('a component module is not asked to extract itself', () => {
  it('which would be asking an author to extract the thing they just extracted', () => {
    const section = inlineSection('body', SECTION_DESCENDANT_THRESHOLD + 4)
    const built = moduleOf('component', {
      root: element('root', ['body']),
      ...section.nodes,
    })
    expect(reviewComponentFirst(built)).toHaveLength(0)
  })

  it('but a LAYOUT is reviewed, because it composes too', () => {
    const section = inlineSection('chrome', SECTION_DESCENDANT_THRESHOLD + 4)
    const built = moduleOf('layout', {
      root: element('root', ['chrome']),
      ...section.nodes,
    })
    expect(reviewComponentFirst(built).length).toBeGreaterThan(0)
  })
})

describe('degenerate input is handled rather than crashing the review', () => {
  it('a module whose root id is missing reports nothing instead of throwing', () => {
    const built = moduleOf('page', { root: element('root') }, 'root')
    const broken = { ...built, rootNodeId: 'absent' } as ReactIrModule
    expect(() => reviewComponentFirst(broken)).not.toThrow()
    expect(measureSections(broken)).toHaveLength(0)
  })

  it('a child id with no node does not count as a section', () => {
    const built = moduleOf('page', { root: element('root', ['ghost']) })
    expect(measureSections(built)).toHaveLength(0)
  })
})

describe('the prompt and the check name the same property', () => {
  const prompt = readFileSync(join(STUDIO, 'src/core/ai/tsxAuthoringPrompt.ts'), 'utf8')

  it('the prompt instructs section-per-component authoring', () => {
    expect(prompt).toContain('Author each SECTION as its own component')
  })

  it('and states the SAME reason the check reports', () => {
    // A prompt whose reason differs from the review's teaches one thing and enforces another.
    expect(prompt).toContain('NO properties panel')
    expect(prompt).toContain('editing source')
    expect(COMPONENT_FIRST_RULE.why).toContain('editing source')
  })

  it('and carries the shadcn exception, or it would contradict task 71', () => {
    expect(prompt).toContain('already composed')
    expect(COMPONENT_FIRST_RULE.exception).toContain('shadcn')
  })

  it('and says a short page may be one file, matching the report-not-refuse behaviour', () => {
    expect(prompt).toContain('A short page can be one file')
    expect(COMPONENT_FIRST_RULE.smallPages).toContain('reports rather than refuses')
  })
})

describe('the review is WIRED into authoring, not merely declared', () => {
  it('a page authored as one wall of markup comes back with the note', () => {
    // The lesson from tasks 20, 52 and 68: a check nobody calls is safe and useless. This asserts the
    // real validateAuthoredModule surfaces it, by authoring source rather than constructing IR.
    const sections = Array.from({ length: 12 }, (_, i) => `      <p className="text-sm">Line ${i}</p>`).join('\n')
    const result = validateAuthoredModule({
      target: { path: 'app/page.tsx' },
      source: `export default function Page(props: PageProps) {\n  return (\n    <main className="p-8">\n      <section className="grid">\n${sections}\n      </section>\n    </main>\n  )\n}\n`,
    } as Parameters<typeof validateAuthoredModule>[0])

    expect(result.notes.map((n) => n.code)).toContain('section-not-extracted')
  })

  it('and it does NOT change acceptance, because a one-file page is valid source', () => {
    const sections = Array.from({ length: 12 }, (_, i) => `      <p>Line ${i}</p>`).join('\n')
    const result = validateAuthoredModule({
      target: { path: 'app/page.tsx' },
      source: `export default function Page(props: PageProps) {\n  return (\n    <main>\n      <section>\n${sections}\n      </section>\n    </main>\n  )\n}\n`,
    } as Parameters<typeof validateAuthoredModule>[0])

    expect(result.notes.length).toBeGreaterThan(0)
    expect(result.accepted).toBe(true)
  })

  it('a refused path carries no composition advice, because nothing was read', () => {
    const result = validateAuthoredModule({
      target: { path: 'etc/passwd' },
      source: 'export default function X() { return <div /> }',
    } as Parameters<typeof validateAuthoredModule>[0])
    expect(result.accepted).toBe(false)
    expect(result.notes).toHaveLength(0)
  })

  it('the kind is derived from the path so it cannot disagree with the file', () => {
    expect(kindForAuthoredPath('app/page.tsx')).toBe('page')
    expect(kindForAuthoredPath('app/blog/layout.tsx')).toBe('layout')
    expect(kindForAuthoredPath('components/Hero.tsx')).toBe('component')
  })
})

describe('the threshold is a stated judgement', () => {
  it('bounded so it cannot drift into flagging everything or nothing', () => {
    expect(SECTION_DESCENDANT_THRESHOLD).toBeGreaterThanOrEqual(4)
    expect(SECTION_DESCENDANT_THRESHOLD).toBeLessThanOrEqual(30)
  })

  it('and the rule records why it reports rather than refuses', () => {
    expect(COMPONENT_FIRST_RULE.smallPages).toContain('judgement rather than a fact')
  })
})
