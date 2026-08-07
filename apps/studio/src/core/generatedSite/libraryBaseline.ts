/**
 * The library baseline every generated site is built on.
 *
 * Two rules make this file worth having rather than scattering versions through a
 * template:
 *
 * 1. **Every version is exact.** A range means two tenants generated a week apart run
 *    different code, so a bug reproduces on one site and not the other and the difference
 *    is invisible. Exact pins make "which versions is this site on" answerable.
 *
 * 2. **Every version is one this monorepo already runs.** `apps/web` is a real Next site
 *    built and deployed from this repository, so its versions are proven together rather
 *    than merely being each package's latest. An architecture test asserts the two agree,
 *    which means a dependency bump in `apps/web` either updates this baseline or fails.
 *
 * The stack is fixed rather than configurable. A per-tenant choice of form library would
 * multiply the combinations the builder, the AI and the starter template must all support,
 * and none of them would be well tested.
 */

export type PinnedPackage = Readonly<{
  name: string
  version: string
  /** Why the generated site needs it. */
  reason: string
  /** True for packages only needed to build, not to run. */
  dev: boolean
}>

/**
 * Packages whose version must match `apps/web`.
 *
 * Anything the proven site also uses is listed here so drift is caught mechanically. A
 * package `apps/web` does not use cannot be checked this way, and is marked below.
 */
export const BASELINE: readonly PinnedPackage[] = Object.freeze([
  // Runtime.
  Object.freeze({
    name: 'next',
    version: '16.2.9',
    reason: 'The framework. Routing, server components, and the production build are all its.',
    dev: false,
  }),
  Object.freeze({
    name: 'react',
    version: '19.2.5',
    reason: 'Required by Next 16, which will not start against an older major.',
    dev: false,
  }),
  Object.freeze({
    name: 'react-dom',
    version: '19.2.5',
    reason: 'Must match react exactly; a mismatch produces hydration errors that read as application bugs.',
    dev: false,
  }),
  Object.freeze({
    name: 'motion',
    version: '12.43.0',
    reason: 'The animation engine the IR compiles to. Motion+ components are paid, so nothing generated may depend on them.',
    dev: false,
  }),
  Object.freeze({
    name: 'lucide-react',
    version: '1.29.0',
    reason: 'shadcn default icon set, pinned to one version across both apps so an icon cannot differ between admin and site.',
    dev: false,
  }),
  Object.freeze({
    name: 'radix-ui',
    version: '1.6.7',
    reason: 'The unstyled primitives shadcn is built on. Pinned exactly here even though apps/web carries a caret.',
    dev: false,
  }),
  Object.freeze({
    name: 'class-variance-authority',
    version: '0.7.1',
    reason: 'How shadcn expresses component variants. Removing it breaks every variant prop.',
    dev: false,
  }),
  Object.freeze({
    name: 'clsx',
    version: '2.1.1',
    reason: 'Conditional class names. Required by the cn() helper every shadcn component uses.',
    dev: false,
  }),
  Object.freeze({
    name: 'tailwind-merge',
    version: '3.6.0',
    reason: 'Resolves conflicting Tailwind classes at runtime, which is what makes a className override on a shadcn component work.',
    dev: false,
  }),

  // Build.
  Object.freeze({
    name: 'tailwindcss',
    version: '4.3.3',
    reason: 'The styling model. Same version the canvas compiles with, so preview and production cannot disagree.',
    dev: true,
  }),
  Object.freeze({
    name: '@tailwindcss/postcss',
    version: '4.3.3',
    reason: 'Tailwind 4 PostCSS plugin. Must match tailwindcss exactly.',
    dev: true,
  }),
  Object.freeze({
    name: 'postcss',
    version: '8.5.16',
    reason: 'Required by the Tailwind PostCSS plugin, which is how Next processes the stylesheet.',
    dev: true,
  }),
  Object.freeze({
    name: 'typescript',
    version: '6.0.3',
    reason: 'Generated output is typed TSX, so the site must be able to typecheck it.',
    dev: true,
  }),
  Object.freeze({
    name: '@types/react',
    version: '19.2.14',
    reason: 'Types for react 19. A mismatch with the react version produces errors in generated TSX that point at library code rather than at the site.',
    dev: true,
  }),
  Object.freeze({
    name: '@types/react-dom',
    version: '19.2.3',
    reason: 'Types for react-dom 19. Must track @types/react, which must track react.',
    dev: true,
  }),
  Object.freeze({
    name: '@types/node',
    version: '24.12.2',
    reason: 'Next config and build scripts run under Node, so they need its types to typecheck.',
    dev: true,
  }),
  Object.freeze({
    name: 'tw-animate-css',
    version: '1.4.0',
    reason: 'shadcn animation utilities under Tailwind 4, which replaced tailwindcss-animate.',
    dev: true,
  }),
])

/**
 * Packages the generated site needs that `apps/web` does not use.
 *
 * Listed separately and honestly: their versions come from what this monorepo has resolved
 * in its lockfile rather than from a site proven in production, so they carry less
 * evidence than the list above. They are still exact pins.
 */
export const BASELINE_UNPROVEN_IN_WEB: readonly PinnedPackage[] = Object.freeze([
  Object.freeze({
    name: 'zod',
    version: '4.4.3',
    reason:
      'Validation for generated-site forms and route input. Zod belongs to generated sites '
      + 'only — Fuma itself uses TypeBox, and mixing the two inside the builder is what '
      + 'the validator boundary forbids.',
    dev: false,
  }),
  Object.freeze({
    name: 'react-hook-form',
    version: '7.84.0',
    reason: 'Form state for generated sites, which is what shadcn Field is designed around.',
    dev: false,
  }),
  Object.freeze({
    name: '@hookform/resolvers',
    version: '5.7.1',
    reason:
      'Bridges Zod to React Hook Form. Version 5.7.1 declares zod "^3.25.0 || ^4.0.0", so '
      + 'it supports the pinned zod 4.',
    dev: false,
  }),
  Object.freeze({
    name: 'zustand',
    version: '5.0.12',
    reason: 'Client state for generated sites that need it, already proven in the studio admin.',
    dev: false,
  }),
  Object.freeze({
    name: 'next-themes',
    version: '0.4.6',
    reason: 'Dark mode. Already what the hosted admin uses, so one mechanism covers both.',
    dev: false,
  }),
])

/** Everything, in one list. */
export function allBaselinePackages(): readonly PinnedPackage[] {
  return Object.freeze([...BASELINE, ...BASELINE_UNPROVEN_IN_WEB])
}

/** An exact version carries no range operator. */
export function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
}

export function findBaselinePackage(name: string): PinnedPackage | undefined {
  return allBaselinePackages().find((entry) => entry.name === name)
}

/**
 * Build the `package.json` for a generated site.
 *
 * `private: true` because a tenant's site is not a publishable package and an accidental
 * `npm publish` would put their content on a public registry.
 */
export function packageJsonFor(siteName: string): Readonly<Record<string, unknown>> {
  const dependencies: Record<string, string> = {}
  const devDependencies: Record<string, string> = {}

  for (const entry of allBaselinePackages()) {
    const target = entry.dev ? devDependencies : dependencies
    target[entry.name] = entry.version
  }

  return Object.freeze({
    name: normalisePackageName(siteName),
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: Object.freeze({
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      typecheck: 'tsc --noEmit',
    }),
    // Sorted so two generations of the same site produce byte-identical files and a diff
    // shows only what actually changed.
    dependencies: Object.freeze(sortKeys(dependencies)),
    devDependencies: Object.freeze(sortKeys(devDependencies)),
  })
}

/**
 * Turn a site name into a legal npm package name.
 *
 * npm rejects uppercase and most punctuation, and a package.json npm refuses to read
 * fails the build with an error that says nothing about the site's name.
 */
export function normalisePackageName(siteName: string): string {
  const slug = siteName
    .toLowerCase()
    .replace(/[^a-z0-9-~]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 214)
  return slug === '' ? 'site' : slug
}

function sortKeys(source: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).sort(([left], [right]) => left.localeCompare(right)))
}
