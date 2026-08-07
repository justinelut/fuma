import { describe, it, expect } from 'bun:test'
import {
  OpenProviderError,
  OpenProviderRegistrarAdapter,
  REGISTRAR_VENDOR,
  classifyResponse,
  describeFailure,
  isRetryable,
} from '../../../server/fuma/registrarAdapters/openProvider'
import type {
  RegistrarGatewayHttpClient,
  RegistrarGatewayRequest,
} from '../../../server/fuma/registrar/productionGateway'
import type { DomainCredentialAuthority } from '../../../server/fuma/domains/contracts'

const AUTHORITY = {
  scope: 'fuma-platform', platformId: 'platform-1',
} as unknown as DomainCredentialAuthority

const token = () => new TextEncoder().encode('a-sufficiently-long-token-value')

/** A gateway double that records requests and replays scripted responses. */
function gateway(
  responses: readonly Readonly<{ status: number, body: unknown }>[],
): RegistrarGatewayHttpClient & { requests: RegistrarGatewayRequest[] } {
  const requests: RegistrarGatewayRequest[] = []
  let index = 0
  return {
    requests,
    async request(input) {
      requests.push(input)
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      if (!response) throw new Error('no scripted response')
      return response
    },
  }
}

function failingGateway(): RegistrarGatewayHttpClient {
  return {
    async request() {
      throw new Error('socket closed')
    },
  }
}

const AVAILABLE = { status: 200, body: { hostname: 'newsite.co.ke', available: true } }

describe('the adapter is the only place the vendor is named', () => {
  it('names the vendor exactly once, here', () => {
    expect(REGISTRAR_VENDOR).toBe('openprovider')
  })
})

describe('configuration', () => {
  it('accepts a bare HTTPS origin', () => {
    expect(() => new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com', token: token(), http: gateway([AVAILABLE]),
    })).not.toThrow()
  })

  it('refuses plain HTTP', () => {
    // Registrar credentials must not cross the network in the clear.
    expect(() => new OpenProviderRegistrarAdapter({
      origin: 'http://api.example.com', token: token(), http: gateway([AVAILABLE]),
    })).toThrow(/HTTPS/)
  })

  it('refuses an origin carrying credentials or a query', () => {
    for (const origin of [
      'https://user:pass@api.example.com',
      'https://api.example.com?key=abc',
    ]) {
      expect(() => new OpenProviderRegistrarAdapter({
        origin, token: token(), http: gateway([AVAILABLE]),
      })).toThrow()
    }
  })

  it('refuses an implausibly short token', () => {
    expect(() => new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com',
      token: new TextEncoder().encode('short'),
      http: gateway([AVAILABLE]),
    })).toThrow(/token length/)
  })

  it('refuses a malformed origin', () => {
    expect(() => new OpenProviderRegistrarAdapter({
      origin: 'not a url', token: token(), http: gateway([AVAILABLE]),
    })).toThrow(/valid URL/)
  })
})

describe('classifying a response', () => {
  it('treats 401 and 403 as authentication', () => {
    // Must not be retried: it repeats identically until credentials change.
    expect(classifyResponse(401)).toBe('authentication')
    expect(classifyResponse(403)).toBe('authentication')
  })

  it('treats the vendor’s not-available codes as a normal negative answer', () => {
    // A search for a taken domain is an answer, not an incident.
    expect(classifyResponse(400, 320)).toBe('unavailable')
    expect(classifyResponse(400, 399)).toBe('unavailable')
  })

  it('treats other 4xx as a contract failure', () => {
    expect(classifyResponse(400)).toBe('contract')
    expect(classifyResponse(422)).toBe('contract')
  })

  it('treats 5xx as a provider fault', () => {
    expect(classifyResponse(500)).toBe('provider')
    expect(classifyResponse(503)).toBe('provider')
  })
})

describe('retry policy', () => {
  it('retries only a provider fault', () => {
    // Authentication and contract failures repeat identically, so retrying them only
    // burns the rate limit.
    expect(isRetryable('provider')).toBe(true)
    expect(isRetryable('authentication')).toBe(false)
    expect(isRetryable('contract')).toBe(false)
    expect(isRetryable('configuration')).toBe(false)
  })
})

describe('failure descriptions', () => {
  it('describes every class without vendor vocabulary', () => {
    // The message must stay true if the registrar is ever swapped.
    for (const code of ['authentication', 'unavailable', 'contract', 'configuration', 'provider'] as const) {
      const message = describeFailure(code)
      expect(message.length).toBeGreaterThan(20)
      expect(message.toLowerCase()).not.toContain('openprovider')
    }
  })

  it('says credentials need renewing on an authentication failure', () => {
    expect(describeFailure('authentication')).toMatch(/credentials/)
  })
})

describe('calling the provider', () => {
  const adapter = () => new OpenProviderRegistrarAdapter({
    origin: 'https://api.example.com', token: token(), http: gateway([AVAILABLE]),
  })

  it('returns a validated availability answer', async () => {
    const result = await adapter().search(AUTHORITY, 'newsite.co.ke')
    expect(result.available).toBe(true)
    expect(result.hostname).toBe('newsite.co.ke')
  })

  it('sends the credential as a bearer token', async () => {
    const http = gateway([AVAILABLE])
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com', token: token(), http,
    })
    await instance.search(AUTHORITY, 'newsite.co.ke')
    expect(http.requests[0]?.headers['authorization']).toMatch(/^Bearer /)
  })

  it('rejects a response that does not match the expected shape', async () => {
    // A vendor field rename surfaces here rather than as a malformed quote deep
    // inside the purchase workflow.
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com',
      token: token(),
      http: gateway([{ status: 200, body: { unexpected: true } }]),
    })
    await expect(instance.search(AUTHORITY, 'newsite.co.ke')).rejects.toThrow(/expected shape/)
  })

  it('does not forward the vendor’s own error message', async () => {
    // Forwarding it would put vendor vocabulary in front of a customer and vendor
    // knowledge into the caller.
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com',
      token: token(),
      http: gateway([{ status: 500, body: { message: 'openprovider internal xyz' } }]),
    })
    await expect(instance.search(AUTHORITY, 'newsite.co.ke'))
      .rejects.toThrow(/temporarily unreachable/)
  })

  it('reports a transport failure as a provider fault', async () => {
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com', token: token(), http: failingGateway(),
    })
    await expect(instance.search(AUTHORITY, 'newsite.co.ke'))
      .rejects.toThrow(/did not complete/)
  })

  it('refuses to work once closed', async () => {
    const instance = adapter()
    instance.close()
    await expect(instance.search(AUTHORITY, 'newsite.co.ke')).rejects.toThrow(/closed/)
  })
})

describe('idempotency lookup', () => {
  it('returns the result when the provider has one', async () => {
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com',
      token: token(),
      http: gateway([{
        status: 200,
        body: {
          providerReference: 'ref-1',
          registeredAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2027-08-01T00:00:00.000Z',
        },
      }]),
    })
    const result = await instance.lookupPurchase(AUTHORITY, 'key-1')
    expect(result?.providerReference).toBe('ref-1')
  })

  it('returns null only when the provider positively reports nothing', async () => {
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com',
      token: token(),
      http: gateway([{ status: 400, body: { code: 320 } }]),
    })
    expect(await instance.lookupPurchase(AUTHORITY, 'key-1')).toBeNull()
  })

  it('throws rather than returning null when the lookup itself failed', async () => {
    // "We could not ask" and "it did not happen" must not collapse into the same
    // answer — that is precisely how a domain gets registered twice.
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com', token: token(), http: failingGateway(),
    })
    await expect(instance.lookupPurchase(AUTHORITY, 'key-1')).rejects.toThrow()
  })

  it('applies the same rule to renewal lookups', async () => {
    const instance = new OpenProviderRegistrarAdapter({
      origin: 'https://api.example.com', token: token(), http: failingGateway(),
    })
    await expect(instance.lookupRenewal(AUTHORITY, 'key-1')).rejects.toThrow()
  })
})

describe('the error type', () => {
  it('carries a code the caller can branch on', () => {
    const error = new OpenProviderError('authentication', 'nope')
    expect(error.code).toBe('authentication')
    expect(error.name).toBe('OpenProviderError')
    expect(error instanceof Error).toBe(true)
  })
})
