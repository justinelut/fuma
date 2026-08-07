/**
 * The HTML authoring tools are on their way out, and this holds the exit open without slamming it.
 *
 * WHY THEY ARE STILL HERE, which is a correctness answer rather than an unfinished one. `executor.ts`
 * implements `site_insert_html` / `site_replace_node_html` against the module+props model, and THAT
 * model is the shipping self-hosted builder. Deleting the tools today removes working AI page-building
 * from every self-hosted install. So the deletion is sequenced behind retiring the old canvas, exactly
 * as task 58's RETIREMENT_SEQUENCE sequences the `publish.html` filter behind a replacement existing.
 *
 * What CAN be enforced now is that the surface does not grow: the replacement exists, it is registered,
 * and the number of places naming the HTML tools may shrink but never increase. A ratchet is the same
 * mechanism task 20 used for the shared site document, and it is what stops "sequenced for later"
 * quietly becoming "spreading meanwhile".
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STUDIO = join(import.meta.dir, '..', '..', '..')

/**
 * Files naming an HTML tool, with how many times.
 *
 * A per-file budget rather than one total, so removing a mention in one file cannot pay for adding one
 * somewhere else - which is precisely how a total-only ratchet lets a surface move rather than shrink.
 */
const HTML_TOOL_BUDGET: Readonly<Record<string, number>> = Object.freeze({
  // The DECLARATIONS. They must remain until the tools are removed, or the model would be offered a
  // tool the executor still implements and nothing would describe it.
  'server/ai/tools/site/writeTools.ts': 7,
  // The IMPLEMENTATION, against the module+props model the self-hosted builder still uses.
  'src/admin/pages/site/agent/executor.ts': 4,
  // Names them to state they are SUPERSEDED, which is documentation rather than use. Two mentions on
  // one line - counted as OCCURRENCES, not matching lines, because `grep -c` counts lines and would
  // have recorded 1 here.
  'src/core/ai/tsxAuthoring.ts': 2,
  // Renders a friendly label for a tool call in the transcript.
  'src/admin/pages/site/panels/AgentPanel/toolCallDisplay.ts': 1,
  // MCP inherits the site tools structurally; this names the legacy scope at the call site.
  'server/ai/mcp/tools/publishTool.ts': 1,
})

function countIn(relative: string): number {
  const source = readFileSync(join(STUDIO, relative), 'utf8')
  return (source.match(/site_insert_html|site_replace_node_html/g) ?? []).length
}

describe('the replacement exists and is reachable', () => {
  it('declares the four TSX authoring tools', () => {
    const writeTools = readFileSync(join(STUDIO, 'server/ai/tools/site/writeTools.ts'), 'utf8')
    for (const tool of ['site_author_module', 'site_edit_module', 'site_read_module', 'site_list_modules']) {
      expect(writeTools, tool).toContain(tool)
    }
  })

  it('orders the TSX tools AHEAD of the HTML ones', () => {
    // A model reads the list in order, so the tool it should reach for first must appear first.
    const writeTools = readFileSync(join(STUDIO, 'server/ai/tools/site/writeTools.ts'), 'utf8')
    expect(writeTools.indexOf('site_author_module')).toBeLessThan(writeTools.indexOf('site_insert_html'))
  })

  it('implements them in the executor, so the replacement is not only declared', () => {
    const executor = readFileSync(join(STUDIO, 'src/admin/pages/site/agent/executor.ts'), 'utf8')
    expect(executor).toContain('site_author_module')
  })

  it('tells the model to author TSX rather than HTML', () => {
    const prompt = readFileSync(join(STUDIO, 'server/ai/tools/site/systemPrompt.ts'), 'utf8')
    // The prompt was rewritten in task 42; a prompt still describing HTML would keep the old tools in
    // use however the list is ordered.
    expect(prompt).not.toContain('site_insert_html')
    expect(prompt).toContain('site_author_module')
  })
})

describe('the HTML tool surface may SHRINK, never grow', () => {
  it('matches the recorded budget exactly, so the budget cannot go stale', () => {
    // A budget left above the real count silently permits new usage. Asserting equality means removing
    // a mention forces this file to be updated, which is the point.
    for (const [file, budget] of Object.entries(HTML_TOOL_BUDGET)) {
      expect(countIn(file), file).toBe(budget)
    }
  })

  it('names every file that mentions them, so a new one fails this test', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const output = execSync(
      "grep -rl 'site_insert_html\\|site_replace_node_html' src server --include=*.ts --include=*.tsx "
      + "| grep -v '__tests__' | grep -v '\\.test\\.' || true",
      { cwd: STUDIO, encoding: 'utf8' },
    )
    const found = output.split('\n').map((line) => line.trim()).filter((line) => line !== '').sort()
    // Any file not in the budget is a NEW dependency on a tool that is being retired.
    expect(found).toEqual(Object.keys(HTML_TOOL_BUDGET).sort())
  })
})

describe('the retirement sequence is recorded rather than assumed', () => {
  it('states the blocking prerequisite in this file', () => {
    const self = readFileSync(join(import.meta.dir, 'html-tool-retirement.test.ts'), 'utf8')
    // The reason has to travel with the ratchet: without it, a later reader sees a budget and no
    // explanation of why the tools are still here, and may either delete them or grow them.
    expect(self).toContain('shipping self-hosted builder')
  })

  it('confirms the old model really is still what the executor drives', () => {
    // Evidenced rather than described: if this stopped being true, the deletion would be unblocked and
    // this whole ratchet should be replaced by the removal.
    const executor = readFileSync(join(STUDIO, 'src/admin/pages/site/agent/executor.ts'), 'utf8')
    expect(executor).toContain('site_insert_html')
  })
})
