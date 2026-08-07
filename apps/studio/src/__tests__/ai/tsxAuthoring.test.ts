import { describe, it, expect } from 'bun:test'
import {
  isAllowedModulePath,
  offThemeTokens,
  tokensOf,
  validateAuthoredModule,
  type AuthorModuleInput,
} from '@core/ai/tsxAuthoring'
import { TSX_AUTHORING_PROMPT } from '@core/ai/tsxAuthoringPrompt'

function author(source: string, path = 'app/page.tsx'): AuthorModuleInput {
  return { target: { path, kind: 'page' }, source }
}

const validPage = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6">
      <h1 /* @fuma title */ className="text-4xl">Own your site</h1>
    </section>
  )
}
`

describe('authorable paths', () => {
  it('accepts pages and components in the source workspace', () => {
    expect(isAllowedModulePath('app/page.tsx')).toBe(true)
    expect(isAllowedModulePath('components/Hero.tsx')).toBe(true)
    expect(isAllowedModulePath('src/app/about/page.tsx')).toBe(true)
  })

  it('refuses configuration and build files', () => {
    // Letting authoring reach these would turn a content edit into a build change.
    expect(isAllowedModulePath('next.config.ts')).toBe(false)
    expect(isAllowedModulePath('package.json')).toBe(false)
    expect(isAllowedModulePath('app/globals.css')).toBe(false)
  })

  it('refuses a traversal segment outright', () => {
    // Normalising it would be a second chance to get the check wrong.
    expect(isAllowedModulePath('app/../next.config.tsx')).toBe(false)
  })

  it('reports an unauthorable path without parsing the source', () => {
    const result = validateAuthoredModule(author(validPage, 'next.config.tsx'))
    expect(result.accepted).toBe(false)
    expect(result.problems[0]?.code).toBe('path-outside-workspace')
    expect(result.problems).toHaveLength(1)
  })
})

describe('accepting valid authored TSX', () => {
  it('accepts a module inside the subset', () => {
    const result = validateAuthoredModule(author(validPage))
    expect(result.problems).toEqual([])
    expect(result.accepted).toBe(true)
  })

  it('returns the node ids so follow-up edits can address them', () => {
    const result = validateAuthoredModule(author(validPage))
    expect(result.nodeIds).toContain('root')
    expect(result.nodeIds).toContain('title')
  })

  it('reports the class tokens it saw', () => {
    const result = validateAuthoredModule(author(validPage))
    expect(result.classTokens).toContain('grid')
    expect(result.classTokens).toContain('text-4xl')
  })
})

describe('refusing what the engine cannot model', () => {
  it('refuses a spread attribute', () => {
    const result = validateAuthoredModule(author(
      `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`))
    expect(result.accepted).toBe(false)
    expect(result.problems.map((problem) => problem.code)).toContain('spread-denied')
  })

  it('refuses an event handler', () => {
    const result = validateAuthoredModule(author(
      `export default function Page() {
  return <button onClick={handle} />
}
`))
    expect(result.problems.map((problem) => problem.code)).toContain('handler-denied')
  })

  it('refuses raw HTML injection', () => {
    const result = validateAuthoredModule(author(
      `export default function Page() {
  return <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />
}
`))
    expect(result.problems.map((problem) => problem.code)).toContain('inner-html-denied')
  })

  it('refuses a computed class list', () => {
    // Tailwind only generates CSS for literals, so this would render unstyled with
    // nothing in the console to explain it.
    const result = validateAuthoredModule(author(
      `export default function Page(props: { size: string }) {
  return <div className={props.size} />
}
`))
    expect(result.problems.map((problem) => problem.code))
      .toContain('dynamic-expression-denied')
  })

  it('refuses a component with no traceable import', () => {
    const result = validateAuthoredModule(author(
      `export default function Page() {
  return <Hero />
}
`))
    expect(result.problems.map((problem) => problem.code)).toContain('unresolved-component')
  })

  it('refuses a module with no default export', () => {
    const result = validateAuthoredModule(author(
      `export function Page() {
  return <div />
}
`))
    expect(result.problems.map((problem) => problem.code)).toContain('no-default-export')
  })

  it('gives every refusal an actionable message', () => {
    // A refusal the model cannot act on is just a failure.
    const result = validateAuthoredModule(author(
      `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`))
    for (const problem of result.problems) {
      expect(problem.message.length).toBeGreaterThan(20)
    }
  })
})

describe('theme adherence', () => {
  it('flags arbitrary values that bypass the theme', () => {
    // Reported, not refused: sometimes an arbitrary value is right, but a page full
    // of them has quietly stopped using the design system.
    expect(offThemeTokens(['bg-primary', 'text-[13px]', 'bg-[#f3f3f3]']))
      .toEqual(['text-[13px]', 'bg-[#f3f3f3]'])
  })

  it('does not flag theme scale classes', () => {
    expect(offThemeTokens(['bg-primary', 'gap-4', 'md:text-lg', 'bg-primary/20'])).toEqual([])
  })

  it('splits a class attribute the way the reader does', () => {
    expect(tokensOf("grid gap-6 bg-[url('a b.png')]"))
      .toEqual(['grid', 'gap-6', "bg-[url('a b.png')]"])
  })
})

describe('the authoring prompt', () => {
  it('instructs TSX authoring rather than HTML insertion', () => {
    expect(TSX_AUTHORING_PROMPT).toContain('site_author_module')
    expect(TSX_AUTHORING_PROMPT).not.toContain('site_insert_html')
    expect(TSX_AUTHORING_PROMPT).not.toContain('site_replace_node_html')
  })

  it('instructs Tailwind styling rather than CSS authoring', () => {
    expect(TSX_AUTHORING_PROMPT).toContain('Tailwind utility classes')
    expect(TSX_AUTHORING_PROMPT).not.toContain('site_apply_css')
  })

  it('states the refusals the tools actually enforce', () => {
    // The prompt and the validator have to agree, or the model is being told one
    // thing and judged by another.
    for (const rule of ['spread', 'dangerouslySetInnerHTML', 'complete literal']) {
      expect(TSX_AUTHORING_PROMPT).toContain(rule)
    }
  })

  it('explains the client boundary cost rather than just the rule', () => {
    expect(TSX_AUTHORING_PROMPT).toContain("'use client'")
    expect(TSX_AUTHORING_PROMPT).toMatch(/smallest module/)
  })

  it('warns that variant propagation fails silently', () => {
    expect(TSX_AUTHORING_PROMPT).toMatch(/fails silently|never animates/)
  })

  it('directs mobile-first responsive work', () => {
    expect(TSX_AUTHORING_PROMPT).toContain('mobile-first')
  })
})
