import { describe, expect, it } from 'bun:test'
import type { FumaScopedJobHandlerContext } from '../../../server/fuma/jobs/integration'
import {
  AI_CREDIT_EXPIRY_JOB_KIND,
  aiCreditExpiryJobRegistration,
} from '../../../server/fuma/aiCredits'
import { createAiCreditFixture, grantCommand, reserveCommand } from './aiCreditsTestFixture'

const PROTECTED_ORGANIZATION_ID = 'organization-platform'

function jobContext(
  durable: Map<string, unknown>,
): FumaScopedJobHandlerContext {
  return {
    job: {
      id: 'job-ai-credit-expiry',
      organizationId: PROTECTED_ORGANIZATION_ID,
      siteId: null,
      kind: AI_CREDIT_EXPIRY_JOB_KIND,
      payload: { limit: 100 },
    },
    jobContext: {
      kind: 'organization',
      scope: { organization: { id: PROTECTED_ORGANIZATION_ID } },
    },
    repositoryScope: null,
    siteRepository: null,
    readDurableResult: async (key: string) => durable.has(key)
      ? { result: durable.get(key) }
      : null,
    commitDurableResult: async (key: string, result: unknown) => {
      durable.set(key, result)
      return { result }
    },
  } as unknown as FumaScopedJobHandlerContext
}

describe('FUMA-064 protected AI credit expiry job', () => {
  it('expires due reservations once and replays strict durable evidence', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand({ expiresAt: null }))
    await fixture.service.reserve(await reserveCommand(fixture, {
      expiresAt: '2026-07-28T12:05:00.000Z',
    }))
    fixture.clock.now = new Date('2026-07-28T12:10:00.000Z')
    const handler = aiCreditExpiryJobRegistration({
      service: fixture.service,
      protectedOrganizationId: PROTECTED_ORGANIZATION_ID,
      now: () => fixture.clock.now,
    })[AI_CREDIT_EXPIRY_JOB_KIND]
    const durable = new Map<string, unknown>()
    const context = jobContext(durable)
    const first = await handler(context)
    const replay = await handler(context)
    expect(first).toEqual({ expiredReservations: 1, runAt: '2026-07-28T12:10:00.000Z' })
    expect(replay).toEqual(first)
    expect(await fixture.repository.reservation('reservation-a')).toMatchObject({ state: 'expired' })
  })

  it('rejects organization/site substitution, malformed payload, and malformed durable results', async () => {
    const fixture = createAiCreditFixture()
    const handler = aiCreditExpiryJobRegistration({
      service: fixture.service,
      protectedOrganizationId: PROTECTED_ORGANIZATION_ID,
      now: () => fixture.clock.now,
    })[AI_CREDIT_EXPIRY_JOB_KIND]
    const durable = new Map<string, unknown>()
    const context = jobContext(durable)
    await expect(handler({
      ...context,
      job: { ...context.job, organizationId: 'organization-attacker' },
    } as FumaScopedJobHandlerContext)).rejects.toThrow('protected organization job authority')
    await expect(handler({
      ...context,
      job: { ...context.job, payload: { limit: 0 } },
    } as FumaScopedJobHandlerContext)).rejects.toThrow('payload is invalid')
    durable.set('fuma.ai-credit-expiry:v1:2026-07-28T12:00:00.000Z:100', { injected: true })
    await expect(handler(context)).rejects.toThrow('durable result is invalid')
  })
})
