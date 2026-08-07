/**
 * Emits a tenant's starting workspace: the starter, the shadcn component set, the form field
 * primitives and the member-auth pages.
 *
 * WHY THIS LIVES SERVER-SIDE RATHER THAN BESIDE THE SCAFFOLDS IT CALLS. Tasks 71, 75 and 93 each
 * built the SOURCE for these files and each recorded the same gap: nothing emitted them. That was not
 * an oversight but a placement problem. The shadcn components are not generated from a template - they
 * are the REAL admin files at `src/admin/fuma/ui/`, rewritten for a tenant - so emitting them means
 * READING FILES FROM DISK. `src/core/generatedSite/` is browser-shared and has no filesystem, which is
 * exactly why `starterTemplate.ts` uses template literals for everything it produces.
 *
 * So the emit belongs here, next to `moduleStore`, which is also the only thing that can persist the
 * result under a tenant scope.
 *
 * THE PROPERTY THAT MATTERS MOST: A COMPONENT IS COPIED, NEVER IMPORTED FROM US. Task 61 established
 * the reason - a tenant page that imports our package is only as portable as our package, and the
 * product's claim is that the emitted source is theirs to take and leave. `rewriteForTenant` is what
 * makes that true, and a leftover `@admin/` specifier would be an import that cannot resolve in their
 * repository at all, so the emit REFUSES rather than writing a file that cannot build.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TENANT_SHADCN_COMPONENTS,
  rewriteForTenant,
  tenantPathFor,
  type TenantComponent,
} from '@core/generatedSite/shadcnBaseline'
import { fieldPrimitivesSource } from '@core/generatedSite/formScaffold'
import {
  memberOnlySource,
  memberSessionSource,
  signInPageSource,
  signUpPageSource,
} from '@core/generatedSite/siteAuthScaffold'
import { starterFiles } from '@core/generatedSite/starterTemplate'

/** A file to write into the tenant's workspace. */
export type ScaffoldFile = Readonly<{
  path: string
  source: string
  /**
   * True when the reader can open it, so it belongs in the module store and on the canvas.
   * Configuration goes to disk for the build and is deliberately not offered to a designer.
   */
  module: boolean
}>

export type ScaffoldProblem = Readonly<{ code: string; path: string; message: string }>

export type ScaffoldResult = Readonly<{
  files: readonly ScaffoldFile[]
  problems: readonly ScaffoldProblem[]
}>

/**
 * Where the admin's shadcn components live. Read at emit time rather than bundled, because these are
 * the same files the admin itself renders - which is the point: a tenant receives what we use, not a
 * copy that drifts from it.
 */
export const ADMIN_UI_DIRECTORY = 'src/admin/fuma/ui'

/** Every component the tenant baseline declares, in a stable order so two emits are identical. */
function componentsToEmit(): readonly TenantComponent[] {
  return [...TENANT_SHADCN_COMPONENTS].sort((a, b) => a.name.localeCompare(b.name))
}

async function readAdminComponent(studioRoot: string, name: string): Promise<string | null> {
  try {
    return await readFile(join(studioRoot, ADMIN_UI_DIRECTORY, `${name}.tsx`), 'utf8')
  } catch {
    return null
  }
}

/**
 * Builds the whole starting workspace.
 *
 * Returns files rather than writing them, for the same reason `starterFiles` does: the same set has to
 * be able to go to the module store for editing, to a temp directory for a build, and into an
 * assertion. A function that wrote directly could only serve the first.
 */
export async function scaffoldTenantWorkspace(
  studioRoot: string,
  siteName: string,
): Promise<ScaffoldResult> {
  const files: ScaffoldFile[] = []
  const problems: ScaffoldProblem[] = []

  // The starter first, because it declares app/layout.tsx and app/globals.css that everything else
  // renders inside. Its own `module` flag already separates editable modules from configuration.
  for (const file of starterFiles(siteName)) {
    files.push({ path: file.path, source: file.content, module: file.module })
  }

  for (const component of componentsToEmit()) {
    const source = await readAdminComponent(studioRoot, component.name)
    if (source === null) {
      // A declared component that is not on disk would emit an import to a file that does not exist,
      // so the tenant's build fails on a missing module - the failure class task 71 exists to avoid.
      problems.push({
        code: 'component-source-missing',
        path: `${ADMIN_UI_DIRECTORY}/${component.name}.tsx`,
        message: `The tenant baseline declares "${component.name}" but its source is not at ${ADMIN_UI_DIRECTORY}. `
          + 'Emitting the set without it would leave every file that imports it unable to resolve.',
      })
      continue
    }
    const rewritten = rewriteForTenant(source)
    const path = tenantPathFor(component.name)
    if (rewritten.includes('@admin/')) {
      // Refused rather than written: an admin path inside a tenant file is an import their repository
      // cannot resolve, and a file that cannot build is worse than one that is absent.
      problems.push({
        code: 'admin-path-survived-rewrite',
        path,
        message: `"${component.name}" still names an @admin/ path after rewriting, so it would not resolve `
          + 'in the tenant\'s own repository. The rewrite needs a rule for that specifier.',
      })
      continue
    }
    files.push({ path, source: rewritten, module: true })
  }

  // The Field primitives are EMITTED SOURCE rather than a copied admin file, because task 23's
  // validator boundary means the admin deliberately has no Field component - it carries no zod and no
  // react-hook-form. So this half of the form vocabulary can only come from the scaffold.
  files.push({ path: 'components/ui/field.tsx', source: fieldPrimitivesSource(), module: true })

  // Member auth: the session provider, the two pages and the content guard. The guard is named
  // MemberOnly rather than ProtectedRoute because it protects CONTENT - the route's own file stays
  // public, which is the finding task 93 recorded.
  // AT lib/, NOT components/: the emitted auth pages import '@/lib/member-session'. Writing it
  // elsewhere produced a file whose own siblings could not import it - found by compiling the emit,
  // which is the only place a path disagreement between two generators can show up.
  files.push({ path: 'lib/member-session.tsx', source: memberSessionSource(), module: true })
  files.push({ path: 'components/member-only.tsx', source: memberOnlySource(), module: true })
  files.push({ path: 'app/sign-in/page.tsx', source: signInPageSource(), module: true })
  files.push({ path: 'app/sign-up/page.tsx', source: signUpPageSource(), module: true })

  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.path)) {
      // Which file won would be decided by write order, so the same scaffold could install two
      // different ways - the duplicate-path problem task 90's reviewTemplate already refuses.
      problems.push({
        code: 'duplicate-path',
        path: file.path,
        message: `Two scaffold sources both claim ${file.path}, so which one the tenant receives would `
          + 'depend on write order.',
      })
    }
    seen.add(file.path)
  }

  return { files: Object.freeze(files), problems: Object.freeze(problems) }
}

/** A minimal write surface, so this module does not depend on the whole ModuleStore type. */
export type ScaffoldWriter = Readonly<{
  get: (path: string) => Promise<{ source: string } | null>
  put: (path: string, source: string, hash: string, updatedAt: string) => Promise<void>
}>

export type PersistOutcome = Readonly<{
  written: readonly string[]
  skipped: readonly string[]
  problems: readonly ScaffoldProblem[]
}>

/**
 * Persists the module-kind files into a tenant's workspace.
 *
 * NEVER OVERWRITES. A path that already holds something is skipped and reported, because scaffolding
 * over a tenant's own edit destroys work they have no copy of - the same rule task 85's install
 * follows. That also makes this safe to re-run: a site missing only the auth pages receives them
 * without its edited home page being replaced.
 */
export async function persistScaffold(
  writer: ScaffoldWriter,
  result: ScaffoldResult,
  hashOf: (source: string) => Promise<string>,
  now: string,
): Promise<PersistOutcome> {
  const written: string[] = []
  const skipped: string[] = []
  const problems: ScaffoldProblem[] = [...result.problems]

  for (const file of result.files) {
    // Configuration is not a module: the store is keyed by the editor's page/layout/component kinds,
    // and a tsconfig has no kind to be stored under.
    if (!file.module) continue
    const existing = await writer.get(file.path)
    if (existing !== null) {
      skipped.push(file.path)
      continue
    }
    await writer.put(file.path, file.source, await hashOf(file.source), now)
    written.push(file.path)
  }

  return { written: Object.freeze(written), skipped: Object.freeze(skipped), problems: Object.freeze(problems) }
}
