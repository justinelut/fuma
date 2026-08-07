/**
 * Layouts and Templates: two nouns, two meanings, no overlap.
 *
 * `Templates` used to mean both "the shared chrome a page renders inside" and "a design you
 * could buy". One word for two things is how a marketplace listing and a page wrapper end up
 * in the same menu.
 *
 * So:
 *
 *   **Layout** — a module of kind `layout` containing an outlet. It is Next's `layout.tsx`,
 *   and calling it anything else means the file on disk and the thing in the interface have
 *   different names.
 *
 *   **Template** — a sellable artifact: a whole site's modules, theme tokens and starting
 *   content, packaged so somebody else can install it.
 *
 * The React engine already speaks this way — its module kinds are `page | layout |
 * component`, with no page-layout "template" anywhere. What this file adds is the Template
 * artifact the marketplace needs, and the checks that stop the collision returning.
 *
 * The legacy model is deliberately left alone. Its `resourceKind: 'template'` is **persisted
 * data**: rows carry that literal string. Renaming it in code without migrating those rows
 * would orphan every stored layout, so the migration is a separate, deliberate act and
 * `LEGACY_TEMPLATE_KIND` records the mapping a future migration will use.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import type { ReactIrModule } from './nodes'

/** The three module kinds the engine has. There is no fourth, and none of them is "template". */
export const MODULE_KINDS = Object.freeze(['page', 'layout', 'component'] as const)
export type ModuleKind = (typeof MODULE_KINDS)[number]

/**
 * The legacy resourceKind that meant "page layout".
 *
 * Kept as a named constant rather than a bare string so the future migration has one place
 * to read, and so a search for it finds the explanation rather than 170 scattered literals.
 */
export const LEGACY_TEMPLATE_KIND = 'template' as const

/** What the legacy kind becomes once its rows are migrated. */
export const LEGACY_TEMPLATE_BECOMES: ModuleKind = 'layout'

export type LayoutProblem = Readonly<{
  code: 'not-a-layout' | 'no-outlet' | 'multiple-outlets'
  message: string
}>

/**
 * Check a module that claims to be a Layout.
 *
 * The check that earns its place: **a Layout without an outlet swallows every page.** A
 * `layout.tsx` that never renders `{children}` still renders its own header and footer, so
 * every route in the site shows the chrome and no content — and it reads as though the pages
 * are empty rather than as though the layout is broken. Nothing errors, because rendering
 * fewer children than you were given is legal React.
 */
export function reviewLayout(module: ReactIrModule): readonly LayoutProblem[] {
  const problems: LayoutProblem[] = []

  if (module.kind !== 'layout') {
    problems.push(Object.freeze({
      code: 'not-a-layout',
      message:
        `${module.path} is kind "${module.kind}", so it is not a Layout. Only a layout module `
        + 'wraps other routes.',
    }))
    return Object.freeze(problems)
  }

  const outlets = Object.values(module.nodes).filter((node) => node.kind === 'outlet')

  if (outlets.length === 0) {
    problems.push(Object.freeze({
      code: 'no-outlet',
      message:
        `${module.path} is a Layout with no outlet, so it renders its own chrome and none of the `
        + 'page inside it. Every route would show the header and footer with nothing between '
        + 'them, and it reads as empty pages rather than as a broken layout.',
    }))
  }

  if (outlets.length > 1) {
    problems.push(Object.freeze({
      code: 'multiple-outlets',
      message:
        `${module.path} has ${outlets.length} outlets. React renders children once; the extra `
        + 'outlets would each render the same page again.',
    }))
  }

  return Object.freeze(problems)
}

/** Whether a module is a sound Layout. */
export function isLayout(module: ReactIrModule): boolean {
  return reviewLayout(module).length === 0
}

/* The sellable artifact. */

export const TemplateModuleSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 512 }),
  kind: Type.Union([Type.Literal('page'), Type.Literal('layout'), Type.Literal('component')]),
  /** Complete file contents. */
  source: Type.String({ maxLength: 500_000 }),
}, { additionalProperties: false })

export const SiteTemplateSchema = Type.Object({
  /** Stable id, so a listing can be updated without becoming a different product. */
  id: Type.String({ minLength: 1, maxLength: 128 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  /** What a buyer is getting, in their words. */
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
  /**
   * Every module the template installs.
   *
   * Source text rather than IR, because a Template has to survive an engine version change:
   * source is what both the reader and a human can still open in a year, whereas an IR
   * snapshot is only readable by the version that wrote it.
   */
  modules: Type.Array(TemplateModuleSchema, { minItems: 1, maxItems: 500 }),
  /** The theme block, so the template looks the way it was sold. */
  themeCss: Type.String({ maxLength: 200_000 }),
  /**
   * Starting content, so a fresh install is not an empty shell.
   *
   * A template that installs to blank pages demos badly and reads as broken, which is the
   * single most common reason a bought theme gets refunded.
   */
  seedContent: Type.Optional(Type.String({ maxLength: 500_000 })),
  /**
   * Exact dependency versions the template was built against.
   *
   * Recorded rather than resolved at install time, because "works on the author's machine"
   * and "works on the buyer's" differ precisely when a range floated.
   */
  dependencies: Type.Record(Type.String(), Type.String()),
}, { additionalProperties: false })
export type SiteTemplate = Readonly<Static<typeof SiteTemplateSchema>>

/**
 * Whether source renders its children somewhere.
 *
 * Deliberately permissive about the identifier in front of `.children`: the check is looking
 * for evidence that the page reaches the output at all, not for one spelling.
 */
const RENDERS_CHILDREN = /\{\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?children\s*\}/

export type TemplateProblem = Readonly<{
  code: 'no-entry-page' | 'layout-without-outlet' | 'unpinned-dependency' | 'duplicate-path'
  message: string
}>

/**
 * Check a template before it can be listed.
 *
 * Every one of these makes the template install to something visibly wrong, which is worse
 * for the marketplace than refusing the listing.
 */
export function reviewTemplate(template: SiteTemplate): readonly TemplateProblem[] {
  const problems: TemplateProblem[] = []

  // Without a root page the install has no home page, and the buyer's first look at what
  // they paid for is a 404.
  if (!template.modules.some((module) => module.path === 'app/page.tsx')) {
    problems.push(Object.freeze({
      code: 'no-entry-page',
      message:
        'The template has no app/page.tsx, so a fresh install has no home page and the buyer\u2019s '
        + 'first look at what they paid for is a 404.',
    }))
  }

  for (const module of template.modules) {
    if (module.kind !== 'layout') continue
    // Matched on source rather than IR, because a template carries source. Any of the forms
    // that actually render children counts: the generator emits `{props.children}`, a
    // developer who destructures writes `{children}`, and one who names the parameter
    // something else writes `{p.children}`. Matching only the bare form would reject every
    // template the engine itself produces.
    if (!RENDERS_CHILDREN.test(module.source)) {
      problems.push(Object.freeze({
        code: 'layout-without-outlet',
        message:
          `${module.path} is a layout that never renders {children}, so every route it wraps `
          + 'would show the chrome and no page.',
      }))
    }
  }

  for (const [name, version] of Object.entries(template.dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      problems.push(Object.freeze({
        code: 'unpinned-dependency',
        message:
          `"${name}" is pinned as "${version}", which is a range. Two buyers installing a week `
          + 'apart would get different code, and only one of them would report the bug.',
      }))
    }
  }

  const seen = new Set<string>()
  for (const module of template.modules) {
    if (seen.has(module.path)) {
      problems.push(Object.freeze({
        code: 'duplicate-path',
        message:
          `${module.path} appears twice. Which one wins would be decided by install order, so `
          + 'the same template could install differently on two machines.',
      }))
    }
    seen.add(module.path)
  }

  return Object.freeze(problems)
}

/** Whether a template can be listed. */
export function isListable(template: SiteTemplate): boolean {
  return reviewTemplate(template).length === 0
}

/**
 * The word to use for a thing, so an interface cannot drift back to one noun for two meanings.
 */
export function nounFor(subject: 'page-chrome' | 'sellable-design'): 'Layout' | 'Template' {
  return subject === 'page-chrome' ? 'Layout' : 'Template'
}
