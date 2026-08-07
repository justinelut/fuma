/**
 * The registration seam that makes the tenant scaffold run when a site is provisioned.
 *
 * WHY A BRIDGE RATHER THAN A DIRECT CALL. `hostedSiteProvisioning` runs for the hosted product only,
 * and the scaffold needs an `EditorScopedStorage` that a self-hosted install has no reason to
 * construct. The codebase already solved this shape four times - `setHostedBuilderIdentityResolver`,
 * `setHostedSiteDocumentResolver`, `setHostedStorageAllowanceResolver`, `setActivePageAllowance` - so
 * this follows the same rule: MODULE-LEVEL, NULL BY DEFAULT, AND WITH NOTHING REGISTERED THE BEHAVIOUR
 * IS BYTE-FOR-BYTE WHAT IT WAS.
 *
 * THE FAILURE MODE THIS DELIBERATELY CHOOSES. Scaffolding is not the point of provisioning - a site
 * that exists with no starter is recoverable (re-run it, and `persistScaffold` skips what is already
 * there), whereas a site that FAILED TO PROVISION because a template file could not be written is a
 * customer who cannot start at all. So a scaffold failure is reported and swallowed rather than
 * propagated. That is the opposite of the entitlement resolvers, which refuse on failure, and the
 * reason is the direction of the harm: refusing an allowance under-serves, refusing a site blocks.
 */
import type { ScaffoldProblem } from './tenantScaffold'

export type ScaffoldTarget = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  generation: number
  siteName: string
}>

export type ScaffoldRun = Readonly<{
  written: readonly string[]
  skipped: readonly string[]
  problems: readonly ScaffoldProblem[]
}>

/** Performs the scaffold for one freshly provisioned site. */
export type SiteScaffolder = (target: ScaffoldTarget) => Promise<ScaffoldRun>

let scaffolder: SiteScaffolder | null = null

/**
 * Registers the scaffolder. Called once at hosted startup beside the other hosted bridges.
 *
 * Passing null clears it, which is what the tests use to restore self-host behaviour - leftover module
 * state would otherwise give a later test hosted behaviour it never asked for.
 */
export function setSiteScaffolder(next: SiteScaffolder | null): void {
  scaffolder = next
}

export function siteScaffolderRegistered(): boolean {
  return scaffolder !== null
}

/**
 * Runs the scaffold if one is registered.
 *
 * Returns null when nothing is registered, so a caller can tell "no scaffolder" from "scaffolded
 * nothing" - collapsing them would make a self-hosted install look like a hosted one whose starter
 * happened to be empty.
 */
export async function scaffoldProvisionedSite(target: ScaffoldTarget): Promise<ScaffoldRun | null> {
  const current = scaffolder
  if (current === null) return null
  try {
    return await current(target)
  } catch (error) {
    // Reported as a problem rather than thrown: the site is already provisioned and usable, and
    // failing the request now would tell the customer their site was not created when it was.
    return {
      written: [],
      skipped: [],
      problems: [{
        code: 'scaffold-failed',
        path: '',
        message: `The site was created but its starting files were not written: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Re-running onboarding writes what is missing without replacing anything.`,
      }],
    }
  }
}
