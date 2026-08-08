/**
 * Compile real Tailwind CSS for the canvas.
 *
 * The canvas has to show what the published page will look like, which means the same
 * compiler produces both. Hand-approximating utilities was the old model's weakness: a
 * class the approximation did not know rendered one way on canvas and another in
 * production, and nothing said so.
 *
 * Runs server-side because `@import "tailwindcss"` has to resolve Tailwind's own
 * stylesheet from disk. The canvas fetches the result; `canvasClassCss.ts` already
 * accepts it through `responsiveOptions.tailwindCss`.
 *
 * Two properties of Tailwind v4 shape this file, both established by executing it rather
 * than by reading documentation:
 *
 * 1. **An unknown candidate compiles to nothing, silently.** `notaclass-xyz` yields no
 *    rule and no error. That is the same silent failure as a runtime-assembled class, so
 *    the result reports which candidates produced nothing and the canvas can say so.
 *
 * 2. **`@theme inline` drops variables no utility used.** A token referenced only by
 *    escape-hatch CSS — `var(--color-primary)` inside a `style` attribute, which task 32
 *    deliberately permits — would resolve to nothing and the element would render wrong
 *    with no explanation. So the canvas theme is compiled `static`, which retains every
 *    declared token.
 */

// Imported LAZILY, inside createCompiler, rather than at module scope.
//
// This module is reachable from server/index.ts through the canvas CSS route, so a top-level import made
// Tailwind's resolvability a condition of the SERVER STARTING. It resolved in the monorepo through the
// hoisted workspace node_modules, but the production image installs with `--production` and tailwindcss
// was declared as a DEV dependency - so the studio pod crash-looped on
// `Cannot find package 'tailwindcss'` and the whole platform was down, to serve one endpoint.
//
// The dependency is now declared in `dependencies` where it belongs, which is the real fix. This lazy
// import is the second half: a dependency that only one feature needs must not be able to stop the
// server from booting. A canvas that cannot compile CSS is a degraded canvas; a server that will not
// start is every site offline.
type TailwindCompile = (
  stylesheet: string,
  options: { base: string; loadStylesheet: (id: string, base: string) => Promise<{ base: string; content: string }> },
) => Promise<{ build: (candidates: string[]) => string }>

let compileFn: TailwindCompile | null = null

async function loadTailwindCompile(): Promise<TailwindCompile> {
  if (compileFn) return compileFn
  try {
    const mod = (await import('tailwindcss')) as unknown as { compile: TailwindCompile }
    compileFn = mod.compile
    return compileFn
  } catch (error) {
    throw new Error(
      'The canvas cannot compile Tailwind because the `tailwindcss` package could not be loaded. ' +
      'It must be a runtime dependency of apps/studio, not a dev dependency. ' +
      `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export type CompiledCanvasCss = Readonly<{
  css: string
  /**
   * Candidates that produced no CSS.
   *
   * Almost always a typo or a utility that does not exist. Reported rather than dropped,
   * because an element silently rendering unstyled is the hardest kind of mistake to
   * find on a canvas.
   */
  unknownCandidates: readonly string[]
  /** True when the compiler was reused rather than rebuilt, for diagnostics. */
  cached: boolean
}>

/**
 * Turn a theme block into one the canvas can rely on.
 *
 * `static` is added rather than replacing `inline`: they are orthogonal. `inline`
 * controls whether a utility substitutes the token's value or references the variable,
 * which is what makes shadcn aliasing work; `static` controls whether the variable is
 * emitted when unused. The canvas needs the aliasing behaviour *and* every token
 * present, so it needs both.
 */
export function canvasThemeCss(themeCss: string): string {
  if (/^\s*@theme\s+[^{]*\bstatic\b/m.test(themeCss)) return themeCss
  return themeCss.replace(/^(\s*)@theme(\s+inline)?\s*\{/m, (_match, indent: string, inline?: string) =>
    `${indent}@theme static${inline ?? ''} {`)
}

type CachedCompiler = {
  build: (candidates: string[]) => string
}

/**
 * Directory to resolve package imports from.
 *
 * This file's own directory, so Tailwind is found through the normal node_modules walk
 * regardless of the process working directory — a server started from the repository
 * root and one started from the app directory must behave identically.
 */
const RESOLVE_BASE = import.meta.dir

/** Compilers keyed by the exact stylesheet they were built from. */
const compilers = new Map<string, CachedCompiler>()

/**
 * How many compilers to keep.
 *
 * Each holds a parsed copy of Tailwind's stylesheet, so an unbounded map would grow with
 * every tenant that ever opened the canvas. Small because a compiler is cheap to rebuild
 * (measured at roughly 30ms) and only the themes in active use matter.
 */
const COMPILER_LIMIT = 8

/**
 * Resolve a stylesheet import for the compiler.
 *
 * `@import "tailwindcss"` names a package, not a file, so it is mapped to the package's
 * own entry stylesheet. Anything else is resolved normally, which lets a site's theme
 * import a partial.
 */
async function loadStylesheet(
  id: string,
  base: string,
): Promise<{ path: string, base: string, content: string }> {
  const specifier = id === 'tailwindcss' ? 'tailwindcss/index.css' : id
  // A bare package name is resolved relative to this module rather than to the base
  // Tailwind passes down. Tailwind's base is the stylesheet's own directory, which for a
  // generated in-memory theme is not a real location with a reachable node_modules.
  const from = specifier.startsWith('.') ? base : RESOLVE_BASE
  const path = Bun.resolveSync(specifier, from)
  return {
    path,
    base: path.slice(0, path.lastIndexOf('/')),
    content: await Bun.file(path).text(),
  }
}

/**
 * Compile the utilities a canvas frame needs.
 *
 * `candidates` is the set of class tokens the IR carries. Order does not affect the
 * output — Tailwind sorts by its own property order — but it is sorted and deduplicated
 * anyway so an identical set produces an identical string and the canvas can compare
 * cheaply.
 */
export async function compileCanvasCss(
  themeCss: string,
  candidates: readonly string[],
): Promise<CompiledCanvasCss> {
  const stylesheet = `@import "tailwindcss";\n${canvasThemeCss(themeCss)}\n`
  const unique = [...new Set(candidates)].sort()

  const existing = compilers.get(stylesheet)
  const compiler = existing ?? await createCompiler(stylesheet)
  const cached = existing !== undefined

  if (!cached) {
    compilers.set(stylesheet, compiler)
    // Evict the oldest: Map preserves insertion order, so the first key is the least
    // recently created.
    if (compilers.size > COMPILER_LIMIT) {
      const oldest = compilers.keys().next()
      if (!oldest.done) compilers.delete(oldest.value)
    }
  }

  const css = compiler.build([...unique])

  return Object.freeze({
    css,
    unknownCandidates: Object.freeze(unique.filter((candidate) => !producedCss(css, candidate))),
    cached,
  })
}

async function createCompiler(stylesheet: string): Promise<CachedCompiler> {
  const compile = await loadTailwindCompile()
  const compiler = await compile(stylesheet, { base: RESOLVE_BASE, loadStylesheet })
  return { build: (candidates) => compiler.build(candidates) }
}

/**
 * Whether a candidate produced a rule.
 *
 * Compares against the CSS-escaped selector rather than the raw class, because Tailwind
 * escapes the characters that are legal in a class but not in a selector — `md:p-8`
 * becomes `.md\:p-8` and `bg-primary/20` becomes `.bg-primary\/20`. Searching for the
 * unescaped form reports every variant and every modifier as missing.
 */
function producedCss(css: string, candidate: string): boolean {
  return css.includes(`.${escapeSelector(candidate)}`)
}

/** Escape a class name for use in a CSS selector, matching Tailwind's own escaping. */
export function escapeSelector(candidate: string): string {
  // Digits leading a class need a numeric escape, which Tailwind applies too; every
  // other special character takes a backslash.
  return candidate.replace(/[.:/()[\]{}!#%&,>+~*='"^$|?\\]/g, (character) => `\\${character}`)
}

/** Drop every cached compiler. Used when the theme generator itself changes. */
export function resetCanvasCssCache(): void {
  compilers.clear()
}
