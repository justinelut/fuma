/**
 * shadcn as the default building blocks of a generated site.
 *
 * WHY THIS IS EMITTED AS SOURCE RATHER THAN IMPORTED FROM A PACKAGE, which is also shadcn's own
 * model: a shadcn component is copied into the project and owned by it. That matters more here than
 * it does for most projects, because task 61 established the rule the whole engine rests on - a
 * tenant page must not depend on our runtime, or their site is only as portable as our package.
 * Emitting the source keeps the tenant able to take the repository and leave.
 *
 * THE ADMIN ALREADY SHIPS THESE COMPONENTS (src/admin/fuma/ui/), so the set is not invented here.
 * It is DERIVED from what exists, and the accompanying test reads those files rather than trusting
 * this list - the same discipline libraryBaseline uses against apps/web/package.json, and the only
 * way a list like this stays true without somebody remembering to maintain it.
 *
 * THE MEMBERSHIP RULE, and it is the substance of the task: A COMPONENT SHIPS TO A TENANT ONLY IF
 * EVERY PACKAGE IT IMPORTS IS PINNED IN THE LIBRARY BASELINE. Seven of the admin's components pull
 * packages the tenant baseline deliberately does not carry - recharts, vaul, sonner,
 * react-resizable-panels, input-otp, cmdk, embla-carousel-react. Emitting one of those produces a
 * site whose `npm install` succeeds and whose BUILD FAILS on a missing module, which reads as the
 * generated site being broken rather than as a component that was never available. So membership is
 * decided by dependency rather than by taste, and adding a component means pinning its package
 * first - a visible, reviewable act rather than a silent breakage.
 */

/** The unstyled primitive library beneath shadcn. */
export const PRIMITIVE_PACKAGE = 'radix-ui'

/**
 * A component the generated site receives.
 *
 * `primitive` names the radix primitive it wraps, or null when it is styled markup with no
 * primitive beneath it. That distinction is what makes the unstyled layer usable directly: a
 * designer needing behaviour shadcn does not style can reach the primitive rather than being stuck
 * with the styled component or writing the behaviour again.
 */
export type TenantComponent = Readonly<{
  /** File name under components/ui/, without the extension. */
  name: string
  /** The radix primitive it wraps, or null when there is none. */
  primitive: string | null
  /** Why a generated site is given this one. */
  reason: string
}>

/**
 * The set a generated site receives.
 *
 * Chosen to cover what a real site needs rather than everything the admin happens to have: layout
 * and surface, typography-adjacent structure, the form controls task 75 composes, navigation and
 * feedback. Every entry's imports are asserted pinned by the accompanying test.
 */
export const TENANT_SHADCN_COMPONENTS: readonly TenantComponent[] = Object.freeze([
  Object.freeze({ name: 'button', primitive: 'Slot', reason: 'Every site has actions, and asChild is how a button becomes a link without losing its styling.' }),
  Object.freeze({ name: 'card', primitive: null, reason: 'The commonest surface for a summary, a product or a post, and it is plain markup so it costs no primitive.' }),
  Object.freeze({ name: 'input', primitive: null, reason: 'Required by any form, and task 75 composes it with React Hook Form.' }),
  Object.freeze({ name: 'textarea', primitive: null, reason: 'A contact form needs a message field, which an input cannot be.' }),
  Object.freeze({ name: 'label', primitive: 'Label', reason: 'A control without an associated label is unusable with a screen reader, and the primitive is what associates it.' }),
  Object.freeze({ name: 'checkbox', primitive: 'Checkbox', reason: 'Consent and preference fields, where the native control cannot be styled consistently.' }),
  Object.freeze({ name: 'radio-group', primitive: 'RadioGroup', reason: 'A single choice among a few, with the roving focus the primitive provides.' }),
  Object.freeze({ name: 'select', primitive: 'Select', reason: 'A single choice among many, where the native element cannot carry the site\'s styling.' }),
  Object.freeze({ name: 'switch', primitive: 'Switch', reason: 'An immediate on/off, which reads differently from a checkbox that waits for submit.' }),
  Object.freeze({ name: 'separator', primitive: 'Separator', reason: 'A divider that is announced as one rather than being a bare border.' }),
  Object.freeze({ name: 'badge', primitive: 'Slot', reason: 'Status and category marks, which otherwise get rebuilt per page with drifting styles.' }),
  Object.freeze({ name: 'avatar', primitive: 'Avatar', reason: 'Author and testimonial images, with the fallback the primitive handles when an image fails.' }),
  Object.freeze({ name: 'accordion', primitive: 'Accordion', reason: 'An FAQ is the commonest page a site owner adds after the first three.' }),
  Object.freeze({ name: 'tabs', primitive: 'Tabs', reason: 'Grouping content without a navigation, with keyboard behaviour that is genuinely hard to write.' }),
  Object.freeze({ name: 'dialog', primitive: 'Dialog', reason: 'Focus trapping and scroll locking are what a hand-written modal always gets wrong.' }),
  Object.freeze({ name: 'sheet', primitive: 'Dialog', reason: 'The mobile navigation pattern, which is a dialog from the edge rather than a separate concept.' }),
  Object.freeze({ name: 'dropdown-menu', primitive: 'DropdownMenu', reason: 'Site navigation with submenus, where typeahead and focus order come from the primitive.' }),
  Object.freeze({ name: 'navigation-menu', primitive: 'NavigationMenu', reason: 'The header pattern for a site with sections, announced as a navigation.' }),
  Object.freeze({ name: 'tooltip', primitive: 'Tooltip', reason: 'Explaining an icon-only control, which is otherwise unlabelled.' }),
  Object.freeze({ name: 'alert', primitive: null, reason: 'Form outcomes and page-level notices, so a site does not invent its own error styling.' }),
  Object.freeze({ name: 'skeleton', primitive: null, reason: 'A loading placeholder that reserves space, so streamed content does not shift the page.' }),
  Object.freeze({ name: 'aspect-ratio', primitive: 'AspectRatio', reason: 'Media that reserves its box before loading, which is the layout-shift fix.' }),
  Object.freeze({ name: 'table', primitive: null, reason: 'Pricing and specification tables, kept as real table markup so it stays readable to assistive technology.' }),
  Object.freeze({ name: 'progress', primitive: 'Progress', reason: 'A measured value with the accessible role, rather than a styled div.' }),
])

/**
 * Packages a generated site is allowed to import.
 *
 * Deliberately a function of the baseline rather than a second list: a component is shippable
 * because its dependency is pinned, and restating the pinned set here would let the two disagree.
 */
export function isTenantImportable(
  specifier: string,
  pinnedPackages: readonly string[],
): boolean {
  // A tenant-relative import is resolved inside the generated site, so it needs no pin.
  if (specifier.startsWith('@/') || specifier.startsWith('.')) return true
  // Sub-path imports resolve against their package root ('react-dom/server' -> 'react-dom').
  const root = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]!
  return pinnedPackages.includes(root)
}

/** The two admin-only specifiers an emitted component must no longer carry. */
export const ADMIN_SPECIFIERS: readonly string[] = Object.freeze([
  '@admin/fuma/ui/cn',
  './cn',
])

/**
 * Rewrites an admin component's imports for a generated site.
 *
 * The admin resolves `cn` through its own path alias, which does not exist in a tenant site - so an
 * unrewritten component fails to resolve a module the tenant has under another name. The starter
 * already emits lib/utils.ts, so the target exists by construction.
 */
export function rewriteForTenant(source: string): string {
  return source
    .replaceAll('"@admin/fuma/ui/cn"', '"@/lib/utils"')
    .replaceAll("'@admin/fuma/ui/cn'", "'@/lib/utils'")
    .replaceAll('"./cn"', '"@/lib/utils"')
    .replaceAll("'./cn'", "'@/lib/utils'")
    // A component composing another one resolves it through the tenant's own components directory.
    .replaceAll('"@admin/fuma/ui/', '"@/components/ui/')
    .replaceAll("'@admin/fuma/ui/", "'@/components/ui/")
}

/** Where an emitted component lands in the generated site. */
export function tenantPathFor(name: string): string {
  return `components/ui/${name}.tsx`
}

export type BaselineProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews an emitted component for the ways it silently fails in a tenant site.
 */
export function reviewTenantComponent(emitted: Readonly<{
  name: string
  source: string
  /** Package specifiers the source imports. */
  imports: readonly string[]
  pinnedPackages: readonly string[]
}>): readonly BaselineProblem[] {
  const problems: BaselineProblem[] = []

  for (const specifier of ADMIN_SPECIFIERS) {
    if (emitted.source.includes(`"${specifier}"`) || emitted.source.includes(`'${specifier}'`)) {
      problems.push({
        code: 'admin-path-survived',
        message: `${emitted.name} still imports ${specifier}, which does not resolve inside a generated site, so the tenant's build fails on a module they appear to have.`,
      })
    }
  }

  for (const specifier of emitted.imports) {
    if (!isTenantImportable(specifier, emitted.pinnedPackages)) {
      problems.push({
        code: 'dependency-not-pinned',
        message: `${emitted.name} imports ${specifier}, which the generated-site baseline does not pin. Install would succeed and the build would fail on a missing module, which reads as the site being broken.`,
      })
    }
  }

  return Object.freeze(problems)
}

/**
 * Task 73: the unstyled layer, stated so it is a supported route rather than a workaround.
 */
export const PRIMITIVE_LAYER = Object.freeze({
  package: PRIMITIVE_PACKAGE,
  why: 'shadcn is styling over radix primitives, so the primitives are already installed and versioned for every generated site. A designer needing behaviour shadcn does not style reaches the primitive rather than reimplementing focus management.',
  whenToUseDirectly: 'When no shadcn component wraps the primitive that is needed - a Toolbar, a Slider with two thumbs, a Menubar the site styles itself.',
  cost: 'A primitive used directly arrives unstyled, so the site must supply every class. That is the trade being made deliberately, not an oversight.',
})

/** Recorded because "the default building blocks" is a claim that has to mean something checkable. */
export const DEFAULT_BLOCKS = Object.freeze({
  rule: 'A generated page composes shadcn components before it composes bare elements, and the AI is instructed to do the same.',
  why: 'A hand-rolled button drifts from every other button on the site and carries none of the focus, disabled or aria behaviour. Consistency comes from the components rather than from discipline.',
  escape: 'Bare elements remain available for structure - a section, a grid, a paragraph. Wrapping those in components would add indirection the canvas cannot style.',
})
