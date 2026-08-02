import { describe, expect, it } from 'bun:test'
import {
  createErrorReporter,
  parseSentryDsn,
  redactErrorText,
} from '../errorReporter'

const DSN = 'https://abc123def456@o1.ingest.sentry.io/4507'

function recordingTransport() {
  const calls: { url: string; body: string }[] = []
  return {
    calls,
    transport: async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) })
      return undefined
    },
  }
}

describe('sentry DSN parsing', () => {
  it('accepts a well-formed DSN', () => {
    expect(parseSentryDsn(DSN)).toEqual({
      origin: 'https://o1.ingest.sentry.io',
      projectId: '4507',
      publicKey: 'abc123def456',
    })
  })

  it('refuses missing, blank, insecure, credentialed or project-less values', () => {
    for (const value of [
      undefined, null, '', '   ',
      'http://abc@o1.ingest.sentry.io/4507',
      'https://o1.ingest.sentry.io/4507',
      'https://abc:secret@o1.ingest.sentry.io/4507',
      'https://abc@o1.ingest.sentry.io/',
      'https://abc@o1.ingest.sentry.io/not-a-number',
      'not a url',
    ]) {
      expect(parseSentryDsn(value as string | null | undefined)).toBeNull()
    }
  })
})

describe('redaction', () => {
  it('removes connection strings, keys, tokens and cookies', () => {
    const redacted = redactErrorText([
      'connect postgres://fuma:hunter2@db.internal:5432/fuma failed',
      'authorization: Bearer abc.def.ghi',
      'api_key=sk_live_ABCDEF123456',
      'cookie: __Host-fuma_staff=abcdef; Path=/',
    ].join(' | '))
    expect(redacted).not.toContain('hunter2')
    expect(redacted).not.toContain('sk_live_ABCDEF123456')
    expect(redacted).not.toContain('abcdef;')
    expect(redacted).toContain('postgres://[redacted]')
  })

  it('removes emails and phone numbers', () => {
    const redacted = redactErrorText('failed for wanjiku@example.com on +254 700 123 456')
    expect(redacted).not.toContain('wanjiku@example.com')
    expect(redacted).not.toContain('700 123 456')
    expect(redacted).toContain('[redacted-email]')
  })

  it('removes JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
    expect(redactErrorText(`token ${jwt}`)).toContain('[redacted-jwt]')
  })

  it('bounds very long messages', () => {
    const redacted = redactErrorText('x'.repeat(5_000))
    expect(redacted.length).toBeLessThanOrEqual(2_001)
    expect(redacted.endsWith('…')).toBe(true)
  })
})

describe('error reporter', () => {
  it('is completely inert without a DSN', async () => {
    const { calls, transport } = recordingTransport()
    for (const dsn of [undefined, null, '', 'nonsense']) {
      const reporter = createErrorReporter({ dsn, environment: 'test', transport })
      expect(reporter.enabled).toBe(false)
      reporter.capture(new Error('boom'))
      await reporter.flush()
    }
    expect(calls).toHaveLength(0)
  })

  it('posts a redacted envelope to the ingest endpoint', async () => {
    const { calls, transport } = recordingTransport()
    const reporter = createErrorReporter({
      dsn: DSN, environment: 'production', release: 'abc1234', serverName: 'fuma-web', transport,
    })
    expect(reporter.enabled).toBe(true)
    reporter.capture(new Error('failed for wanjiku@example.com'), {
      route: '/admin/api/cms/data',
      method: 'POST',
      status: 500,
      tags: { role: 'web' },
    })
    await reporter.flush()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://o1.ingest.sentry.io/api/4507/envelope/')
    const lines = calls[0]!.body.split('\n')
    expect(lines).toHaveLength(3)
    const event = JSON.parse(lines[2]!) as {
      environment: string
      release: string
      transaction: string
      tags: Record<string, string>
      exception: { values: { type: string; value: string }[] }
    }
    expect(event.environment).toBe('production')
    expect(event.release).toBe('abc1234')
    expect(event.transaction).toBe('/admin/api/cms/data')
    expect(event.tags).toMatchObject({ method: 'POST', status: '500', role: 'web' })
    expect(event.exception.values[0]?.type).toBe('Error')
    // The captured message must not carry the email.
    expect(event.exception.values[0]?.value).toContain('[redacted-email]')
    expect(calls[0]?.body).not.toContain('wanjiku@example.com')
  })

  it('never throws when the transport fails', async () => {
    const reporter = createErrorReporter({
      dsn: DSN,
      environment: 'production',
      transport: async () => { throw new Error('ingest unreachable') },
    })
    expect(() => reporter.capture(new Error('boom'))).not.toThrow()
    await expect(reporter.flush()).resolves.toBeUndefined()
  })

  it('handles non-Error throwables', async () => {
    const { calls, transport } = recordingTransport()
    const reporter = createErrorReporter({ dsn: DSN, environment: 'test', transport })
    reporter.capture('a bare string failure')
    reporter.capture({ weird: true })
    await reporter.flush()
    expect(calls).toHaveLength(2)
    const first = JSON.parse(calls[0]!.body.split('\n')[2]!) as { exception: { values: { type: string }[] } }
    expect(first.exception.values[0]?.type).toBe('UnknownError')
  })

  it('caps event volume per window and recovers in the next window', async () => {
    const { calls, transport } = recordingTransport()
    let clock = 1_000
    const reporter = createErrorReporter({
      dsn: DSN, environment: 'test', transport, now: () => clock,
    })
    for (let index = 0; index < 50; index += 1) reporter.capture(new Error(`boom ${index}`))
    await reporter.flush()
    expect(calls).toHaveLength(30)

    clock += 61_000
    reporter.capture(new Error('after the window'))
    await reporter.flush()
    expect(calls).toHaveLength(31)
  })

  it('bounds stack frames', async () => {
    const { calls, transport } = recordingTransport()
    const reporter = createErrorReporter({ dsn: DSN, environment: 'test', transport })
    const error = new Error('deep')
    error.stack = ['Error: deep', ...Array.from({ length: 100 }, (_, i) => `    at frame${i} (/app/x.ts:${i}:1)`)].join('\n')
    reporter.capture(error)
    await reporter.flush()
    const event = JSON.parse(calls[0]!.body.split('\n')[2]!) as {
      exception: { values: { stacktrace: { frames: unknown[] } }[] }
    }
    expect(event.exception.values[0]?.stacktrace.frames.length).toBeLessThanOrEqual(30)
  })
})
