import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('protected owner production composition', () => {
  test('reconciles only the exact protected staff session through the canonical bootstrap service', () => {
    const server = read('server/index.ts')
    const runtime = read('server/auth/hosted/runtime.ts')
    expect(server).toContain('new OrganizationBootstrapService')
    expect(server).toContain('new PostgresOrganizationBootstrapRepository(db)')
    expect(server).toContain('protectedOwnerBootstrap.bootstrap({ protectedOwnerEmail: fumaConfig.protectedOwner.email })')
    expect(runtime).toContain('session.email.trim().toLowerCase() === input.protectedOwnerEmail.trim().toLowerCase()')
    expect(runtime).toContain('await input.reconcileProtectedOwner(session.email)')
    const identityStart = runtime.indexOf('export function createHostedIdentityAuthRuntime')
    const staffStart = runtime.indexOf('export function createHostedStaffAuthRuntime')
    expect(runtime.slice(identityStart, staffStart)).not.toContain('reconcileProtectedOwner')
  })

  test('keeps owner promotion and platform membership inside the existing locked transaction', () => {
    const bootstrap = read('server/fuma/organizations/bootstrap.ts')
    expect(bootstrap).toContain('await tx.acquireBootstrapLock(BOOTSTRAP_LOCK_KEY)')
    expect(bootstrap).toContain('await tx.enforceProtectedAdmin(owner.id, now)')
    expect(bootstrap).toContain("role: 'owner'")
    expect(bootstrap).toContain('PLATFORM_ORGANIZATION_ID')
    expect(bootstrap).toContain('PLATFORM_OWNER_MEMBERSHIP_ID')
  })
})
