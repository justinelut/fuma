/**
 * Proves the component-first advice reaches the MODEL, not just the validator.
 *
 * Task 74 built the review and wired it into `validateAuthoredModule`, but the notes stopped there:
 * `AuthoringToolOutput` did not carry them and the tool reply did not include them. A review whose
 * output no reader ever sees is indistinguishable from no review at all - the same inert-fix class as
 * tasks 20, 52 and 68 - so the property worth testing is REACHABILITY through both hops.
 */
import { describe, expect, it } from 'bun:test'
import { runAuthorModule } from '@core/ai/authoringTools'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'

/** A page of real size whose sections are plain markup, so nothing on it is configurable. */
function unextractedPage(): string {
  const paragraphs = Array.from({ length: 12 }, (_, index) =>
    `      <p className="mt-3 text-muted-foreground">Line ${index + 1} of the story.</p>`).join('\n')
  return `export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold">Our story</h1>
${paragraphs}
    </main>
  )
}
`
}

/** A page that composes a component, which is the shape the rule asks for. */
function composedPage(): string {
  return `import { Hero } from '@/components/Hero'

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Hero />
    </main>
  )
}
`
}

describe('the AI reads its own composition advice back', () => {
  it('carries the note through to the tool result for an accepted page', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const result = await runAuthorModule(workspace, {
      path: 'app/page.tsx',
      source: unextractedPage(),
    })
    // ACCEPTED, because the source is valid - refusing a page that renders correctly would make the
    // authoring tools unusable for the simple case they should handle best.
    expect(result.ok).toBe(true)
    expect(result.notes).toBeDefined()
    expect(result.notes!.length).toBeGreaterThan(0)
    // The note has to say what to do, not merely that something is wrong.
    expect(result.notes!.some((note) => note.message.length > 20)).toBe(true)
  })

  it('carries NO note when the page already composes a component', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const result = await runAuthorModule(workspace, {
      path: 'app/page.tsx',
      source: composedPage(),
    })
    expect(result.ok).toBe(true)
    // A rule that reports on correct output is one authors learn to skim, so absence matters as much
    // as presence.
    expect(result.notes).toBeUndefined()
  })

  it('derives the notes from the same validator the write used', async () => {
    // Recomputing them independently would let the advice the model reads drift from the advice the
    // gate produced. Asserted by the note code being one componentFirst declares.
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const result = await runAuthorModule(workspace, {
      path: 'app/page.tsx',
      source: unextractedPage(),
    })
    const codes = (result.notes ?? []).map((note) => note.code)
    expect(codes.every((code) => code === 'section-not-extracted' || code === 'page-composes-nothing')).toBe(true)
  })

  it('a REFUSED write carries no advice, because the page does not exist', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const result = await runAuthorModule(workspace, {
      path: 'app/page.tsx',
      // A call cannot be previewed without running it, so the reader refuses this outright.
      source: 'export default function Page() { return <main>{greeting(9)}</main> }\n',
    })
    expect(result.ok).toBe(false)
    // Advice about the structure of a file we declined to write is advice about a page nobody has.
    expect(result.notes).toBeUndefined()
  })
})
