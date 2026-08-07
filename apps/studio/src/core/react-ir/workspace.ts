/**
 * The module workspace.
 *
 * A site's source of truth under the React engine: TSX modules keyed by path. The
 * old model stored a node tree and generated HTML from it, so source was an output.
 * Here source is the artifact, and the IR is a view of it — which is what allows a
 * person to hand-edit a file and have the canvas still understand it.
 *
 * Three responsibilities, and they exist because doing them anywhere else has failed
 * before:
 *
 *   - Validate on write. A module that cannot be read back into the IR is not
 *     something the canvas can show, so accepting it would produce a site that
 *     builds but cannot be edited.
 *   - Detect concurrent edits by content hash. Two people, or a person and the AI,
 *     editing one module must not silently lose one side's work.
 *   - Answer questions about the whole set, not one file: which modules are client
 *     modules, and which route was clientized by something extractable.
 */

import { readModuleSource, type ReadDiagnostic } from './read'
import { analyseBoundaries, type BoundaryAnalysis } from './boundary'
import { isScannable } from './classTokens'
import type { ReactIrModule } from './nodes'

export type WorkspaceModule = Readonly<{
  path: string
  source: string
  /** SHA-256 of the source, for concurrent-edit detection. */
  hash: string
  /** Node ids recovered from the source, for addressing edits. */
  nodeIds: readonly string[]
  /** Whether every element carried an anchor, so identity survives reformatting. */
  fullyAnchored: boolean
  updatedAt: string
}>

export type WriteProblem = Readonly<{
  code: ReadDiagnostic['code'] | 'stale-base' | 'class-not-scannable' | 'unreadable'
  message: string
  line?: number
  column?: number
}>

export type WriteResult = Readonly<{
  written: boolean
  problems: readonly WriteProblem[]
  module?: WorkspaceModule
}>

/**
 * Content hash.
 *
 * Web Crypto rather than Bun's hasher because this module also runs in the canvas,
 * and the hash has to agree on both sides — a browser-side edit and a server-side
 * write comparing different digests would report a conflict on every save.
 */
export async function hashSource(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Storage the workspace sits on.
 *
 * Kept as an interface so the same validation applies whether modules live in
 * Postgres for a hosted site or on disk for a build sandbox. The rules must not
 * differ between those, or a site would behave differently once it was built.
 */
export interface ModuleStore {
  get(path: string): Promise<{ source: string, hash: string, updatedAt: string } | null>
  put(path: string, source: string, hash: string, updatedAt: string): Promise<void>
  delete(path: string): Promise<void>
  list(): Promise<readonly string[]>
}

/** An in-memory store, for tests and the canvas preview. */
export function createMemoryModuleStore(): ModuleStore {
  const modules = new Map<string, { source: string, hash: string, updatedAt: string }>()
  return {
    async get(path) {
      return modules.get(path) ?? null
    },
    async put(path, source, hash, updatedAt) {
      modules.set(path, { source, hash, updatedAt })
    },
    async delete(path) {
      modules.delete(path)
    },
    async list() {
      // Sorted so callers get a stable order without each one remembering to sort.
      return [...modules.keys()].sort()
    },
  }
}

export type WriteOptions = Readonly<{
  /**
   * Hash the edit was based on. When given and it does not match what is stored, the
   * write is refused: something changed underneath, and overwriting it would discard
   * work nobody agreed to discard.
   */
  baseHash?: string
  /** Clock seam, so tests do not depend on wall time. */
  now?: () => string
}>

export class ModuleWorkspace {
  private readonly store: ModuleStore

  constructor(store: ModuleStore) {
    this.store = store
  }

  /**
   * Validate and write a module.
   *
   * Validation is the same reader the canvas uses, so a module that is accepted here
   * is one the canvas can definitely show. Refusing early is the point: the
   * alternative is discovering it at build time, or worse, at render time.
   */
  async write(path: string, source: string, options: WriteOptions = {}): Promise<WriteResult> {
    const problems: WriteProblem[] = []

    if (options.baseHash !== undefined) {
      const existing = await this.store.get(path)
      // A missing file with a declared base means the file was deleted since it was
      // read, which is as much a conflict as a modification.
      if (!existing || existing.hash !== options.baseHash) {
        return Object.freeze({
          written: false,
          problems: Object.freeze([Object.freeze({
            code: 'stale-base' as const,
            message: existing
              ? `${path} changed since it was read. Read it again and reapply the edit `
                + 'so the other change is not lost.'
              : `${path} no longer exists. It was deleted after it was read.`,
          })]),
        })
      }
    }

    const read = readModuleSource(path, source)
    for (const diagnostic of read.diagnostics) {
      problems.push(Object.freeze({
        code: diagnostic.code,
        message: diagnostic.message,
        line: diagnostic.line,
        column: diagnostic.column,
      }))
    }

    if (read.rootNodeId === null) {
      problems.push(Object.freeze({
        code: 'unreadable' as const,
        message:
          `${path} produced no root element, so there is nothing for the canvas to show. `
          + 'A module must return JSX.',
      }))
    }

    for (const node of Object.values(read.nodes)) {
      const tokens = 'classTokens' in node ? node.classTokens : undefined
      for (const token of tokens ?? []) {
        if (isScannable(token)) continue
        problems.push(Object.freeze({
          code: 'class-not-scannable' as const,
          message:
            `Class "${token}" is built at runtime, so Tailwind generates no CSS for it and `
            + 'the element renders unstyled. Write the complete class name.',
        }))
      }
    }

    if (problems.length > 0) {
      return Object.freeze({ written: false, problems: Object.freeze(problems) })
    }

    const hash = await hashSource(source)
    const updatedAt = (options.now ?? (() => new Date().toISOString()))()
    await this.store.put(path, source, hash, updatedAt)

    return Object.freeze({
      written: true,
      problems: Object.freeze([]),
      module: Object.freeze({
        path,
        source,
        hash,
        nodeIds: Object.freeze(Object.keys(read.nodes)),
        fullyAnchored: read.fullyAnchored,
        updatedAt,
      }),
    })
  }

  /** Read a module with its hash, so a later write can declare what it was based on. */
  async read(path: string): Promise<WorkspaceModule | null> {
    const stored = await this.store.get(path)
    if (!stored) return null
    const read = readModuleSource(path, stored.source)
    return Object.freeze({
      path,
      source: stored.source,
      hash: stored.hash,
      nodeIds: Object.freeze(Object.keys(read.nodes)),
      fullyAnchored: read.fullyAnchored,
      updatedAt: stored.updatedAt,
    })
  }

  async list(): Promise<readonly string[]> {
    return this.store.list()
  }

  async remove(path: string): Promise<void> {
    await this.store.delete(path)
  }

  /**
   * Client boundary analysis across every module.
   *
   * Done here rather than per file because the cost of a boundary is everything
   * beneath it, which cannot be seen from one module.
   */
  async analyseBoundaries(routePaths?: readonly string[]): Promise<BoundaryAnalysis> {
    const modules: ReactIrModule[] = []
    for (const path of await this.store.list()) {
      const stored = await this.store.get(path)
      if (!stored) continue
      const read = readModuleSource(path, stored.source)
      if (read.rootNodeId === null) continue
      modules.push({
        version: 1,
        id: path,
        path,
        symbol: 'Module',
        kind: path.endsWith('layout.tsx') ? 'layout' : path.endsWith('page.tsx') ? 'page' : 'component',
        // Read from source rather than assumed: the directive is what decides it.
        boundary: /^\s*['"]use client['"]/m.test(stored.source) ? 'client' : 'server',
        rootNodeId: read.rootNodeId,
        nodes: read.nodes,
      } as ReactIrModule)
    }
    // Routes default to Next's own convention so callers need not restate it.
    const routes = routePaths
      ?? modules.filter((module) => module.kind !== 'component').map((module) => module.path)
    return analyseBoundaries(modules, { routePaths: routes })
  }
}
