/**
 * The editing session.
 *
 * Joins the three pieces the canvas needs into the sequence it actually performs:
 * read source into the IR, transform the IR, generate source back, write it. Nothing
 * here is clever; the value is that the sequence exists in one place, so the canvas,
 * the AI executor and a scripted migration cannot each get it subtly different.
 *
 * Two properties matter and are enforced rather than hoped for:
 *
 *   - An edit that would produce an invalid tree is refused before anything is
 *     written, so a failed interaction leaves the file as it was.
 *   - The write declares the hash it was based on, so an edit made against a stale
 *     read is reported instead of overwriting whatever changed underneath.
 */

import { generateModule, type GenerateOptions } from './generate'
import { readModuleSource } from './read'
import { verifyTree, type EditProblem, type EditResult } from './edit'
import { ModuleWorkspace, type WriteProblem } from './workspace'
import type { ReactIrModule } from './nodes'

export type SessionProblem = Readonly<{
  code: EditProblem['code'] | WriteProblem['code'] | 'not-found' | 'unreadable-source'
  message: string
  line?: number
}>

export type SessionResult = Readonly<{
  ok: boolean
  problems: readonly SessionProblem[]
  /** Hash after a successful write, for the next edit to declare. */
  hash?: string
  /** The module as it now stands, for the canvas to render. */
  module?: ReactIrModule
  source?: string
}>

/** Anchors are always emitted here: identity is what a second edit depends on. */
const SESSION_GENERATE: GenerateOptions = { anchorComments: true }

/**
 * Load a module's IR from the workspace.
 *
 * Returns the hash alongside, because an edit that does not declare its base cannot
 * detect a concurrent change and the two are only useful together.
 */
export async function loadModule(
  workspace: ModuleWorkspace,
  path: string,
): Promise<{ module: ReactIrModule, hash: string } | { problems: readonly SessionProblem[] }> {
  const stored = await workspace.read(path)
  if (!stored) {
    return {
      problems: Object.freeze([Object.freeze({
        code: 'not-found' as const,
        message: `${path} does not exist in this site.`,
      })]),
    }
  }

  const read = readModuleSource(path, stored.source)
  if (read.rootNodeId === null) {
    return {
      problems: Object.freeze([Object.freeze({
        code: 'unreadable-source' as const,
        message:
          `${path} produced no root element, so there is nothing to edit. `
          + 'It may have been changed by hand into something outside the accepted subset.',
      })]),
    }
  }

  return {
    module: {
      version: 1,
      id: path,
      path,
      // The symbol the source declares, never a placeholder: regenerating must not
      // rename somebody's component, which would change what their other files import
      // and make every component read as the same name in a stack trace. Only a source
      // with no name at all gets one derived from its path.
      symbol: read.symbol ?? symbolFromPath(path),
      kind: path.endsWith('layout.tsx') ? 'layout' : path.endsWith('page.tsx') ? 'page' : 'component',
      boundary: /^\s*['"]use client['"]/m.test(stored.source) ? 'client' : 'server',
      rootNodeId: read.rootNodeId,
      nodes: read.nodes,
      // Carried so a save cannot delete a metadata export the designer never saw.
      preamble: read.preamble,
      preservedImports: read.sourceImports,
    } as ReactIrModule,
    hash: stored.hash,
  }
}

/**
 * Derive a component name from its file path, for source that exports anonymously.
 *
 * `app/blog/[slug]/page.tsx` becomes `BlogSlugPage`. Only used when the source declares
 * no name, so it can never override one the author chose.
 */
function symbolFromPath(path: string): string {
  const words = path
    .replace(/\.tsx$/, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== 'src' && segment !== 'app')
    .flatMap((segment) => segment.replace(/[[\]().]/g, '').split(/[-_]/))
    .filter((word) => word !== '')
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
  // A leading digit is not a legal identifier start.
  return /^[A-Za-z]/.test(name) ? name : `Component${name}`
}

/**
 * Apply an edit and write the result.
 *
 * The edit is a function rather than a command object so the caller composes several
 * operations into one write — which is what makes a multi-step interaction, like
 * inserting a block and then positioning it, a single undo step.
 */
export async function commitEdit(
  workspace: ModuleWorkspace,
  path: string,
  baseHash: string,
  edit: (module: ReactIrModule) => EditResult,
): Promise<SessionResult> {
  const loaded = await loadModule(workspace, path)
  if ('problems' in loaded) {
    return Object.freeze({ ok: false, problems: loaded.problems })
  }

  const result = edit(loaded.module)
  if (!result.ok) {
    // Refused before anything is written, so the file is untouched.
    return Object.freeze({
      ok: false,
      problems: Object.freeze(result.problems.map((problem) => Object.freeze({
        code: problem.code,
        message: problem.message,
      }))),
    })
  }

  // Verified after the edit as well as inside it: an individual operation can be
  // sound while a composed sequence is not.
  const damage = verifyTree(result.module)
  if (damage.length > 0) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze(damage.map((problem) => Object.freeze({
        code: problem.code,
        message: `The edit left the tree inconsistent: ${problem.message}`,
      }))),
    })
  }

  let source: string
  try {
    source = generateModule(result.module, SESSION_GENERATE).code
  } catch (error) {
    // The generator throws for states it refuses to emit, such as Motion without a
    // client boundary. Surfacing the message beats writing nothing and saying nothing.
    return Object.freeze({
      ok: false,
      problems: Object.freeze([Object.freeze({
        code: 'unreadable-source' as const,
        message: error instanceof Error ? error.message : String(error),
      })]),
    })
  }

  const written = await workspace.write(path, source, { baseHash })
  if (!written.written) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze(written.problems.map((problem) => Object.freeze({
        code: problem.code,
        message: problem.message,
        ...(problem.line === undefined ? {} : { line: problem.line }),
      }))),
    })
  }

  return Object.freeze({
    ok: true,
    problems: Object.freeze([]),
    hash: written.module?.hash,
    module: result.module,
    source,
  })
}

/**
 * Create a module from an IR tree.
 *
 * Used when a page is created from a template or a block, where the tree exists
 * before any source does.
 */
export async function createModule(
  workspace: ModuleWorkspace,
  module: ReactIrModule,
): Promise<SessionResult> {
  const damage = verifyTree(module)
  if (damage.length > 0) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze(damage.map((problem) => Object.freeze({
        code: problem.code, message: problem.message,
      }))),
    })
  }

  const existing = await workspace.read(module.path)
  if (existing) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze([Object.freeze({
        code: 'duplicate-id' as const,
        message: `${module.path} already exists. Edit it instead of creating it again.`,
      })]),
    })
  }

  let source: string
  try {
    source = generateModule(module, SESSION_GENERATE).code
  } catch (error) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze([Object.freeze({
        code: 'unreadable-source' as const,
        message: error instanceof Error ? error.message : String(error),
      })]),
    })
  }

  const written = await workspace.write(module.path, source)
  if (!written.written) {
    return Object.freeze({
      ok: false,
      problems: Object.freeze(written.problems.map((problem) => Object.freeze({
        code: problem.code, message: problem.message,
      }))),
    })
  }

  return Object.freeze({
    ok: true,
    problems: Object.freeze([]),
    hash: written.module?.hash,
    module,
    source,
  })
}
