import { describe, expect, test } from 'bun:test'
import {
  ConfiguredPublicStatusProjectionAuthority,
  readPublicStatusAuthorityConfig,
  validCurrentStatusProjection,
} from './status'

const current = Date.parse('2026-07-31T06:00:00Z')
const operational = Object.freeze({
  schemaVersion: 1 as const,
  scope: 'public-web' as const,
  status: 'operational' as const,
  message: 'All public services are operating normally.',
  checkedAt: '2026-07-31T06:00:00Z',
  incident: null,
  onCall: { coverage: 'confirmed' as const, checkedAt: '2026-07-31T06:00:00Z' },
})

describe('configured public status projection authority', () => {
  test('is absent by default and rejects partial or unsafe authority configuration', () => {
    expect(readPublicStatusAuthorityConfig({})).toBeNull()
    expect(() => readPublicStatusAuthorityConfig({ FUMA_PUBLIC_STATUS_AUTHORITY_URL: 'https://status.internal/current' })).toThrow('incomplete')
    expect(() => readPublicStatusAuthorityConfig({
      FUMA_PUBLIC_STATUS_AUTHORITY_URL: 'http://status.internal/current',
      FUMA_PUBLIC_STATUS_AUTHORITY_TOKEN: 's'.repeat(32),
    })).toThrow('HTTPS')
  })

  test('uses authenticated no-store fetch and returns only a fresh coherent projection', async () => {
    let sent: Request | null = null
    let sentInit: RequestInit | undefined
    const config = readPublicStatusAuthorityConfig({
      FUMA_PUBLIC_STATUS_AUTHORITY_URL: 'https://status.internal/current',
      FUMA_PUBLIC_STATUS_AUTHORITY_TOKEN: 'status-authority-token-000000001',
      FUMA_PUBLIC_STATUS_AUTHORITY_TIMEOUT_MS: '500',
    })!
    const authority = new ConfiguredPublicStatusProjectionAuthority(config, (async (input, init) => {
      sentInit = init
      sent = new Request(input, init)
      return Response.json(operational)
    }) as typeof fetch, () => current)
    expect(await authority.readCurrent()).toEqual(operational)
    expect(sent?.headers.get('authorization')).toBe('Bearer status-authority-token-000000001')
    expect(sent?.headers.get('cookie')).toBeNull()
    expect(sentInit?.cache).toBe('no-store')
  })

  test('rejects stale, future, or incident-incoherent status facts', () => {
    expect(validCurrentStatusProjection(operational, current)).toBe(true)
    expect(validCurrentStatusProjection({ ...operational, checkedAt: '2026-07-31T05:54:59Z' }, current)).toBe(false)
    expect(validCurrentStatusProjection({ ...operational, checkedAt: '2026-07-31T06:01:01Z' }, current)).toBe(false)
    expect(validCurrentStatusProjection({ ...operational, status: 'outage' }, current)).toBe(false)
  })
})
