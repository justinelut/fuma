import { describe, expect, it } from 'bun:test'
import { RegistrarGatewayAdapter, type RegistrarGatewayRequest } from '../../../server/fuma/registrar/productionGateway'
import { platformCredentialAuthority } from '../../../server/fuma/domains/contracts'

const authority = platformCredentialAuthority('fuma')

describe('production registrar gateway adapter', () => {
  it('sends explicit platform authority to a configured HTTPS gateway and validates the response', async () => {
    const requests: RegistrarGatewayRequest[] = []
    const adapter = new RegistrarGatewayAdapter({
      origin: 'https://registrar-gateway.internal',
      token: new TextEncoder().encode('registrar-token-1234567890'),
      http: {
        async request(input) {
          requests.push(input)
          return { status: 200, body: { hostname: 'example.co.ke', available: true } }
        },
      },
    })
    expect(await adapter.search(authority, 'example.co.ke')).toEqual({ hostname: 'example.co.ke', available: true })
    expect(requests[0]).toMatchObject({
      url: 'https://registrar-gateway.internal/v1/domains/search',
      headers: { authorization: 'Bearer registrar-token-1234567890' },
      body: { authority, hostname: 'example.co.ke' },
    })
    adapter.close()
    await expect(adapter.search(authority, 'example.co.ke')).rejects.toMatchObject({ code: 'configuration' })
  })

  it('rejects insecure origins and unknown provider response fields', async () => {
    expect(() => new RegistrarGatewayAdapter({
      origin: 'http://registrar.example', token: new Uint8Array(32),
      http: { async request() { return { status: 200, body: {} } } },
    })).toThrow('explicit HTTPS origin')
    const adapter = new RegistrarGatewayAdapter({
      origin: 'https://registrar.example', token: new Uint8Array(32).fill(1),
      http: { async request() { return { status: 200, body: { hostname: 'example.co.ke', available: true, leaked: 'value' } } } },
    })
    await expect(adapter.search(authority, 'example.co.ke')).rejects.toMatchObject({ code: 'contract' })
  })
})
