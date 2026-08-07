import { describe, it, expect } from 'bun:test'
import { siteWriteTools } from '../../../server/ai/tools/site/writeTools'
import { siteTools } from '../../../server/ai/tools/site'

const TSX_TOOLS = [
  'site_author_module',
  'site_edit_module',
  'site_read_module',
  'site_list_modules',
] as const

describe('the TSX tools are declared to the model', () => {
  it('appears in the site write tool set', () => {
    // Declared or not reachable: the executor cases cannot be called by a model that
    // was never told the tools exist.
    const names = siteWriteTools.map((tool) => tool.name)
    for (const name of TSX_TOOLS) expect(names).toContain(name)
  })

  it('is ordered ahead of the superseded HTML tools', () => {
    // Tool order is a signal to the model about what to reach for first.
    const names = siteWriteTools.map((tool) => tool.name)
    expect(names.indexOf('site_author_module'))
      .toBeLessThan(names.indexOf('site_insert_html'))
  })

  it('carries the structure-edit capability on every write', () => {
    // Authoring source is a structural change, so it must be gated like one.
    for (const name of ['site_author_module', 'site_edit_module']) {
      const tool = siteWriteTools.find((candidate) => candidate.name === name)
      expect(tool?.requiredCapabilities?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('leaves the read tools ungated, matching the other reads', () => {
    const read = siteWriteTools.find((tool) => tool.name === 'site_read_module')
    expect(read?.requiredCapabilities).toBeUndefined()
  })

  it('declares a schema for each tool', () => {
    for (const name of TSX_TOOLS) {
      const tool = siteWriteTools.find((candidate) => candidate.name === name)
      expect(tool?.inputSchema).toBeDefined()
    }
  })
})

describe('descriptions state the enforced rules', () => {
  it('tells the model what will be refused', () => {
    // The description and the validator have to agree, or the model is told one thing
    // and judged by another.
    const author = siteWriteTools.find((tool) => tool.name === 'site_author_module')
    for (const rule of ['spread', 'dangerouslySetInnerHTML', 'computed className']) {
      expect(author?.description).toContain(rule)
    }
  })

  it('directs Tailwind styling rather than CSS', () => {
    const author = siteWriteTools.find((tool) => tool.name === 'site_author_module')
    expect(author?.description).toContain('Tailwind utility classes')
  })

  it('explains why editing is whole-file', () => {
    const edit = siteWriteTools.find((tool) => tool.name === 'site_edit_module')
    expect(edit?.description).toMatch(/no patch tool/)
    expect(edit?.description).toContain('baseHash')
  })

  it('tells the model to preserve anchor comments', () => {
    // Losing them loses element identity, which makes later edits unreliable.
    const edit = siteWriteTools.find((tool) => tool.name === 'site_edit_module')
    expect(edit?.description).toContain('@fuma')
  })
})

describe('MCP inherits the tools', () => {
  it('exposes every TSX tool through the same registry', () => {
    // MCP spreads siteTools, which spreads siteWriteTools, so inheritance is
    // structural rather than a second list that could drift.
    const names = siteTools.map((tool) => tool.name)
    for (const name of TSX_TOOLS) expect(names).toContain(name)
  })

  it('marks the writes as mutating so metering and receipts apply', () => {
    // Mutation flagging is what drives metering and audit receipts; an unflagged
    // write would edit a site without being recorded.
    for (const name of ['site_author_module', 'site_edit_module']) {
      const tool = siteTools.find((candidate) => candidate.name === name)
      expect(tool?.mutates).toBe(true)
    }
  })
})
