/**
 * Task 58: legacy plugin modules as opaque islands.
 *
 * The two claims the design rests on - that plugin render is PURE and that it receives ESCAPED
 * props - are asserted against the shipped SDK rather than restated.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BOUNDARY_ESCAPING,
  RETIREMENT_SEQUENCE,
  TIER_LIMITS,
  planIsland,
  reviewIsland,
  type LegacyModuleFacts,
} from '../../core/react-ir/legacyPluginIslands'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const SDK_MODULES = join(STUDIO, 'src/core/plugin-sdk/modules.ts')

const PURE: LegacyModuleFacts = Object.freeze({
  moduleId: 'acme.ui-kit.callout',
  isPure: true,
  shipsJs: false,
  canHaveChildren: false,
})

describe('the SDK contract the tier depends on', () => {
  it('plugin render really is documented as pure', () => {
    // This is what makes a build-time island possible at all.
    const sdk = readFileSync(SDK_MODULES, 'utf8')
    expect(sdk).toContain('Pure render function')
    expect(sdk).toContain('NEVER use document/window/React')
    expect(sdk).toContain('NEVER call fetch')
  })

  it('and it really does receive ESCAPED props', () => {
    // Which is why the pre-escaping must survive at this boundary even though React does not want it.
    expect(readFileSync(SDK_MODULES, 'utf8')).toContain('Receives escaped string props')
  })

  it('render really returns an HTML string plus optional css and js', () => {
    const sdk = readFileSync(SDK_MODULES, 'utf8')
    expect(sdk).toContain('html: string')
    expect(sdk).toContain('css?: string')
    expect(sdk).toContain('js?: string')
  })
})

describe('a pure legacy module becomes an island', () => {
  it('embedded as inner HTML', () => {
    expect(planIsland(PURE).embedding).toBe('inner-html')
  })

  it('and the reason states the property that permits it', () => {
    expect(planIsland(PURE).reason).toContain('pure')
    expect(planIsland(PURE).reason).toContain('build')
  })

  it('a sanitiser is always required, not judged per value', () => {
    // The SINK bypasses React's escaping, so the requirement holds for every future value too.
    expect(planIsland(PURE).requiresSanitiser).toBe(true)
  })

  it('and props are still escaped before the legacy render sees them', () => {
    expect(planIsland(PURE).requiresEscapedProps).toBe(true)
  })
})

describe('an impure module is refused rather than approximated', () => {
  it('reports unsupported', () => {
    const plan = planIsland({ ...PURE, isPure: false })
    expect(plan.embedding).toBe('unsupported')
  })

  it('and says the SDK already forbade it, so this is not a new restriction', () => {
    const plan = planIsland({ ...PURE, isPure: false })
    expect(plan.reason).toContain('SDK already forbids')
  })

  it('an unsupported module demands nothing, because nothing is rendered', () => {
    const plan = planIsland({ ...PURE, isPure: false })
    expect(plan.requiresSanitiser).toBe(false)
    expect(plan.runtimeDelivery).toBe('none')
  })
})

describe('a module runtime travels as a page contribution, not inside the island', () => {
  it('because a script inserted via innerHTML does not execute', () => {
    const plan = planIsland({ ...PURE, shipsJs: true })
    expect(plan.runtimeDelivery).toBe('page-contribution')
  })

  it('and a module with no runtime asks for none', () => {
    expect(planIsland(PURE).runtimeDelivery).toBe('none')
  })

  it('putting it inside the HTML is flagged, with the real consequence named', () => {
    const problems = reviewIsland({
      moduleId: PURE.moduleId,
      embedding: 'inner-html',
      sanitiserApplied: true,
      propsEscaped: true,
      runtimeInsideHtml: true,
      engineStylesInside: false,
    })
    expect(problems.map((p) => p.code)).toContain('script-in-inner-html')
    expect(problems[0]!.message).toContain('does not execute')
  })
})

describe('the review catches what fails silently', () => {
  const sound = {
    moduleId: PURE.moduleId,
    embedding: 'inner-html' as const,
    sanitiserApplied: true,
    propsEscaped: true,
    runtimeInsideHtml: false,
    engineStylesInside: false,
  }

  it('a sound island reports nothing', () => {
    expect(reviewIsland(sound)).toHaveLength(0)
  })

  it('an unsanitised island is flagged, naming the bypass', () => {
    const problems = reviewIsland({ ...sound, sanitiserApplied: false })
    expect(problems.map((p) => p.code)).toContain('unsanitised-island')
    expect(problems[0]!.message).toContain('bypasses React')
  })

  it('UNESCAPED props to a legacy render are flagged as an injection, not a display defect', () => {
    // The most plausible wrong edit: "React escapes now, so drop the escaping".
    const problems = reviewIsland({ ...sound, propsEscaped: false })
    const message = problems.find((p) => p.code === 'unescaped-props-to-legacy-render')!.message
    expect(message).toContain('injection')
    expect(message).toContain('never passes through React')
  })

  it('engine styling inside the island is flagged', () => {
    const problems = reviewIsland({ ...sound, engineStylesInside: true })
    expect(problems.map((p) => p.code)).toContain('engine-styles-inside-island')
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewIsland({
      ...sound,
      sanitiserApplied: false,
      propsEscaped: false,
      runtimeInsideHtml: true,
      engineStylesInside: true,
    })
    expect(problems).toHaveLength(4)
  })

  it('an unsupported module is not reviewed for island properties it does not have', () => {
    const problems = reviewIsland({ ...sound, embedding: 'unsupported', sanitiserApplied: false })
    expect(problems).toHaveLength(0)
  })
})

describe('the two escaping rules are recorded together because they are opposite', () => {
  it('the React tree does not pre-escape', () => {
    expect(BOUNDARY_ESCAPING.reactTree.escapeProps).toBe(false)
    expect(BOUNDARY_ESCAPING.reactTree.why).toContain('entities')
  })

  it('the legacy render does', () => {
    expect(BOUNDARY_ESCAPING.legacyRender.escapeProps).toBe(true)
    expect(BOUNDARY_ESCAPING.legacyRender.why).toContain('injection')
  })

  it('and they genuinely disagree, which is the point of writing them down', () => {
    expect(BOUNDARY_ESCAPING.reactTree.escapeProps).not.toBe(
      BOUNDARY_ESCAPING.legacyRender.escapeProps,
    )
  })
})

describe('the tier states its limits rather than claiming parity', () => {
  it('names the canvas limitation', () => {
    expect(TIER_LIMITS.some((entry) => entry.limit.includes('not editable'))).toBe(true)
  })

  it('names the Tailwind consequence and where a legacy module gets CSS instead', () => {
    const tailwind = TIER_LIMITS.find((entry) => entry.limit.includes('Tailwind'))
    expect(tailwind?.why).toContain('PluginRenderOutput.css')
  })

  it('explains why children cannot be composed by the engine', () => {
    const children = TIER_LIMITS.find((entry) => entry.limit.includes('Child modules'))
    expect(children?.why).toContain('HTML STRINGS')
  })

  it('every limit carries a reason', () => {
    for (const entry of TIER_LIMITS) {
      expect(entry.why.length).toBeGreaterThan(40)
    }
  })
})

describe('the publish.html retirement sequence is recorded', () => {
  it('names what had to exist first', () => {
    expect(RETIREMENT_SEQUENCE.filter).toBe('publish.html')
    expect(RETIREMENT_SEQUENCE.nowAvailable).toHaveLength(2)
  })

  it('and is honest that deletion still needs installed plugins migrated', () => {
    // Deleting it silently stops contributions rather than telling anybody.
    expect(RETIREMENT_SEQUENCE.remaining).toContain('migrated')
    expect(RETIREMENT_SEQUENCE.remaining).toContain('silently')
  })

  it('the filter really is still declared, so the sequence is not claiming it is gone', () => {
    const hooks = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/hooks.ts'), 'utf8')
    expect(hooks).toContain("'publish.html': string")
  })
})
