import { describe, it, expect } from 'bun:test'
import { generateModule } from '@core/react-ir/generate'
import type { ReactIrModule } from '@core/react-ir/nodes'

function moduleWith(
  animation: Record<string, unknown>,
  boundary: 'server' | 'client' = 'client',
): ReactIrModule {
  return {
    version: 1,
    id: 'm1',
    path: 'app/page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary,
    rootNodeId: 'root',
    nodes: {
      root: {
        kind: 'element', id: 'root', tag: 'section',
        classTokens: ['grid'], animation, children: [],
      },
    },
  } as unknown as ReactIrModule
}

describe('emitting Motion', () => {
  it('uses the motion variant of the tag and imports the proxy', () => {
    // `motion.section` keeps the same DOM output as `section` and only adds
    // behaviour, so animating something never changes its markup.
    const { code } = generateModule(moduleWith({ animate: { opacity: 1 } }))
    expect(code).toContain("import { motion } from 'motion/react'")
    expect(code).toContain('<motion.section')
  })

  it('leaves an unanimated element as a plain tag with no Motion import', () => {
    const { code } = generateModule({
      version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      rootNodeId: 'root',
      nodes: { root: { kind: 'element', id: 'root', tag: 'section', classTokens: [], children: [] } },
    } as unknown as ReactIrModule)
    expect(code).not.toContain('motion')
    expect(code).toContain('<section')
  })

  it('emits variant names as strings and targets as objects', () => {
    const { code } = generateModule(moduleWith({
      initial: 'hidden',
      animate: 'visible',
      variants: { hidden: { target: { opacity: 0 } }, visible: { target: { opacity: 1 } } },
    }))
    expect(code).toContain('initial="hidden"')
    expect(code).toContain('animate="visible"')
    expect(code).toContain('variants={{"hidden":{"opacity":0},"visible":{"opacity":1}}}')
  })

  it('folds a variant transition into the variant, as Motion expects', () => {
    // Motion's variants are name -> target with transition inside, a flatter shape
    // than the model stores, so the generator has to flatten rather than pass through.
    const { code } = generateModule(moduleWith({
      variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.08 } } },
    }))
    expect(code).toContain('"visible":{"opacity":1,"transition":{"staggerChildren":0.08}}')
  })

  it('emits gestures as their own props', () => {
    const { code } = generateModule(moduleWith({
      gestures: { whileHover: { target: { scale: 1.05 } }, whileTap: { target: { scale: 0.97 } } },
    }))
    expect(code).toContain('whileHover={{"scale":1.05}}')
    expect(code).toContain('whileTap={{"scale":0.97}}')
  })

  it('emits a gesture that names a variant as a string', () => {
    const { code } = generateModule(moduleWith({
      variants: { hovered: { target: { scale: 1.05 } } },
      gestures: { whileHover: 'hovered' },
    }))
    expect(code).toContain('whileHover="hovered"')
  })

  it('emits boolean props bare', () => {
    // `layout` not `layout={true}`, matching how the prop is normally written.
    expect(generateModule(moduleWith({ layout: true })).code).toContain('layout />')
    expect(generateModule(moduleWith({ layout: 'position' })).code).toContain('layout="position"')
    expect(generateModule(moduleWith({ drag: 'x' })).code).toContain('drag="x"')
  })

  it('preserves keyframes and the wildcard exactly', () => {
    const { code } = generateModule(moduleWith({ animate: { x: [null, 100, 0] } }))
    expect(code).toContain('animate={{"x":[null,100,0]}}')
  })

  it('omits viewport options when nothing consumes them', () => {
    // `viewport` configures the in-view trigger. Without `whileInView` it does
    // nothing, and emitting it would suggest the options were applied.
    const withoutGesture = generateModule(moduleWith({ inView: { once: true } })).code
    expect(withoutGesture).not.toContain('viewport')

    const withGesture = generateModule(moduleWith({
      inView: { once: true },
      gestures: { whileInView: { target: { opacity: 1 } } },
    })).code
    expect(withGesture).toContain('viewport={{"once":true}}')
  })

  it('imports AnimatePresence when an exit animation is declared', () => {
    // An exit animation is never observed without an AnimatePresence ancestor, so
    // the import has to arrive with it.
    const { code } = generateModule(moduleWith({ exit: { opacity: 0 } }))
    expect(code).toContain("import { AnimatePresence, motion } from 'motion/react'")
  })

  it('stays deterministic across repeated generation', () => {
    const animation = {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      gestures: { whileTap: { target: { scale: 0.97 } }, whileHover: { target: { scale: 1.05 } } },
    }
    const first = generateModule(moduleWith(animation)).code
    const second = generateModule(moduleWith(animation)).code
    expect(first).toBe(second)
  })
})

describe('client boundary enforcement', () => {
  it('refuses to emit a Motion element from a server module', () => {
    // Motion runs in the browser. Emitting it without a client boundary produces
    // code that fails at runtime, and silently promoting the module would make a
    // whole route client-rendered without anyone choosing that.
    expect(() => generateModule(moduleWith({ animate: { opacity: 1 } }, 'server')))
      .toThrow(/boundary/)
  })

  it('names the offending node so the fix is obvious', () => {
    expect(() => generateModule(moduleWith({ animate: { opacity: 1 } }, 'server')))
      .toThrow(/"root"/)
  })

  it('allows a server module carrying only a transition', () => {
    // A transition alone animates nothing, so it must not force a boundary.
    expect(() => generateModule(moduleWith({ transition: { duration: 0.2 } }, 'server')))
      .not.toThrow()
  })
})
