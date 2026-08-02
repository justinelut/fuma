import { describe, expect, it } from 'bun:test'
import { FumaFakeClock } from '../helpers/fuma/fakeClock'
import {
  createFumaTwoTenantMatrix,
  formatStableFumaFixtureIds,
  stableFumaFixtureIds,
} from '../helpers/fuma/fixtures'

describe('FUMA-002 pure fixture factories', () => {
  it('derive identical complete matrices from the same explicit seed', () => {
    const first = createFumaTwoTenantMatrix('fuma-002-demo')
    const second = createFumaTwoTenantMatrix('fuma-002-demo')

    expect(first).toEqual(second)
    expect(first.organizations).toHaveLength(2)
    expect(first.workspaces).toHaveLength(2)
    expect(first.sites).toHaveLength(4)
    expect(first.resources).toHaveLength(4)
  })

  it('provides both profiles and grant/revoke overrides in each organization', () => {
    const matrix = createFumaTwoTenantMatrix('profile-matrix')

    for (const organization of matrix.organizations) {
      const sites = matrix.sites.filter(({ organizationId }) => organizationId === organization.id)
      expect(sites.map(({ profileId }) => profileId).sort()).toEqual(['publication', 'website'])
      for (const site of sites) {
        expect(site.capabilityOverrides.grant.length).toBeGreaterThan(0)
        expect(site.capabilityOverrides.revoke.length).toBeGreaterThan(0)
      }
    }
  })

  it('deliberately collides lower-scope IDs while full tenant scopes stay unique', () => {
    const matrix = createFumaTwoTenantMatrix('collision-matrix')
    const workspaceIds = new Set(matrix.workspaces.map(({ id }) => id))
    const siteIds = new Set(matrix.sites.map(({ id }) => id))
    const resourceIds = new Set(matrix.resources.map(({ id }) => id))
    const fullResourceScopes = new Set(matrix.resources.map(
      ({ organizationId, workspaceId, siteId, id }) => `${organizationId}/${workspaceId}/${siteId}/${id}`,
    ))

    expect(workspaceIds.size).toBe(1)
    expect(siteIds.size).toBe(2)
    expect(resourceIds.size).toBe(1)
    expect(fullResourceScopes.size).toBe(4)
  })

  it('demo prints only stable fixture IDs', () => {
    const matrix = createFumaTwoTenantMatrix('fuma-002-demo')
    const output = formatStableFumaFixtureIds(matrix)

    expect(output).toBe(JSON.stringify(stableFumaFixtureIds(matrix)))
    expect(output).not.toContain('fixture.invalid')
    expect(output).not.toMatch(/postgres|sqlite|https?:|schema|password|secret|token/i)
    process.stdout.write(`${output}\n`)
  })
})

describe('FUMA-002 fake clock', () => {
  it('sets, advances, and resets deterministically without touching global Date', () => {
    const nativeNow = Date.now
    const clock = new FumaFakeClock('2042-03-04T05:06:07.000Z')

    expect(clock.now().toISOString()).toBe('2042-03-04T05:06:07.000Z')
    expect(clock.advance(250).toISOString()).toBe('2042-03-04T05:06:07.250Z')
    expect(clock.set('2042-03-04T05:06:08.000Z').toISOString()).toBe('2042-03-04T05:06:08.000Z')
    expect(clock.reset().toISOString()).toBe('2042-03-04T05:06:07.000Z')
    expect(Date.now).toBe(nativeNow)
  })

  it('rejects backward, negative, and unrepresentable movement atomically', () => {
    const clock = new FumaFakeClock(1_000)

    expect(() => clock.set(999)).toThrow('cannot move backward')
    expect(() => clock.advance(-1)).toThrow('non-negative')
    expect(() => clock.advance(1e308)).toThrow('valid Date range')
    expect(() => clock.set(1e308)).toThrow('valid Date range')
    expect(clock.nowMs()).toBe(1_000)
    expect(Number.isFinite(clock.nowMs())).toBe(true)
    expect(Number.isFinite(clock.now().getTime())).toBe(true)
  })

  it('rejects an unrepresentable constructor instant', () => {
    expect(() => new FumaFakeClock(1e308)).toThrow('valid Date range')
  })
})
