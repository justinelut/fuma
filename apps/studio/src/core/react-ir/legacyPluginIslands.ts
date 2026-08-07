/**
 * Running legacy plugin modules inside the React engine, as opaque islands.
 *
 * WHY A COMPATIBILITY TIER IS NEEDED AT ALL: a plugin canvas module is a ModuleDefinition whose
 * `render(props, children)` returns an HTML STRING. The React engine has no string concatenation
 * step, so on the face of it every installed plugin module stops working the day the engine
 * changes - and a plugin is somebody else's code we cannot rewrite.
 *
 * THE FACT THAT MAKES A TIER POSSIBLE, read from the SDK's own contract rather than assumed:
 * `PluginRenderFn = (props, children) => PluginRenderOutput` and its documentation says the
 * function is PURE - "NEVER use document/window/React. NEVER call fetch." So its output depends on
 * nothing but its inputs. That is exactly the property a build-time island needs: the HTML can be
 * computed once during the build and frozen into the output, and it is identical every time.
 * A module that broke that rule was already broken; it is not newly broken here.
 *
 * === THE TWO ESCAPING RULES MEET AT THIS BOUNDARY, AND BOTH MUST HOLD ===
 *
 * This is the sharpest thing in the file. Task 62 established that under React a pre-escaped prop
 * is escaped twice and the visitor sees the entities, so the React engine must NOT pre-escape.
 * But the plugin contract says render() "Receives escaped string props" - because it CONCATENATES
 * those props into markup.
 *
 * So the boundary must do BOTH, and in opposite directions:
 *   - the React tree around the island: props NOT escaped (React escapes at render).
 *   - the props handed INTO a legacy render(): STILL ESCAPED, because the plugin builds a string
 *     and an unescaped prop concatenated into markup is an injection, not a display defect.
 * Removing the pre-escaping here because "React handles escaping now" would be the most plausible
 * wrong edit anybody could make to this file, and it would open an XSS in every legacy module.
 * That is why the rule is stated as data below and asserted by test.
 */

/** How a legacy module's output reaches the page. */
export type IslandEmbedding =
  /**
   * The HTML is placed with dangerouslySetInnerHTML inside a container element the engine does not
   * look inside. The engine treats the region as opaque: it will not restyle or reparent it.
   */
  | 'inner-html'
  /**
   * Refused. The module cannot be represented as an island, so it is reported rather than rendered
   * approximately.
   */
  | 'unsupported'

export type LegacyModuleFacts = Readonly<{
  moduleId: string
  /** Whether the module honours the SDK's purity rule (no document/window/fetch). */
  isPure: boolean
  /** Whether the module ships a client runtime (PluginRenderOutput.js). */
  shipsJs: boolean
  /** Whether the module declares it can hold child modules. */
  canHaveChildren: boolean
}>

export type IslandPlan = Readonly<{
  moduleId: string
  embedding: IslandEmbedding
  /** Whether the HTML must pass a sanitiser before it reaches the DOM. Always true when embedded. */
  requiresSanitiser: boolean
  /** Whether props handed to render() must be escaped first. Always true when embedded. */
  requiresEscapedProps: boolean
  /**
   * How the module's client runtime reaches the page, if it has one.
   *
   * NOT inside the island: a script tag written into innerHTML DOES NOT EXECUTE - the browser
   * refuses to run scripts inserted that way. A plugin whose behaviour lives in that script would
   * render its markup and silently do nothing, which reads as the plugin being broken. So the
   * runtime travels as a page contribution instead.
   */
  runtimeDelivery: 'page-contribution' | 'none'
  reason: string
}>

export function planIsland(facts: LegacyModuleFacts): IslandPlan {
  if (!facts.isPure) {
    return Object.freeze({
      moduleId: facts.moduleId,
      embedding: 'unsupported' as const,
      requiresSanitiser: false,
      requiresEscapedProps: false,
      runtimeDelivery: 'none' as const,
      reason: 'This module reads the document, the window, or the network during render. Its output is not a function of its props, so it cannot be computed once at build time. The SDK already forbids this.',
    })
  }

  return Object.freeze({
    moduleId: facts.moduleId,
    embedding: 'inner-html' as const,
    // Not conditional on the current output looking safe: the SINK bypasses React's escaping, so
    // the requirement holds for every value that will ever pass through it.
    requiresSanitiser: true,
    // The plugin concatenates props into markup, so escaping them is what stops an injection.
    requiresEscapedProps: true,
    runtimeDelivery: facts.shipsJs ? ('page-contribution' as const) : ('none' as const),
    reason: 'Its render is pure, so the HTML can be produced during the build and embedded as a region the engine does not look inside.',
  })
}

export type IslandProblem = Readonly<{ moduleId: string; code: string; message: string }>

/**
 * Checks a proposed island against the properties that keep it safe and honest.
 *
 * Each of these fails SILENTLY if it is wrong, which is why they are checked rather than trusted.
 */
export function reviewIsland(proposed: Readonly<{
  moduleId: string
  embedding: IslandEmbedding
  sanitiserApplied: boolean
  propsEscaped: boolean
  /** Whether the plan puts the module's client runtime inside the island HTML. */
  runtimeInsideHtml: boolean
  /** Whether the engine's own styling is applied to nodes inside the island. */
  engineStylesInside: boolean
}>): readonly IslandProblem[] {
  const problems: IslandProblem[] = []
  if (proposed.embedding !== 'inner-html') return Object.freeze(problems)

  if (!proposed.sanitiserApplied) {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'unsanitised-island',
      message: 'This HTML reaches the DOM through dangerouslySetInnerHTML, which is the one path that bypasses React\'s escaping. Without a sanitiser a plugin can put a script on every page that uses it.',
    })
  }

  if (!proposed.propsEscaped) {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'unescaped-props-to-legacy-render',
      message: 'A legacy render concatenates its props into markup, so an unescaped prop is an injection. React escaping the surrounding tree does not help here, because this string never passes through React.',
    })
  }

  if (proposed.runtimeInsideHtml) {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'script-in-inner-html',
      message: 'A script tag inserted through innerHTML does not execute. The markup would appear and the behaviour would be silently absent, which reads as the plugin being broken.',
    })
  }

  if (proposed.engineStylesInside) {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'engine-styles-inside-island',
      message: 'The engine cannot see inside this region, so applying its own classes there would style nodes it does not model - and the plugin\'s next version would silently move them.',
    })
  }

  return Object.freeze(problems)
}

/**
 * What the tier deliberately does NOT promise.
 *
 * A compatibility tier that claims parity is worse than one that states its limits, because the
 * gaps are discovered by a plugin author whose module half-works.
 */
export const TIER_LIMITS: readonly Readonly<{ limit: string; why: string }>[] = Object.freeze([
  Object.freeze({
    limit: 'The island is not editable on the canvas.',
    why: 'The engine does not model what is inside it, so it has nothing to select, restyle or reorder. Offering handles that do nothing is worse than offering none.',
  }),
  Object.freeze({
    limit: 'Its output is frozen at build time.',
    why: 'A static release has no per-request step. A module whose HTML should vary per visitor cannot be an island, and the SDK already required purity so this is not a new restriction.',
  }),
  Object.freeze({
    limit: 'Tailwind will not generate CSS for classes inside it.',
    why: 'The class scanner reads the IR, and the IR does not contain the island\'s markup. So a legacy module must ship its own CSS, which is exactly what PluginRenderOutput.css is for.',
  }),
  Object.freeze({
    limit: 'Child modules are rendered by the legacy path, not composed by the engine.',
    why: 'render() receives children as HTML STRINGS, so a React child cannot be handed to it. Mixing the two would mean a subtree that is half engine-modelled and half not.',
  }),
])

/**
 * The escaping rules at this boundary, recorded as data in one place.
 *
 * Written down because the two rules are opposite and the wrong one looks like a tidy-up.
 */
export const BOUNDARY_ESCAPING = Object.freeze({
  reactTree: Object.freeze({
    escapeProps: false,
    why: 'React escapes text children and attribute values as it renders. Escaping first shows the visitor the entities.',
  }),
  legacyRender: Object.freeze({
    escapeProps: true,
    why: 'A legacy render concatenates props into a markup string, so escaping is what prevents an injection. This string never passes through React.',
  }),
})

/**
 * Why the retiring of `publish.html` waited for this tier.
 *
 * The filter cannot be removed while a plugin has no other way to contribute to a page, so the
 * replacement vocabulary and this tier together are what make the removal safe rather than
 * merely desirable.
 */
export const RETIREMENT_SEQUENCE = Object.freeze({
  filter: 'publish.html',
  blockedUntil: 'A plugin has a supported way to add to the head and before body end, and a supported way to render its own modules.',
  nowAvailable: Object.freeze(['page contributions (head / body-end)', 'opaque islands for legacy modules']),
  remaining: 'Installed plugins must be migrated before the filter is deleted, because deleting it silently stops their contributions rather than telling anybody.',
})
