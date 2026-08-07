/**
 * Package a designed site as a sellable Template, and install one back.
 *
 * Export and import come before selling, and that ordering is the decision recorded in
 * `docs/architecture/blocks-layouts-templates.md`: **a template that cannot round-trip is
 * unsellable at any price.** A buyer who installs a template and gets something the builder
 * cannot open has bought nothing, and the failure surfaces after payment.
 *
 * So the two directions are built together and the round trip is the acceptance test, not a
 * nice property. `exportSite` produces a Template; `installTemplate` turns it back into files;
 * exporting those files again produces the same Template.
 */

import { Value } from '@sinclair/typebox/value'
import {
  SiteTemplateSchema,
  reviewTemplate,
  type ModuleKind,
  type SiteTemplate,
  type TemplateProblem,
} from './vocabulary'
import { readModuleSource } from './read'
import { allBaselinePackages, isExactVersion } from '../generatedSite/libraryBaseline'

/** A module as it exists on the designed site. */
export type SourceModule = Readonly<{
  path: string
  kind: ModuleKind
  source: string
}>

export type ExportInput = Readonly<{
  id: string
  name: string
  description: string
  version: string
  modules: readonly SourceModule[]
  themeCss: string
  seedContent?: string
}>

export type ExportProblem = Readonly<{
  code:
    | 'unreadable-module'
    | 'private-reference'
    | 'no-seed-content'
    | 'no-modules'
    | 'invalid-shape'
  path: string | null
  message: string
}>

export type ExportResult = Readonly<{
  /** The packaged template, or null when it could not be packaged. */
  template: SiteTemplate | null
  /** Everything that would make the template unsellable or unsafe to publish. */
  problems: readonly ExportProblem[]
  /** Things a seller should look at but which do not block packaging. */
  warnings: readonly ExportProblem[]
}>

/**
 * Hosts that are the author's own rather than the buyer's.
 *
 * A designed site fetches from somewhere. Exported verbatim, every buyer's copy calls the
 * AUTHOR'S endpoint — which either breaks for them (the host refuses an unknown origin) or,
 * worse, quietly works and sends the buyer's visitors' traffic to a stranger's server. Neither
 * is discoverable by looking at the template, because the code looks perfectly reasonable.
 */
const PRIVATE_HOST = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+\.(?:local|internal|test|localhost))(?::\d+)?/gi

/**
 * Things that must never be shipped inside a template.
 *
 * A token pasted into a fetch call is invisible in a rendered preview and is copied to every
 * buyer. Detection is deliberately about SHAPE rather than a list of vendors, because the next
 * secret format is one nobody has added to a list yet.
 */
const SECRET_SHAPED = [
  { pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, what: 'an API key' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g, what: 'a bearer token' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}/g, what: 'a personal access token' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g, what: 'a signed token' },
  {
    pattern: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi,
    what: 'a named credential',
  },
] as const

/**
 * Package a designed site as a Template.
 *
 * Refuses rather than shipping something unusable or unsafe: a template is a product, and the
 * cost of a bad one is paid by somebody who already handed over money.
 */
export function exportSite(input: ExportInput): ExportResult {
  const problems: ExportProblem[] = []
  const warnings: ExportProblem[] = []

  if (input.modules.length === 0) {
    return Object.freeze({
      template: null,
      problems: Object.freeze([Object.freeze({
        code: 'no-modules' as const,
        path: null,
        message: 'A template with no modules installs to nothing.',
      })]),
      warnings: Object.freeze([]),
    })
  }

  for (const module of input.modules) {
    // OUR OWN READER MUST OPEN EVERY MODULE. If it cannot, the buyer installs the template,
    // opens the builder and sees an empty canvas — which reads as the product being broken
    // rather than as this template being unusual. Checked at packaging time because that is
    // the last moment it is the seller's problem instead of the buyer's.
    const read = readModuleSource(module.path, module.source)
    if (read.diagnostics.length > 0) {
      const first = read.diagnostics[0]
      problems.push(Object.freeze({
        code: 'unreadable-module',
        path: module.path,
        message:
          `${module.path} cannot be opened by the builder (${first?.code ?? 'unknown'}`
          + `${first?.line === undefined ? '' : ` at line ${first.line}`}), so a buyer would `
          + 'install it and find an empty canvas.',
      }))
    }

    for (const { pattern, what } of SECRET_SHAPED) {
      // A fresh regex per use: these carry the global flag, and a shared lastIndex would make
      // the second file's scan start partway through and miss a match.
      if (new RegExp(pattern.source, pattern.flags).test(module.source)) {
        problems.push(Object.freeze({
          code: 'private-reference',
          path: module.path,
          message:
            `${module.path} looks like it contains ${what}. A credential inside a template is `
            + 'copied to every buyer and is invisible in a preview.',
        }))
      }
    }

    const hosts = module.source.match(new RegExp(PRIVATE_HOST.source, PRIVATE_HOST.flags))
    if (hosts) {
      problems.push(Object.freeze({
        code: 'private-reference',
        path: module.path,
        message:
          `${module.path} points at ${hosts[0]}, which is the author's own machine or network. `
          + 'On a buyer\'s site that request fails, and the failure looks like the template is '
          + 'broken rather than misaddressed.',
      }))
    }
  }

  // Dependencies come from the baseline rather than from whatever the author happens to have,
  // because the baseline is the set this monorepo actually runs and every version in it is
  // exact. Reading them from the author's environment is how a range reaches a buyer.
  const dependencies: Record<string, string> = {}
  for (const pinned of allBaselinePackages()) {
    if (!isExactVersion(pinned.version)) {
      // Defensive: the baseline's own test forbids this, so reaching here means that gate
      // was removed and a range is about to be sold to somebody.
      problems.push(Object.freeze({
        code: 'invalid-shape',
        path: null,
        message: `Baseline package ${pinned.name} is not pinned to an exact version.`,
      }))
      continue
    }
    dependencies[pinned.name] = pinned.version
  }

  const candidate = {
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version,
    modules: input.modules.map((module) => ({
      path: module.path, kind: module.kind, source: module.source,
    })),
    themeCss: input.themeCss,
    ...(input.seedContent === undefined ? {} : { seedContent: input.seedContent }),
    dependencies,
  }

  if (!Value.Check(SiteTemplateSchema, candidate)) {
    const first = [...Value.Errors(SiteTemplateSchema, candidate)][0]
    problems.push(Object.freeze({
      code: 'invalid-shape',
      path: null,
      message: `The template does not satisfy its own schema: ${first?.message ?? 'unknown'} at ${first?.path ?? '/'}.`,
    }))
    return Object.freeze({ template: null, problems: Object.freeze(problems), warnings: Object.freeze(warnings) })
  }

  const template = candidate as SiteTemplate

  // The listing gates are the vocabulary's, not a second opinion: one definition of a sellable
  // template, consulted here so a seller learns at packaging time rather than at listing time.
  for (const problem of reviewTemplate(template)) {
    problems.push(Object.freeze({
      code: 'invalid-shape',
      path: null,
      message: problem.message,
    }))
  }

  // Seed content is a warning, not a refusal: shipping without it is a legitimate choice for a
  // template meant to be filled in, but it is also the commonest reason a bought theme is
  // refunded, so it should be a decision rather than an oversight.
  if (input.seedContent === undefined) {
    warnings.push(Object.freeze({
      code: 'no-seed-content',
      path: null,
      message:
        'This template ships no seed content, so it installs to blank pages. That demos badly '
        + 'and is the commonest reason a bought theme is refunded.',
    }))
  }

  return Object.freeze({
    template: problems.length === 0 ? template : null,
    problems: Object.freeze(problems),
    warnings: Object.freeze(warnings),
  })
}

export type InstallProblem = Readonly<{
  code: 'would-overwrite' | 'not-listable' | 'unreadable-module'
  path: string | null
  message: string
}>

export type InstallResult = Readonly<{
  /** Files to write, keyed by path. Empty when the install was refused. */
  files: Readonly<Record<string, string>>
  problems: readonly InstallProblem[]
}>

/**
 * Install a template into a workspace.
 *
 * `existingPaths` is required rather than optional so an install cannot be performed without
 * deciding what happens to what is already there. Overwriting a buyer's own work silently is
 * unrecoverable — they have no copy — so a collision is refused and named.
 */
export function installTemplate(
  template: SiteTemplate,
  existingPaths: readonly string[],
): InstallResult {
  const problems: InstallProblem[] = []

  const listingProblems: readonly TemplateProblem[] = reviewTemplate(template)
  if (listingProblems.length > 0) {
    return Object.freeze({
      files: Object.freeze({}),
      problems: Object.freeze(listingProblems.map((problem) => Object.freeze({
        code: 'not-listable' as const,
        path: null,
        message: problem.message,
      }))),
    })
  }

  const existing = new Set(existingPaths)
  for (const module of template.modules) {
    if (existing.has(module.path)) {
      problems.push(Object.freeze({
        code: 'would-overwrite',
        path: module.path,
        message:
          `${module.path} already exists. Installing would replace work the site owner cannot `
          + 'recover, so the install stops rather than choosing for them.',
      }))
    }
  }

  if (problems.length > 0) {
    // Nothing is written on refusal: a half-installed template leaves a site that is neither
    // what it was nor what was bought.
    return Object.freeze({ files: Object.freeze({}), problems: Object.freeze(problems) })
  }

  const files: Record<string, string> = {}
  for (const module of template.modules) files[module.path] = module.source

  return Object.freeze({ files: Object.freeze(files), problems: Object.freeze([]) })
}

/**
 * Whether exporting and re-importing yields the same modules.
 *
 * This is the property that decides whether a template is sellable, so it is available as a
 * function rather than living only in a test: a marketplace can run it on a submission.
 */
export function roundTripsCleanly(template: SiteTemplate): boolean {
  const installed = installTemplate(template, [])
  if (installed.problems.length > 0) return false

  const reExported = exportSite({
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    modules: template.modules.map((module) => ({
      path: module.path, kind: module.kind, source: module.source,
    })),
    themeCss: template.themeCss,
    ...(template.seedContent === undefined ? {} : { seedContent: template.seedContent }),
  })
  if (reExported.template === null) return false

  return JSON.stringify(reExported.template.modules) === JSON.stringify(template.modules)
}
