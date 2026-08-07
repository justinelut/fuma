/**
 * Tests the consumption step task 57 left open: the chosen segment config actually reaching a
 * generated file.
 *
 * The decision was modelled and tested; nothing emitted it. So every generated route ran on Next's own
 * default, and Next's default has changed between versions - a route whose freshness depends on which
 * version built it is one nobody can reason about.
 */
import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_REVALIDATE_SECONDS,
  isSegmentConfigStatement,
  strategyFor,
  withSegmentConfig,
} from '@core/react-ir/routeStrategy'
import { REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'
import { generateModule } from '@core/react-ir/generate'

function pageModule(preamble?: readonly string[]): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-page',
    kind: 'page',
    path: 'app/blog/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    boundary: 'server',
    ...(preamble === undefined ? {} : { preamble }),
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['t'] },
      t: { kind: 'text', id: 't', value: 'Posts', children: [] },
    },
  } as ReactIrModule
}

describe('a route strategy reaches the generated file', () => {
  it('emits the revalidate statement for a time-varying route', () => {
    const decision = strategyFor({
      routePath: '/blog',
      causes: ['time-varying'],
      perVisitorRegionsAreIsolable: false,
      revalidateSeconds: null,
    })
    // Guard: if this strategy carried no config the rest of the test would prove nothing.
    expect(decision.segmentConfig.length).toBeGreaterThan(0)

    const withConfig = withSegmentConfig(pageModule(), decision)
    const generated = generateModule(withConfig)
    expect(generated.code).toContain(`export const revalidate = ${DEFAULT_REVALIDATE_SECONDS}`)
    // And the page itself still renders - the config is added, not substituted for the component.
    expect(generated.code).toContain('export default function Page')
  })

  it('adds NOTHING for a static route, so the file does not restate Next\'s own behaviour', () => {
    const decision = strategyFor({
      routePath: '/about',
      causes: [],
      perVisitorRegionsAreIsolable: false,
      revalidateSeconds: null,
    })
    expect(decision.segmentConfig).toEqual([])
    const before = generateModule(pageModule()).code
    const after = generateModule(withSegmentConfig(pageModule(), decision)).code
    // `revalidate = false` says what Next already does and invites somebody to change it to a number
    // by mistake, so a static route is left alone entirely.
    expect(after).toBe(before)
  })

  it('REPLACES an existing config rather than appending a second one', () => {
    const decision = strategyFor({
      routePath: '/blog',
      causes: ['time-varying'],
      perVisitorRegionsAreIsolable: false,
      revalidateSeconds: null,
    })
    const stale = pageModule(['export const revalidate = 5'])
    const generated = generateModule(withSegmentConfig(stale, decision)).code
    // Two `export const revalidate` in one file is a duplicate-identifier error, so appending would
    // produce a module that cannot build - worse than the default it was correcting.
    const occurrences = generated.split('export const revalidate').length - 1
    expect(occurrences).toBe(1)
    expect(generated).toContain(`export const revalidate = ${DEFAULT_REVALIDATE_SECONDS}`)
    expect(generated).not.toContain('export const revalidate = 5')
  })

  it('preserves a preamble statement that is NOT a segment config', () => {
    const decision = strategyFor({
      routePath: '/blog',
      causes: ['time-varying'],
      perVisitorRegionsAreIsolable: false,
      revalidateSeconds: null,
    })
    const withMetadata = pageModule(["export const metadata = { title: 'Posts' }"])
    const generated = generateModule(withSegmentConfig(withMetadata, decision)).code
    // Task 50's whole finding: a canvas save silently deleting `export const metadata` strips the
    // page's title and SEO description. Adding a segment config must not reintroduce that.
    expect(generated).toContain('export const metadata')
    expect(generated).toContain('export const revalidate')
  })

  it('recognises every segment-config name Next declares, and nothing else', () => {
    for (const name of ['revalidate', 'dynamic', 'fetchCache', 'runtime', 'preferredRegion']) {
      expect(isSegmentConfigStatement(`export const ${name} = 1`), name).toBe(true)
    }
    // Matching too broadly would delete a tenant's own exports while replacing a config.
    expect(isSegmentConfigStatement("export const metadata = { title: 'x' }")).toBe(false)
    expect(isSegmentConfigStatement('export const revalidateLater = 1')).toBe(false)
  })
})
