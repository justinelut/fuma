/**
 * Plugin ABI v2: one sandbox boundary rather than two with a hole in the middle.
 *
 * WHAT V1 ACTUALLY IS, read from the shipped code rather than assumed, because the answer is
 * asymmetric and the asymmetry is the whole subject of this task:
 *
 *  - THE BACKEND IS GENUINELY SANDBOXED. A plugin's server entrypoint runs in a QuickJS-WASM VM
 *    with a 64 MB heap, a 1 MB stack and a 5 s evaluation timeout (quickjs/limits.ts). No
 *    filesystem, no environment, and no network unless the site owner grants one host at a time.
 *    That is a real boundary and it should survive v2 unchanged.
 *
 *  - `editor.code` IS A HOLE STRAIGHT THROUGH IT. Its own declaration in the permission list says
 *    so: "Unsandboxed admin-window code... plugin JavaScript that the host dynamically imports
 *    into the main admin window, where it runs with full admin-origin privileges (admin API with
 *    credentials, localStorage, DOM)."
 *
 * SO THE HONEST STATEMENT OF V1 IS NOT "PLUGINS ARE SANDBOXED". It is that plugin BACKENDS are,
 * and a plugin holding one permission runs as the admin. Every other permission in the list gates
 * a specific host API; that one gates whether the plugin's own code is loaded into the admin window
 * at all, which makes the rest of the list advisory for any plugin that holds it.
 *
 * THAT IS NOT A BUG SOMEBODY INTRODUCED. An editor extension has to render UI, and rendering React
 * inside a WASM VM with no DOM is not possible. The permission is honestly named and honestly
 * documented. v2's job is to make the capability available WITHOUT the privilege, not to pretend
 * the privilege was never needed.
 */

/** Where a piece of plugin code runs. */
export type ExecutionTier =
  /** QuickJS-WASM VM, no ambient capability. Where a plugin's server logic belongs. */
  | 'backend-sandbox'
  /**
   * A separate browsing context (iframe) with its own origin, talking to the host over messages.
   * Can render, cannot read the admin session.
   */
  | 'ui-frame'
  /**
   * The admin window itself, with admin-origin credentials. What `editor.code` grants today.
   */
  | 'admin-window'

export type AbiVersion = 1 | 2

/** What a tier can reach, stated rather than implied. */
export type TierCapabilities = Readonly<{
  tier: ExecutionTier
  /** Can it render DOM the user sees? */
  rendersUi: boolean
  /** Can it read the admin session cookie or call the admin API as the signed-in staff user? */
  actsAsTheAdmin: boolean
  /** Can it read the admin window's storage? */
  readsAdminStorage: boolean
  /** Is it bounded by memory and time limits the host sets? */
  resourceBounded: boolean
}>

export const TIERS: readonly TierCapabilities[] = Object.freeze([
  Object.freeze({
    tier: 'backend-sandbox' as const,
    rendersUi: false,
    actsAsTheAdmin: false,
    readsAdminStorage: false,
    resourceBounded: true,
  }),
  Object.freeze({
    tier: 'ui-frame' as const,
    rendersUi: true,
    actsAsTheAdmin: false,
    readsAdminStorage: false,
    // A frame can be given a memory-and-time budget by the host, but the browser enforces it far
    // less precisely than QuickJS does. Recorded as bounded because the host can still terminate it.
    resourceBounded: true,
  }),
  Object.freeze({
    tier: 'admin-window' as const,
    rendersUi: true,
    actsAsTheAdmin: true,
    readsAdminStorage: true,
    resourceBounded: false,
  }),
])

export function capabilitiesOf(tier: ExecutionTier): TierCapabilities {
  const found = TIERS.find((entry) => entry.tier === tier)
  if (!found) throw new Error(`Unknown execution tier: ${tier}`)
  return found
}

/**
 * THE ONE RULE V2 ADDS: rendering UI must not require acting as the admin.
 *
 * v1 offers only two tiers, and the only one that can render is also the one that can do anything
 * the signed-in staff user can. So an author who wants a toolbar button must ask for a permission
 * that also permits reading the session and calling every admin endpoint - and a site owner
 * granting it has no way to grant less.
 *
 * v2 adds `ui-frame`, which separates the two. That is the whole point: the capability an editor
 * extension actually needs is a place to draw and a way to ask the host for things, not the
 * admin's identity.
 */
export function requiresAdminPrivilegeToRender(version: AbiVersion): boolean {
  if (version === 1) return true
  return false
}

export type BoundaryProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews a proposed plugin surface against the boundary.
 *
 * Every check here describes a way the boundary is crossed while looking as though it holds.
 */
export function reviewBoundary(proposed: Readonly<{
  version: AbiVersion
  tier: ExecutionTier
  /** Whether the surface needs to render UI. */
  needsUi: boolean
  /** Whether the host validates every message the surface sends before acting on it. */
  messagesValidated: boolean
  /** Whether the frame is given its own origin rather than the admin's. */
  ownOrigin: boolean
}>): readonly BoundaryProblem[] {
  const problems: BoundaryProblem[] = []
  const caps = capabilitiesOf(proposed.tier)

  if (proposed.needsUi && !caps.rendersUi) {
    problems.push({
      code: 'cannot-render-here',
      message: 'This surface needs to draw something and this tier has no DOM. Rendering React inside the WASM VM is not possible, which is exactly why the admin-window tier exists in v1.',
    })
  }

  if (proposed.version === 2 && proposed.tier === 'admin-window') {
    problems.push({
      code: 'admin-window-under-v2',
      message: 'Under v2 a plugin surface that renders belongs in a frame with its own origin. Running in the admin window gives it the signed-in user\'s credentials, so every other permission it holds becomes advisory.',
    })
  }

  if (proposed.tier === 'ui-frame' && !proposed.ownOrigin) {
    // A same-origin iframe is not a boundary at all: the parent and child can reach into each
    // other, so the frame would have the admin window's privileges by another route.
    problems.push({
      code: 'frame-shares-admin-origin',
      message: 'A same-origin frame is not a boundary - the frame can reach the parent document and its storage directly. The isolation only exists if the origin differs.',
    })
  }

  if (proposed.tier !== 'backend-sandbox' && !proposed.messagesValidated) {
    problems.push({
      code: 'messages-unvalidated',
      message: 'A frame that can ask the host to act must have every message checked, because the frame is the untrusted side. Trusting its messages moves the privilege back across the boundary while the boundary still looks intact.',
    })
  }

  return Object.freeze(problems)
}

/**
 * What v2 preserves from v1 without change, so the migration is not read as a rewrite.
 *
 * The backend sandbox is the part of v1 that was right, and re-deciding it would be the commonest
 * way a version bump makes things worse.
 */
export const PRESERVED_FROM_V1 = Object.freeze({
  backendSandbox: 'QuickJS-WASM with a bounded heap, stack and evaluation timeout.',
  networkByGrant: 'No network at all unless the site owner grants a host, one host at a time.',
  noAmbientCapability: 'No filesystem and no environment variables inside the VM.',
  reason: 'These are the properties that make a plugin backend safe to install, and they are already enforced rather than documented. v2 changes what a UI surface may reach, not what a backend may.',
})

/**
 * The honest migration position.
 *
 * `editor.code` cannot simply be deleted: the surfaces that hold it - editor entrypoints and
 * app-kind admin pages - have no other way to render today. So v2 introduces the frame tier first
 * and the permission is retired only once a real extension has been rebuilt on it.
 */
export const MIGRATION = Object.freeze({
  permission: 'editor.code',
  cannotBeRemovedYet: 'Editor entrypoints and app-kind admin pages have no other tier that can render, so removing it would break every installed editor extension with no replacement to move to.',
  sequence: Object.freeze([
    'Add the frame tier and the host message surface it talks to.',
    'Rebuild one real editor extension on it, so the tier is proven by use rather than by design.',
    'Mark editor.code deprecated, with the frame tier named as the replacement.',
    'Retire editor.code once installed extensions have moved.',
  ]),
  whyNotSooner: 'A permission removed before its replacement is proven leaves authors with a capability gap and no route out, which is how a plugin ecosystem stops being maintained.',
})
