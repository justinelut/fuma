/**
 * TSX authoring for AI and MCP.
 *
 * Replaces `site_insert_html` and `site_replace_node_html`. The reason is not
 * stylistic. When a model writes HTML, that HTML goes through an importer that
 * guesses at structure, invents class names and produces a node tree nobody
 * declared — so what the model wrote and what the site contains are two different
 * things, and the model cannot reliably edit its own output afterwards.
 *
 * Authoring TSX removes the guessing. The source the model writes *is* the source
 * the site builds, and it is read back through exactly the same reader a person's
 * hand edits go through. One gate, one accepted subset, one set of diagnostics.
 *
 * The consequence worth stating: a refusal here is a feature. If the model writes
 * something outside the subset — a spread, an event handler, a computed class name —
 * the tool fails with a diagnostic naming the problem and the fix, and the model
 * corrects itself. Silently accepting it would put code in the site that the canvas
 * cannot show and the properties panel cannot edit.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { readModuleSource, type ReadDiagnostic } from '@core/react-ir/read'
import { isScannable, parseClassString, splitClassString } from '@core/react-ir/classTokens'
import { reviewComponentFirst, type AuthoringNote } from '@core/ai/componentFirst'

/** Where an authored module lives. */
export const ModuleTargetSchema = Type.Object({
  /**
   * Repository-relative path. Constrained to the source workspace so authoring
   * cannot reach configuration or the build itself.
   */
  path: Type.String({ minLength: 1, maxLength: 512 }),
  kind: Type.Union([
    Type.Literal('page'),
    Type.Literal('layout'),
    Type.Literal('component'),
  ]),
}, { additionalProperties: false })
export type ModuleTarget = Static<typeof ModuleTargetSchema>

export const AuthorModuleInputSchema = Type.Object({
  target: ModuleTargetSchema,
  /** Complete TSX for the module. Whole files only — see the note below. */
  source: Type.String({ minLength: 1, maxLength: 200_000 }),
}, { additionalProperties: false })
export type AuthorModuleInput = Static<typeof AuthorModuleInputSchema>

/**
 * Editing is a whole-file replacement rather than a patch.
 *
 * A patch tool would need the model to reproduce an exact span, which is where
 * string-matching edits usually fail. Reading the file and returning it complete is
 * both simpler for the model and verifiable: the result either parses into the IR or
 * it does not.
 */
export const EditModuleInputSchema = Type.Object({
  target: ModuleTargetSchema,
  source: Type.String({ minLength: 1, maxLength: 200_000 }),
  /**
   * Hash of the source the edit was based on, so a concurrent change is detected
   * rather than overwritten.
   */
  baseHash: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
}, { additionalProperties: false })
export type EditModuleInput = Static<typeof EditModuleInputSchema>

export const ReadModuleInputSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false })
export type ReadModuleInput = Static<typeof ReadModuleInputSchema>

/** A refusal the model can act on. */
export type AuthoringProblem = Readonly<{
  code: ReadDiagnostic['code'] | 'class-not-scannable' | 'path-outside-workspace' | 'style-attribute-denied'
  message: string
  line?: number
  column?: number
}>

export type AuthoringResult = Readonly<{
  accepted: boolean
  problems: readonly AuthoringProblem[]
  /** Node ids recovered from the source, for addressing follow-up edits. */
  nodeIds: readonly string[]
  /** Class tokens seen, so styling can be checked against the design system. */
  classTokens: readonly string[]
  /**
   * Advice that does not affect acceptance.
   *
   * Separate from `problems` because these are not refusals: a page authored as one file is valid
   * source, so folding them together would either block it wrongly or make a refusal list that the
   * author learns to skim.
   */
  notes: readonly AuthoringNote[]
}>

/**
 * Paths authoring may write.
 *
 * Deliberately narrow. Authoring is for pages, layouts and components; letting it
 * reach `next.config`, `package.json` or the Tailwind entry point would turn a
 * content edit into a build change.
 */
const ALLOWED_PREFIXES = ['app/', 'components/', 'src/app/', 'src/components/'] as const

export function isAllowedModulePath(path: string): boolean {
  // A traversal segment could escape any prefix check, so reject it outright rather
  // than trying to normalise.
  if (path.includes('..')) return false
  if (!path.endsWith('.tsx')) return false
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * Validate authored TSX before it is written.
 *
 * Runs the same reader the builder uses for hand-edited files, so there is exactly
 * one definition of what the engine accepts. A model and a person get identical
 * diagnostics for identical mistakes.
 */
export function validateAuthoredModule(input: AuthorModuleInput): AuthoringResult {
  const problems: AuthoringProblem[] = []

  if (!isAllowedModulePath(input.target.path)) {
    problems.push(Object.freeze({
      code: 'path-outside-workspace' as const,
      message:
        `"${input.target.path}" is not an authorable path. Write pages, layouts and `
        + `components under ${ALLOWED_PREFIXES.join(', ')} with a .tsx extension.`,
    }))
    // No point parsing source for a file that cannot be written.
    return Object.freeze({
      accepted: false,
      problems: Object.freeze(problems),
      nodeIds: Object.freeze([]),
      classTokens: Object.freeze([]),
      // No composition advice for source that was never read: pointing at structure in a file we
      // refused to write would be advice about a page that does not exist.
      notes: Object.freeze([]),
    })
  }

  const read = readModuleSource(input.target.path, input.source)
  for (const diagnostic of read.diagnostics) {
    problems.push(Object.freeze({
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
    }))
  }

  // Every class token has to be a complete literal. Tailwind's scanner only sees
  // literals, so an assembled class produces no CSS and the element renders
  // unstyled with nothing in the console to explain it.
  const classTokens: string[] = []
  for (const node of Object.values(read.nodes)) {
    const tokens = 'classTokens' in node ? node.classTokens : undefined
    for (const token of tokens ?? []) {
      classTokens.push(token)
      if (!isScannable(token)) {
        problems.push(Object.freeze({
          code: 'class-not-scannable' as const,
          message:
            `Class "${token}" is assembled at runtime. Tailwind only generates CSS for `
            + 'complete class names written as literals, so this would render unstyled. '
            + 'Write the full class, or switch between complete classes with a conditional.',
        }))
      }
    }
  }

  // Component-first is REPORTED, never a refusal, so it cannot change `accepted`. A page composed as
  // one file is valid source that renders; what it loses is a properties panel, and that is advice
  // the author should get while it is one page rather than fifty. Task 74's check runs here because
  // this is the moment the model can act on it.
  const composition = reviewComponentFirst({
    kind: kindForAuthoredPath(input.target.path),
    rootNodeId: read.rootNodeId,
    nodes: read.nodes,
  })

  return Object.freeze({
    accepted: problems.length === 0,
    problems: Object.freeze(problems),
    nodeIds: Object.freeze(Object.keys(read.nodes)),
    classTokens: Object.freeze(classTokens),
    notes: Object.freeze(composition),
  })
}

/**
 * Which module kind a path is, by Next's own file conventions.
 *
 * Derived from the path rather than taken as an argument, so the kind cannot disagree with the file -
 * the same reasoning moduleStore.resourceKindForPath uses server-side.
 */
export function kindForAuthoredPath(path: string): 'page' | 'layout' | 'component' {
  const file = path.split('/').pop() ?? ''
  if (file === 'page.tsx') return 'page'
  if (file === 'layout.tsx' || file === 'template.tsx') return 'layout'
  return 'component'
}

/**
 * Class tokens that are not part of the design system.
 *
 * Reported rather than refused: an arbitrary value is sometimes the right answer, and
 * a hard rule would block legitimate work. But a page full of `text-[13px]` and
 * `bg-[#f3f3f3]` has quietly stopped using the theme, and that is worth surfacing
 * while it is still one page rather than fifty.
 */
export function offThemeTokens(tokens: readonly string[]): readonly string[] {
  const offTheme: string[] = []
  for (const raw of tokens) {
    for (const token of parseClassString(raw)) {
      // An arbitrary value in square brackets bypasses the theme scale.
      if (/-\[[^\]]+\]$/.test(token.base)) offTheme.push(raw)
    }
  }
  return Object.freeze([...new Set(offTheme)])
}

/**
 * Extract class tokens from a raw class attribute value.
 *
 * Exposed for the AI layer so a proposed class list can be checked before it is
 * written into source.
 */
export function tokensOf(classAttribute: string): readonly string[] {
  return splitClassString(classAttribute)
}
