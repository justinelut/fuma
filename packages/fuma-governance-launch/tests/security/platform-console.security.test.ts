import { describe, expect, it } from 'bun:test'
import { PlatformConsoleRegistry, PlatformConsoleService, type InternalAuthority, type PlatformConsoleReadSource } from '../../src'

const source: PlatformConsoleReadSource = {
  async read() { return [{ organizationId: 'org-a', name: 'Visible', password: 'needle-password', cookie: 'needle-cookie', ciphertext: 'needle-ciphertext', rawWebhook: 'needle-webhook' }] },
}
const allowed: InternalAuthority = { actorId: 'staff-a', host: 'admin.fuma.co.ke', authorities: new Set(['internal.console.read']), stepUpAt: null, protectedOwner: false }
const console = new PlatformConsoleService({ source, registry: new PlatformConsoleRegistry(), now: () => new Date('2026-07-29T12:00:00.000Z') })

describe('FUMA-071 adversarial console boundary', () => {
  it('rejects host substitution, absent capability, caller authority fields, and malformed queries', async () => {
    for (const authority of [
      { ...allowed, host: 'app.fuma.co.ke' },
      { ...allowed, host: 'admin.fuma.co.ke.attacker.invalid' },
      { ...allowed, authorities: new Set<string>() },
    ]) await expect(console.query({ view: 'organizations', limit: 10 }, authority)).rejects.toThrow()
    for (const query of [
      { view: 'organizations', limit: 10, actorId: 'owner' },
      { view: 'organizations', limit: 0 },
      { view: 'organizations', limit: 101 },
      { view: 'unknown', limit: 10 },
      { view: 'organizations', filter: 'line\nbreak', limit: 10 },
      { view: 'organizations', cursor: 'eyJvZmZzZXQiOi0xfQ', limit: 10 },
    ]) await expect(console.query(query, allowed)).rejects.toThrow()
  })

  it('cannot discover or serialize secret-shaped source values through filtering', async () => {
    for (const filter of ['needle-password', 'needle-cookie', 'needle-ciphertext', 'needle-webhook']) {
      expect((await console.query({ view: 'organizations', filter, limit: 10 }, allowed)).rows).toEqual([])
    }
    const text = JSON.stringify(await console.query({ view: 'organizations', limit: 10 }, allowed))
    expect(text).toContain('Visible')
    expect(text).not.toMatch(/password|cookie|ciphertext|webhook|needle-/i)
  })

  it('does not infer action authority from contribution ownership or protected-owner status', async () => {
    const registry = new PlatformConsoleRegistry()
    registry.register({ contributionId: 'artifact-review', ownerTicket: 'FUMA-068', routes: ['/internal/artifacts/reviews'], requiredAuthorities: ['internal.plugins.review'] })
    registry.registerAction({ actionId: 'artifact-review.decide', requiredAuthority: 'internal.plugins.review', requiresFreshStepUp: true, async execute(_input, context) { return { actionId: 'artifact-review.decide', requestId: context.requestId, state: 'completed', resourceId: 'decision-a', resourceVersion: null } } })
    const service = new PlatformConsoleService({ source, registry, now: () => new Date('2026-07-29T12:00:00.000Z') })
    const envelope = { actionId: 'artifact-review.decide', requestId: 'request-a', input: {} }
    await expect(service.execute(envelope, { ...allowed, protectedOwner: true, authorities: new Set(['internal.plugins.review']), stepUpAt: '2026-07-29T11:59:00.000Z' })).rejects.toThrow('authority')
    await expect(service.execute(envelope, { ...allowed, authorities: new Set(['internal.console.write', 'internal.plugins.review']), stepUpAt: null })).rejects.toThrow('authority')
  })
})
