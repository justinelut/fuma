import { describe, expect, test } from 'bun:test'
import type { PublicProjectionClientConfig, PublicProjectionFetch } from '../lib/public-projections'
import { issueHandoff } from '../lib/private-bridge'
import { safeAppResumeUrl } from '../lib/handoff-target'

const config: PublicProjectionClientConfig = {
  internalOrigin: 'http://studio-internal.service:3001',
  serviceToken: 's'.repeat(32),
  publicHosts: ['3002.blyss.co.ke'],
  timeoutMs: 500,
}

const envelope = {
  data: {
    intent: 'fixture_intent_0123456789abcdef0123456789',
    correlation: 'fixture_correlation_0123456789abcdef',
    expiresAt: '2999-07-26T00:00:00Z',
  },
  meta: {
    schemaVersion: 1,
    datasetVersion: 'handoff:fixture-1',
    etag: '"handoff-fixture-1"',
  },
} as const

describe('public-to-app handoff layer', () => {
  test('forwards a closed intent privately and constructs only the fixed app resume target', async () => {
    const fetchImpl: PublicProjectionFetch = async (input, init) => {
      expect(String(input)).toBe('http://studio-internal.service:3001/_fuma/private/public/v1/handoff')
      expect(init?.method).toBe('POST')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${config.serviceToken}`)
      expect(headers.get('x-fuma-audience')).toBe('fuma-public-web')
      expect(headers.get('cookie')).toBeNull()
      expect(JSON.parse(String(init?.body))).toEqual({
        kind: 'choose_plan',
        source: 'pricing',
        planId: 'plan_launch',
        priceBookVersion: 'ke-2026-07-v1',
        cadence: 'monthly',
      })
      return Response.json(envelope)
    }

    const result = await issueHandoff(
      {
        kind: 'choose_plan',
        source: 'pricing',
        planId: 'plan_launch',
        priceBookVersion: 'ke-2026-07-v1',
        cadence: 'monthly',
      },
      { config, fetchImpl },
    )
    expect(result).toEqual({
      redirectUrl: 'https://app.fuma.co.ke/resume?intent=fixture_intent_0123456789abcdef0123456789&correlation=fixture_correlation_0123456789abcdef',
    })
    expect(safeAppResumeUrl(result?.redirectUrl)?.origin).toBe('https://app.fuma.co.ke')
  })

  test('fails closed for expired, malformed, redirected, credentialed or extra-parameter targets', async () => {
    const expiredFetch: PublicProjectionFetch = async () => Response.json({
      ...envelope,
      data: { ...envelope.data, expiresAt: '2020-07-26T00:00:00Z' },
    })
    expect(await issueHandoff(
      { kind: 'sign_in', source: 'direct' },
      { config, fetchImpl: expiredFetch },
    )).toBeNull()

    for (const target of [
      'https://attacker.test/resume?intent=fixture_intent_0123456789abcdef0123456789&correlation=fixture_correlation_0123456789abcdef',
      'https://user:pass@app.fuma.co.ke/resume?intent=fixture_intent_0123456789abcdef0123456789&correlation=fixture_correlation_0123456789abcdef',
      'https://app.fuma.co.ke/resume?intent=fixture_intent_0123456789abcdef0123456789&correlation=fixture_correlation_0123456789abcdef&redirect=https://attacker.test',
      'https://app.fuma.co.ke/other?intent=fixture_intent_0123456789abcdef0123456789&correlation=fixture_correlation_0123456789abcdef',
    ]) expect(safeAppResumeUrl(target)).toBeNull()
  })
})
