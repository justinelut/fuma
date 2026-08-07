import { describe, it, expect } from 'bun:test'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import type { MotionAnimation } from '@core/react-ir/motion'
import type { ReactIrModule } from '@core/react-ir/nodes'

function read(source: string) {
  return readModuleSource('app/page.tsx', source)
}

function wrap(body: string): string {
  return `'use client'\n\nimport { motion } from 'motion/react'\n\n`
    + `export default function Page() {\n  return (\n    ${body}\n  )\n}\n`
}

describe('recovering Motion from source', () => {
  it('unwraps a motion tag back to the element it renders', () => {
    // The node models `section`; the animation is held separately and the prefix
    // is put back on the way out. Storing the tag as `motion.section` would make
    // every tag comparison in the editor wrong.
    const result = read(wrap('<motion.section className="grid" animate={{ opacity: 1 }} />'))
    const node = result.nodes[result.rootNodeId ?? '']
    expect(node?.kind).toBe('element')
    expect((node as { tag: string }).tag).toBe('section')
  })

  it('recovers targets, variant names and gestures', () => {
    const result = read(wrap(
      '<motion.div initial="hidden" animate="visible" '
      + 'variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} '
      + 'whileHover={{ scale: 1.05 }} />',
    ))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.initial).toBe('hidden')
    expect(animation?.animate).toBe('visible')
    expect(animation?.variants?.['hidden']).toEqual({ target: { opacity: 0 } })
    expect(animation?.gestures?.whileHover).toEqual({ target: { scale: 1.05 } })
  })

  it('splits a nested variant transition back out of the target', () => {
    // Motion nests transition inside the variant; the model keeps them apart so the
    // panel can edit either without rewriting the other.
    const result = read(wrap(
      '<motion.ul variants={{ visible: { opacity: 1, transition: { staggerChildren: 0.08 } } }} />',
    ))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.variants?.['visible']).toEqual({
      target: { opacity: 1 },
      transition: { staggerChildren: 0.08 },
    })
  })

  it('recovers a bare boolean prop', () => {
    const result = read(wrap('<motion.div layout />'))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.layout).toBe(true)
  })

  it('recovers keyframes including the null wildcard', () => {
    // The wildcard has to survive as null rather than being read as a failure,
    // because it is what keeps an interrupted animation smooth.
    const result = read(wrap('<motion.div animate={{ x: [null, 100, 0] }} />'))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.animate).toEqual({ x: [null, 100, 0] })
  })

  it('recovers a negative value', () => {
    const result = read(wrap('<motion.div animate={{ y: -24 }} />'))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.animate).toEqual({ y: -24 })
  })

  it('reads viewport back as the in-view options', () => {
    const result = read(wrap(
      '<motion.div whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.4 }} />',
    ))
    const animation = (result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation })
      .animation
    expect(animation?.inView).toEqual({ once: true, amount: 0.4 })
  })

  it('leaves an unanimated element without an animation', () => {
    // An empty animation object would clientize the module for no reason.
    const result = read(wrap('<section className="grid" />'))
    const node = result.nodes[result.rootNodeId ?? ''] as { animation?: MotionAnimation }
    expect(node.animation).toBeUndefined()
  })

  it('refuses a computed animation value with an explanation', () => {
    // A target assembled at runtime cannot be shown in the animation panel, so it
    // has to be refused rather than silently dropped.
    const result = read(wrap('<motion.div animate={buildTarget()} />'))
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('dynamic-expression-denied')
    expect(result.diagnostics[0]?.message).toMatch(/animation panel/)
  })

  it('does not treat Motion props as ordinary attributes', () => {
    // If they landed in the attribute bag the panel would show them as arbitrary
    // props and the animation editor would find nothing.
    const result = read(wrap('<motion.div animate={{ opacity: 1 }} id="hero" />'))
    const node = result.nodes[result.rootNodeId ?? ''] as {
      attributes: Record<string, unknown>
    }
    expect(Object.keys(node.attributes)).toEqual(['id'])
  })
})

describe('Motion round trip', () => {
  it('preserves an animation through generate and read', () => {
    const animation: MotionAnimation = {
      initial: 'hidden',
      animate: 'visible',
      layout: true,
      drag: 'x',
      variants: {
        hidden: { target: { opacity: 0, y: 12 } },
        visible: { target: { opacity: 1, y: 0 }, transition: { staggerChildren: 0.08 } },
      },
      gestures: { whileHover: { target: { scale: 1.05 } } },
    }
    const module = {
      version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      boundary: 'client', rootNodeId: 'root',
      nodes: {
        root: {
          kind: 'element', id: 'root', tag: 'section',
          classTokens: ['grid'], animation, children: [],
        },
      },
    } as unknown as ReactIrModule

    const generated = generateModule(module, { anchorComments: true })
    const result = read(generated.code)

    expect(result.diagnostics).toEqual([])
    expect(result.rootNodeId).toBe('root')
    const recovered = (result.nodes['root'] as { animation?: MotionAnimation }).animation
    // Deep equality, not string equality: key order is not part of the meaning.
    expect(recovered).toEqual(animation)
  })

  it('survives a second pass unchanged', () => {
    // Generating from what was read must reproduce the same source, or repeated
    // editing would drift.
    const module = {
      version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      boundary: 'client', rootNodeId: 'root',
      nodes: {
        root: {
          kind: 'element', id: 'root', tag: 'div', classTokens: ['flex'],
          animation: { animate: { opacity: 1 }, transition: { duration: 0.3 } },
          children: [],
        },
      },
    } as unknown as ReactIrModule

    const first = generateModule(module, { anchorComments: true })
    const readBack = read(first.code)
    const rebuilt = {
      ...module,
      nodes: readBack.nodes,
      rootNodeId: readBack.rootNodeId,
    } as unknown as ReactIrModule
    expect(generateModule(rebuilt, { anchorComments: true }).code).toBe(first.code)
  })
})
