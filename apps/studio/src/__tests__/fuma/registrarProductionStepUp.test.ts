import { describe, expect, it } from 'bun:test'
import { BetterAuthRegistrarStepUp } from '../../../server/fuma/registrar/productionStepUp'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'

function request(): FumaScopedRouteHandlerInput {
  return {
    request: new Request('https://app.trimly.co.ke/api/fuma/registrar', { headers: { cookie: 'opaque' } }),
    context: { actor: { kind: 'staff', userId: 'user-a', sessionId: 'session-a', impersonator: null } },
  } as unknown as FumaScopedRouteHandlerInput
}

describe('registrar Better Auth step-up authority', () => {
  it('issues one short-lived purpose-bound proof from a fresh direct session', async () => {
    let now = new Date('2026-08-04T12:00:00.000Z')
    const authority = new BetterAuthRegistrarStepUp({
      secret: new Uint8Array(32).fill(7),
      now: () => now,
      resolveSession: async () => ({
        userId: 'user-a', sessionId: 'session-a', createdAt: new Date('2026-08-04T11:59:00.000Z'),
        impersonatedBy: null,
      }) as never,
    })
    const purpose = `registrar-purchase:quote-a:${'a'.repeat(64)}`
    const proof = await authority.issue(request(), purpose)
    expect(await authority.consume(proof, purpose)).toBe(true)
    expect(await authority.consume(proof, `${purpose}-changed`)).toBe(false)
    expect(await authority.consume(`${proof.slice(0, -1)}x`, purpose)).toBe(false)
    now = new Date('2026-08-04T12:06:00.000Z')
    expect(await authority.consume(proof, purpose)).toBe(false)
    authority.close()
  })

  it('rejects stale or impersonated Better Auth sessions before proof issuance', async () => {
    const authority = new BetterAuthRegistrarStepUp({
      secret: new Uint8Array(32).fill(8),
      now: () => new Date('2026-08-04T12:10:00.000Z'),
      resolveSession: async () => ({
        userId: 'user-a', sessionId: 'session-a', createdAt: new Date('2026-08-04T12:00:00.000Z'),
        impersonatedBy: null,
      }) as never,
    })
    await expect(authority.issue(request(), 'registrar-purchase:quote-a:terms'))
      .rejects.toThrow('Fresh direct Better Auth')
  })
})
