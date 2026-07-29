import { describe, expect, test } from 'bun:test'
import { PublicAcquisitionEventSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import {
  consentStateFromSession,
  handoffStartedEvent,
  routeClassForPath,
} from '../lib/acquisition-client'

describe('privacy-minimized acquisition client', () => {
  test('classifies paths into the closed route vocabulary without retaining paths', () => {
    expect(routeClassForPath('/')).toBe('home')
    expect(routeClassForPath('/website')).toBe('product')
    expect(routeClassForPath('/pricing/private-query')).toBe('pricing')
    expect(routeClassForPath('/docs/getting-started')).toBe('resource')
    expect(routeClassForPath('/privacy-request')).toBe('legal')
    expect(routeClassForPath('/unknown')).toBe('company')
  })

  test('never upgrades malformed or obsolete storage into consent', () => {
    expect(consentStateFromSession(null)).toBe('not_required')
    expect(consentStateFromSession('{invalid')).toBe('not_required')
    expect(consentStateFromSession(JSON.stringify({ version: 2, choice: 'optional' }))).toBe('not_required')
    expect(consentStateFromSession(JSON.stringify({ version: 1, choice: 'essential' }))).toBe('denied')
    expect(consentStateFromSession(JSON.stringify({ version: 1, choice: 'optional' }))).toBe('granted')
  })

  test('builds a strict handoff event with only opaque correlation and approved target IDs', () => {
    const event = handoffStartedEvent(
      {
        kind: 'choose_plan', source: 'pricing', planId: 'plan_launch',
        priceBookVersion: 'ke-2026-07-v1', cadence: 'monthly',
      },
      'opaque_correlation_0001',
      '2026-07-26T09:00:00Z',
      'granted',
    )
    expect(Value.Check(PublicAcquisitionEventSchema, event)).toBe(true)
    expect(event).toEqual({
      version: 1,
      kind: 'handoff_started',
      routeClass: 'pricing',
      timestamp: '2026-07-26T09:00:00Z',
      consent: 'granted',
      handoffCorrelation: 'opaque_correlation_0001',
      planId: 'plan_launch',
    })
    expect(JSON.stringify(event)).not.toMatch(/email|path|referrer|tenant|member|payment|staff/i)
  })
})
