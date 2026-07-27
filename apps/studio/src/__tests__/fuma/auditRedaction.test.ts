import { describe, expect, it } from 'bun:test'
import {
  AUDIT_METADATA_MAX_ARRAY_ITEMS,
  AUDIT_METADATA_MAX_DEPTH,
  AUDIT_METADATA_MAX_STRING_LENGTH,
} from '../../../server/fuma/audit/contracts'
import {
  AUDIT_REDACTED_VALUE,
  isSensitiveAuditMetadataKey,
  redactAuditMetadata,
} from '../../../server/fuma/audit/redaction'

const SENSITIVE_KEYS = [
  'secret',
  'clientSecret',
  'password',
  'user_password',
  'passwd',
  'access-token',
  'refreshToken',
  'API Key',
  'api_key_value',
  'cookie',
  'set.cookie',
  'Authorization',
  'sessionId',
  'user-session',
  'otp_code',
  'mfaRecoveryCode',
  'private-key',
  'private_key_pem',
  'request_body',
  'jobPayload',
] as const

function contextDeniedMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    denialCode: 'permission-denied',
    ...extra,
  }
}

describe('FUMA-022 audit metadata redaction', () => {
  it('recognizes normalized sensitive spellings', () => {
    for (const key of SENSITIVE_KEYS) {
      expect(isSensitiveAuditMetadataKey(key), key).toBe(true)
    }
    for (const key of [
      'authMethod',
      'failureCode',
      'permissionId',
      'profileId',
      'changedFields',
      'destinationOrganizationId',
    ]) {
      expect(isSensitiveAuditMetadataKey(key), key).toBe(false)
    }
  })

  it('redacts every sensitive key at root, nested-object, and nested-array levels', () => {
    const rootSecrets = Object.fromEntries(SENSITIVE_KEYS.map((key) => [key, `root:${key}`]))
    const nestedSecrets = Object.fromEntries(SENSITIVE_KEYS.map((key) => [key, `nested:${key}`]))
    const arraySecrets = Object.fromEntries(SENSITIVE_KEYS.map((key) => [key, `array:${key}`]))
    const metadata = contextDeniedMetadata({
      ...rootSecrets,
      nested: {
        safeLabel: 'kept',
        ...nestedSecrets,
      },
      entries: [{
        safeIndex: 1,
        ...arraySecrets,
      }],
      accessTokens: ['one', 'two'],
    })

    const result = redactAuditMetadata('context.request.denied', metadata)
    for (const key of SENSITIVE_KEYS) {
      expect(result[key]).toBe(AUDIT_REDACTED_VALUE)
      expect((result.nested as Record<string, unknown>)[key]).toBe(AUDIT_REDACTED_VALUE)
      const entries = result.entries as readonly Record<string, unknown>[]
      expect(entries[0][key]).toBe(AUDIT_REDACTED_VALUE)
    }
    expect(result.accessTokens).toBe(AUDIT_REDACTED_VALUE)
    expect((result.nested as Record<string, unknown>).safeLabel).toBe('kept')
    expect((result.entries as readonly Record<string, unknown>[])[0].safeIndex).toBe(1)
  })

  it('retains useful safe metadata, sorts object keys deterministically, and never mutates input', () => {
    const metadata = {
      changedFields: ['name', 'slug'],
      zeta: true,
      details: {
        route: '/news',
        attempts: 2,
        nullable: null,
        labels: ['editorial', 'launch'],
        password: 'must-not-survive',
      },
      alpha: 'kept',
    }
    const before = structuredClone(metadata)

    const first = redactAuditMetadata('organization.updated', metadata)
    const second = redactAuditMetadata('organization.updated', metadata)

    expect(first).toEqual(second)
    expect(Object.keys(first)).toEqual(['alpha', 'changedFields', 'details', 'zeta'])
    expect(first).toEqual({
      alpha: 'kept',
      changedFields: ['name', 'slug'],
      details: {
        attempts: 2,
        labels: ['editorial', 'launch'],
        nullable: null,
        password: AUDIT_REDACTED_VALUE,
        route: '/news',
      },
      zeta: true,
    })
    expect(metadata).toEqual(before)
    expect(first).not.toBe(metadata)
    expect(first.details).not.toBe(metadata.details)
    expect(first.changedFields).not.toBe(metadata.changedFields)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.details)).toBe(true)
    expect(Object.isFrozen(first.changedFields)).toBe(true)
  })

  it('validates sensitive values before discarding them', () => {
    const circularSecret: Record<string, unknown> = {}
    circularSecret.self = circularSecret

    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({ apiToken: circularSecret }),
    )).toThrow(expect.objectContaining({ code: 'circular-reference' }))
  })

  it('fails closed for unknown actions and missing catalog-required metadata', () => {
    expect(() => redactAuditMetadata('context.request.unknown', {
      denialCode: 'denied',
    })).toThrow(expect.objectContaining({
      name: 'AuditCatalogError',
      code: 'unknown-action',
    }))

    expect(() => redactAuditMetadata('job.failed', {
      jobKind: 'publish',
      attempt: 3,
    })).toThrow(expect.objectContaining({
      name: 'AuditMetadataError',
      code: 'missing-required-metadata',
      path: 'metadata.failureCode',
    }))
  })
})

describe('FUMA-022 bounded JSON-safe metadata', () => {
  it('rejects circular graphs', () => {
    const circular = contextDeniedMetadata()
    circular.self = circular
    expect(() => redactAuditMetadata('context.request.denied', circular)).toThrow(
      expect.objectContaining({
        name: 'AuditMetadataError',
        code: 'circular-reference',
      }),
    )
  })

  it('rejects excessive depth, array length, string length, and serialized size', () => {
    let deep: Record<string, unknown> = { value: 'bottom' }
    for (let depth = 0; depth <= AUDIT_METADATA_MAX_DEPTH; depth += 1) {
      deep = { child: deep }
    }
    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({ deep }),
    )).toThrow(expect.objectContaining({ code: 'maximum-depth' }))

    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({
        values: Array.from({ length: AUDIT_METADATA_MAX_ARRAY_ITEMS + 1 }, () => 1),
      }),
    )).toThrow(expect.objectContaining({ code: 'invalid-metadata' }))

    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({ value: 'x'.repeat(AUDIT_METADATA_MAX_STRING_LENGTH + 1) }),
    )).toThrow(expect.objectContaining({ code: 'invalid-metadata' }))

    const oversized: Record<string, unknown> = { denialCode: 'denied' }
    for (let index = 0; index < 9; index += 1) {
      oversized[`chunk${index}`] = 'x'.repeat(AUDIT_METADATA_MAX_STRING_LENGTH)
    }
    expect(() => redactAuditMetadata('context.request.denied', oversized)).toThrow(
      expect.objectContaining({ code: 'maximum-size' }),
    )
  })

  it('rejects every non-JSON primitive and non-plain object class', () => {
    const invalidValues: readonly unknown[] = [
      undefined,
      1n,
      Symbol('not-json'),
      () => 'not-json',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date('2026-07-25T00:00:00Z'),
      new Map([['key', 'value']]),
      new Set(['value']),
      /pattern/,
    ]

    for (const value of invalidValues) {
      expect(() => redactAuditMetadata(
        'context.request.denied',
        contextDeniedMetadata({ invalid: value }),
      ), String(value)).toThrow(expect.objectContaining({ code: 'invalid-metadata' }))
    }
  })

  it('rejects sparse/custom arrays, symbol keys, and accessor properties', () => {
    const sparse = new Array(2)
    sparse[1] = 'value'
    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({ sparse }),
    )).toThrow(expect.objectContaining({ code: 'invalid-metadata' }))

    const custom = ['value']
    Object.defineProperty(custom, 'hidden', { value: 'not-json' })
    expect(() => redactAuditMetadata(
      'context.request.denied',
      contextDeniedMetadata({ custom }),
    )).toThrow(expect.objectContaining({ code: 'invalid-metadata' }))

    const symbolKey = contextDeniedMetadata()
    Object.defineProperty(symbolKey, Symbol('hidden'), { value: 'not-json' })
    expect(() => redactAuditMetadata('context.request.denied', symbolKey)).toThrow(
      expect.objectContaining({ code: 'invalid-metadata' }),
    )

    const accessor = contextDeniedMetadata()
    Object.defineProperty(accessor, 'computed', {
      enumerable: true,
      get: () => 'not-data',
    })
    expect(() => redactAuditMetadata('context.request.denied', accessor)).toThrow(
      expect.objectContaining({ code: 'invalid-metadata' }),
    )
  })
})
