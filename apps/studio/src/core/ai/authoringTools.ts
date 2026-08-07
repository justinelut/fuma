/**
 * Executable TSX authoring tools.
 *
 * The layer between a tool call and the module workspace. Its job is to turn a
 * refusal into something a model can act on, which is the difference between an
 * agent that recovers and one that retries the same mistake.
 *
 * Every failure returns the diagnostics with line and column, and every success
 * returns the node ids and the content hash — the ids so a follow-up edit can
 * address an element, the hash so the next write can declare what it was based on
 * and a concurrent change is detected rather than overwritten.
 */

import { ModuleWorkspace, type WriteProblem } from '@core/react-ir/workspace'
import { isAllowedModulePath, kindForAuthoredPath, offThemeTokens, validateAuthoredModule } from './tsxAuthoring'
import type {
  AuthorModuleToolInput,
  EditModuleToolInput,
  ReadModuleToolInput,
} from './toolSchemas'

export type AuthoringToolOutput = Readonly<{
  ok: boolean
  /** Human-readable summary, which is what the model reads first. */
  summary: string
  problems?: readonly WriteProblem[]
  path?: string
  hash?: string
  nodeIds?: readonly string[]
  source?: string
  /**
   * Classes that bypass the theme. A warning rather than a failure: an arbitrary
   * value is sometimes right, but drift is worth naming while it is small.
   */
  offTheme?: readonly string[]
  /**
   * Composition advice from task 74's review - a page that renders correctly but is not
   * configurable, because nothing was extracted into a component whose props become canvas
   * controls. REPORTED rather than refused: the source is valid, so blocking it would make the
   * authoring tools unusable for the simple case they should handle best.
   */
  notes?: readonly Readonly<{ code: string; message: string; nodeId?: string }>[]
}>

/**
 * The composition notes for source that was accepted.
 *
 * Derived from the SAME validator the write went through rather than recomputed, so the advice the
 * model reads cannot disagree with the advice the gate produced.
 */
function notesFor(path: string, source: string): readonly Readonly<{ code: string; message: string; nodeId?: string }>[] {
  // kindForAuthoredPath derives page/layout/component from Next's file conventions, so the kind
  // cannot disagree with the file - the same reasoning moduleStore.resourceKindForPath uses.
  return validateAuthoredModule({ source, target: { kind: kindForAuthoredPath(path), path } }).notes
}

/** Render problems as a single message a model can act on directly. */
function describeProblems(problems: readonly WriteProblem[]): string {
  return problems
    .map((problem) => {
      const where = problem.line === undefined ? '' : ` (line ${problem.line})`
      return `- ${problem.code}${where}: ${problem.message}`
    })
    .join('\n')
}

/** Class tokens across every node, for the theme-drift check. */
function tokensFromNodeIds(source: string): readonly string[] {
  // Read from the written source rather than tracked separately, so the check
  // reflects what was actually stored.
  const matches = source.matchAll(/className="([^"]*)"/g)
  const tokens: string[] = []
  for (const match of matches) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      if (token.length > 0) tokens.push(token)
    }
  }
  return tokens
}

export async function runAuthorModule(
  workspace: ModuleWorkspace,
  input: AuthorModuleToolInput,
): Promise<AuthoringToolOutput> {
  if (!isAllowedModulePath(input.path)) {
    return Object.freeze({
      ok: false,
      summary:
        `${input.path} is not an authorable path. Write .tsx files under app/ or `
        + 'components/. Configuration and build files are deliberately out of reach.',
    })
  }

  // Refuse to silently replace an existing module: authoring is for new files, and
  // an accidental overwrite is exactly what the edit tool's base hash exists to
  // prevent.
  const existing = await workspace.read(input.path)
  if (existing) {
    return Object.freeze({
      ok: false,
      summary:
        `${input.path} already exists. Read it, then use site_edit_module with its `
        + 'hash so a concurrent change cannot be lost.',
      path: input.path,
      hash: existing.hash,
    })
  }

  const result = await workspace.write(input.path, input.source)
  if (!result.written) {
    return Object.freeze({
      ok: false,
      summary:
        `${input.path} was not written. Fix these and call again:\n`
        + describeProblems(result.problems),
      problems: result.problems,
    })
  }

  const offTheme = offThemeTokens(tokensFromNodeIds(input.source))
  return Object.freeze({
    ok: true,
    summary:
      `Wrote ${input.path} with ${result.module?.nodeIds.length ?? 0} addressable nodes.`
      + (offTheme.length > 0
        ? `\nThese classes bypass the theme: ${offTheme.join(', ')}. `
          + 'Prefer the theme scale so dark mode and later token changes still apply.'
        : ''),
    path: input.path,
    hash: result.module?.hash,
    nodeIds: result.module?.nodeIds,
    ...(offTheme.length > 0 ? { offTheme } : {}),
    // Forwarded so the model READS the advice rather than it living only in a validator result
    // nobody consumes. A note reaching no reader is the same as no note.
    ...(notesFor(input.path, input.source).length > 0
      ? { notes: notesFor(input.path, input.source) }
      : {}),
  })
}

export async function runEditModule(
  workspace: ModuleWorkspace,
  input: EditModuleToolInput,
): Promise<AuthoringToolOutput> {
  const existing = await workspace.read(input.path)
  if (!existing) {
    return Object.freeze({
      ok: false,
      summary: `${input.path} does not exist. Use site_author_module to create it.`,
    })
  }

  const result = await workspace.write(input.path, input.source, {
    ...(input.baseHash === undefined ? {} : { baseHash: input.baseHash }),
  })

  if (!result.written) {
    return Object.freeze({
      ok: false,
      summary:
        `${input.path} was not written. Fix these and call again:\n`
        + describeProblems(result.problems),
      problems: result.problems,
      // The current hash goes back so a stale-base failure can be retried against
      // the right base without a second read.
      hash: existing.hash,
    })
  }

  const offTheme = offThemeTokens(tokensFromNodeIds(input.source))
  return Object.freeze({
    ok: true,
    summary: `Updated ${input.path}.`
      + (offTheme.length > 0
        ? `\nThese classes bypass the theme: ${offTheme.join(', ')}.`
        : ''),
    path: input.path,
    hash: result.module?.hash,
    nodeIds: result.module?.nodeIds,
    ...(offTheme.length > 0 ? { offTheme } : {}),
  })
}

export async function runReadModule(
  workspace: ModuleWorkspace,
  input: ReadModuleToolInput,
): Promise<AuthoringToolOutput> {
  const module = await workspace.read(input.path)
  if (!module) {
    const available = await workspace.list()
    return Object.freeze({
      ok: false,
      summary: available.length > 0
        // Listing what exists turns a dead end into a next step.
        ? `${input.path} does not exist. Available modules: ${available.join(', ')}.`
        : `${input.path} does not exist, and no modules have been authored yet.`,
    })
  }

  return Object.freeze({
    ok: true,
    summary:
      `${input.path} (hash ${module.hash.slice(0, 12)}). Pass this hash as baseHash when `
      + 'editing so a concurrent change is detected.'
      + (module.fullyAnchored
        ? ''
        : '\nSome nodes carry no anchor comment; keep the /* @fuma <id> */ comments you '
          + 'see so element identity survives your edit.'),
    path: input.path,
    hash: module.hash,
    nodeIds: module.nodeIds,
    source: module.source,
  })
}

export async function runListModules(
  workspace: ModuleWorkspace,
): Promise<AuthoringToolOutput> {
  const paths = await workspace.list()
  return Object.freeze({
    ok: true,
    summary: paths.length > 0
      ? `${paths.length} module(s): ${paths.join(', ')}.`
      : 'No modules have been authored yet.',
    nodeIds: Object.freeze([]),
  })
}
