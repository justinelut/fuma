import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { validateAuthoredModule } from '@core/ai/tsxAuthoring'

/**
 * The shipped site prompt, read as text.
 *
 * Read from the file rather than imported because building it needs a live snapshot,
 * and what matters here is the static instruction the model actually receives.
 */
const prompt = readFileSync(
  new URL('../../../server/ai/tools/site/systemPrompt.ts', import.meta.url),
  'utf8',
)

describe('the shipped prompt directs TSX authoring', () => {
  it('names the authoring tools', () => {
    for (const tool of [
      'site_author_module', 'site_edit_module', 'site_read_module', 'site_list_modules',
    ]) {
      expect(prompt).toContain(tool)
    }
  })

  it('no longer instructs HTML insertion anywhere', () => {
    // The decisive check. Tools existing is not enough: a prompt that still says
    // "insert semantic HTML" produces HTML regardless of what else is available.
    expect(prompt).not.toContain('site_insert_html')
    expect(prompt).not.toContain('site_replace_node_html')
  })

  it('does not instruct the custom importer markers', () => {
    // Those markers only mean something to the HTML importer, which is no longer in
    // the authoring path.
    expect(prompt).not.toContain('instatic-loop')
    expect(prompt).not.toContain('instatic-outlet')
  })

  it('does not instruct a token syntax that does not exist in TSX', () => {
    expect(prompt).not.toContain('currentEntry.title')
  })
})

describe('the prompt and the validator agree', () => {
  const rules: readonly { instruction: string, source: string, code: string }[] = [
    {
      instruction: 'No spread attributes',
      source: `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`,
      code: 'spread-denied',
    },
    {
      instruction: 'No event handlers',
      source: `export default function Page() {
  return <button onClick={handle} />
}
`,
      code: 'handler-denied',
    },
    {
      instruction: 'No dangerouslySetInnerHTML',
      source: `export default function Page() {
  return <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />
}
`,
      code: 'inner-html-denied',
    },
    {
      instruction: 'className must be a complete literal string',
      source: `export default function Page(props: { size: string }) {
  return <div className={props.size} />
}
`,
      code: 'dynamic-expression-denied',
    },
  ]

  for (const rule of rules) {
    it(`refuses what it says it refuses: ${rule.instruction}`, () => {
      // A prompt that promises a rule the validator does not enforce trains the model
      // to ignore the prompt; one that enforces a rule it never stated produces
      // failures the model cannot anticipate. Both directions are checked.
      const keyPhrase = rule.instruction.split(' ').slice(0, 3).join(' ')
      expect(prompt.toLowerCase()).toContain(keyPhrase.toLowerCase())

      const result = validateAuthoredModule({
        target: { path: 'app/page.tsx', kind: 'page' },
        source: rule.source,
      })
      expect(result.accepted).toBe(false)
      expect(result.problems.map((problem) => problem.code)).toContain(rule.code)
    })
  }

  it('accepts source written the way the prompt describes', () => {
    // The positive direction: following the instructions has to actually work.
    const result = validateAuthoredModule({
      target: { path: 'app/page.tsx', kind: 'page' },
      source: `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6 md:gap-8">
      <h1 /* @fuma title */ className="text-4xl text-foreground">Own your site</h1>
    </section>
  )
}
`,
    })
    expect(result.problems).toEqual([])
    expect(result.accepted).toBe(true)
  })
})

describe('the prompt states the costs the engine imposes', () => {
  it('explains the client boundary and where to put it', () => {
    expect(prompt).toContain("'use client'")
    expect(prompt).toMatch(/smallest module/)
  })

  it('warns that variant propagation fails silently', () => {
    // The failure mode with no console output, so the prompt is the only warning.
    expect(prompt).toMatch(/fails silently|never animates/)
  })

  it('directs mobile-first responsive work', () => {
    expect(prompt).toContain('Mobile-first')
  })

  it('directs the theme scale over arbitrary values', () => {
    expect(prompt).toMatch(/bypass the theme/)
  })

  it('describes the escape hatch as narrow', () => {
    expect(prompt).toMatch(/escape hatch/)
    expect(prompt).toMatch(/Not for padding, colour or spacing/)
  })

  it('tells the model to pass baseHash', () => {
    expect(prompt).toContain('baseHash')
  })
})
