/**
 * Tests the registration seam that makes the tenant scaffold actually run.
 *
 * The property under test is the one tasks 20, 52 and 68 each got wrong: a correct fix that nothing
 * calls. So these assertions are about REACHABILITY and about the failure direction, not about the
 * emitted source, which tenantScaffold.test.ts covers.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  scaffoldProvisionedSite,
  setSiteScaffolder,
  siteScaffolderRegistered,
  type ScaffoldTarget,
} from '../../../server/fuma/editor/siteScaffoldBridge'

const STUDIO = join(import.meta.dir, '..', '..', '..')

const target: ScaffoldTarget = Object.freeze({
  platformId: 'fuma',
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  ownerKey: 'owner-1',
  generation: 1,
  siteName: 'Demo Site',
})

// Leftover module state would give a later test hosted behaviour it never asked for - the same reason
// the site-document bridge's tests reset.
afterEach(() => { setSiteScaffolder(null) })

describe('the scaffold bridge follows the hosted-resolver precedent', () => {
  it('is null by default, so a self-hosted install writes nothing new', async () => {
    expect(siteScaffolderRegistered()).toBe(false)
    // NULL is distinguishable from "scaffolded nothing": collapsing them would make a self-hosted
    // install look like a hosted one whose starter happened to be empty.
    expect(await scaffoldProvisionedSite(target)).toBeNull()
  })

  it('runs the registered scaffolder with the full tenant scope', async () => {
    let seen: ScaffoldTarget | null = null
    setSiteScaffolder(async (received) => {
      seen = received
      return { written: ['app/page.tsx'], skipped: [], problems: [] }
    })
    const run = await scaffoldProvisionedSite(target)
    expect(run?.written).toEqual(['app/page.tsx'])
    // The owner key AND its generation are what the module store is keyed by; without either, a
    // scaffolded module would land outside the scope the builder later reads.
    expect(seen).not.toBeNull()
    expect(seen!.ownerKey).toBe('owner-1')
    expect(seen!.generation).toBe(1)
    expect(seen!.siteId).toBe('site-1')
  })

  it('REPORTS a scaffold failure instead of throwing, so provisioning still succeeds', async () => {
    setSiteScaffolder(async () => { throw new Error('storage unavailable') })
    const run = await scaffoldProvisionedSite(target)
    // The site exists by the time this runs. Throwing would tell the customer their site was not
    // created when it was - a worse outcome than a site whose starter is missing and re-writable.
    expect(run).not.toBeNull()
    expect(run!.problems.length).toBe(1)
    expect(run!.problems[0]!.code).toBe('scaffold-failed')
    expect(run!.problems[0]!.message).toContain('storage unavailable')
    expect(run!.problems[0]!.message).toContain('Re-running')
  })

  it('clearing the registration restores the self-host answer exactly', async () => {
    setSiteScaffolder(async () => ({ written: [], skipped: [], problems: [] }))
    expect(siteScaffolderRegistered()).toBe(true)
    setSiteScaffolder(null)
    expect(await scaffoldProvisionedSite(target)).toBeNull()
  })
})

describe('the bridge is genuinely reached, not merely built', () => {
  it('site provisioning calls it after the owner key resolves', () => {
    const provisioning = readFileSync(
      join(STUDIO, 'server/fuma/onboarding/hostedSiteProvisioning.ts'), 'utf8')
    expect(provisioning).toContain('scaffoldProvisionedSite')
    // ORDER MATTERS AND IS ASSERTED RATHER THAN TRUSTED: before the owner key exists there is no
    // scope for a module to be stored under, so a call placed earlier would write nowhere.
    const ownerKeyResolved = provisioning.indexOf('duplicate tenant owner-key authority')
    const scaffoldCall = provisioning.indexOf('scaffoldProvisionedSite({')
    expect(ownerKeyResolved).toBeGreaterThan(-1)
    expect(scaffoldCall).toBeGreaterThan(ownerKeyResolved)
  })

  it('the server registers it, so the fix is not inert', () => {
    const index = readFileSync(join(STUDIO, 'server/index.ts'), 'utf8')
    expect(index).toContain('setSiteScaffolder(')
    expect(index).toContain('createScopedModuleStore(')
    // Gated on hosted config, so a self-hosted server never registers one.
    const guard = index.indexOf('if (hostedFumaConfig) {\n  setSiteScaffolder(')
    expect(guard).toBeGreaterThan(-1)
  })

  it('constructs the module store rather than a second persistence path', () => {
    const index = readFileSync(join(STUDIO, 'server/index.ts'), 'utf8')
    // The module store is the only thing keyed by the tenant scope task 20 established. A parallel
    // writer would be a second answer to "where does this site's source live".
    expect(index).toContain('PostgresEditorScopedStorage')
    expect(index).toContain('persistScaffold(')
  })
})
