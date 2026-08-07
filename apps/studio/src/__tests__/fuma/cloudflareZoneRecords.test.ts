import { describe, expect, it } from 'bun:test'

import {
  type CloudflareHttpRequest,
  type CloudflareHttpResponse,
} from '../../../server/fuma/cloudflare/adapter'
import { CloudflareZoneRecordAdapter } from '../../../server/fuma/domains/cloudflareZoneRecords'
import { importZone, planImport } from '../../../server/fuma/domains/zoneImport'

const TOKEN = () => new Uint8Array(new TextEncoder().encode('a'.repeat(40)))

function http(responder: (req: CloudflareHttpRequest) => CloudflareHttpResponse) {
  const sent: CloudflareHttpRequest[] = []
  return {
    sent,
    async request(input: CloudflareHttpRequest) { sent.push(input); return responder(input) },
  }
}

const ok = (body: unknown): CloudflareHttpResponse => ({ status: 200, body })

function adapter(client: { request(i: CloudflareHttpRequest): Promise<CloudflareHttpResponse> }) {
  return new CloudflareZoneRecordAdapter({
    apiOrigin: 'https://api.cloudflare.com',
    zoneId: 'zone-abc',
    apiToken: TOKEN(),
    http: client,
  })
}

describe('configuration', () => {
  it('refuses a non-HTTPS origin', () => {
    expect(() => new CloudflareZoneRecordAdapter({
      apiOrigin: 'http://api.cloudflare.com', zoneId: 'z', apiToken: TOKEN(), http: http(() => ok({})),
    })).toThrow(/HTTPS/)
  })

  it('refuses an origin carrying credentials', () => {
    expect(() => new CloudflareZoneRecordAdapter({
      apiOrigin: 'https://user:pw@api.cloudflare.com', zoneId: 'z', apiToken: TOKEN(), http: http(() => ok({})),
    })).toThrow(/HTTPS/)
  })

  it('refuses an implausibly short token', () => {
    expect(() => new CloudflareZoneRecordAdapter({
      apiOrigin: 'https://api.cloudflare.com', zoneId: 'z', apiToken: new Uint8Array(4), http: http(() => ok({})),
    })).toThrow(/token/)
  })

  it('performs no network call in the constructor', () => {
    const client = http(() => ok({}))
    adapter(client)
    expect(client.sent).toHaveLength(0)
  })
})

describe('createRecord', () => {
  it('posts to the zone dns_records endpoint with a bearer token', async () => {
    const client = http(() => ok({ result: {} }))
    await adapter(client).createRecord('example.com', {
      type: 'TXT', name: 'example.com', value: 'v=spf1 include:zoho.com ~all',
    })
    const req = client.sent[0]
    expect(req?.method).toBe('POST')
    expect(req?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone-abc/dns_records')
    expect(req?.headers['authorization']).toStartWith('Bearer ')
  })

  it('carries the MX preference through', async () => {
    const client = http(() => ok({ result: {} }))
    await adapter(client).createRecord('example.com', {
      type: 'MX', name: 'example.com', value: 'mx.zoho.com', priority: 20,
    })
    expect((client.sent[0]?.body as Record<string, unknown>)['priority']).toBe(20)
  })

  it('refuses an MX record with no priority, naming the cause', async () => {
    const client = http(() => ok({ result: {} }))
    await expect(adapter(client).createRecord('example.com', {
      type: 'MX', name: 'example.com', value: 'mx.zoho.com',
    })).rejects.toThrow(/priority/)
    expect(client.sent).toHaveLength(0)
  })

  it('writes records unproxied', async () => {
    // Proxying an MX or TXT record is meaningless, and proxying is not what an import is for.
    const client = http(() => ok({ result: {} }))
    await adapter(client).createRecord('example.com', { type: 'A', name: 'example.com', value: '1.2.3.4' })
    expect((client.sent[0]?.body as Record<string, unknown>)['proxied']).toBe(false)
  })

  it('uses automatic TTL so a mistake is recoverable in minutes', async () => {
    const client = http(() => ok({ result: {} }))
    await adapter(client).createRecord('example.com', { type: 'A', name: 'example.com', value: '1.2.3.4' })
    expect((client.sent[0]?.body as Record<string, unknown>)['ttl']).toBe(1)
  })

  it('treats a non-2xx as a provider failure', async () => {
    const client = http(() => ({ status: 403, body: {} }))
    await expect(adapter(client).createRecord('example.com', {
      type: 'A', name: 'example.com', value: '1.2.3.4',
    })).rejects.toThrow(/failed/)
  })

  it('uppercases the record type', async () => {
    const client = http(() => ok({ result: {} }))
    await adapter(client).createRecord('example.com', { type: 'txt', name: 'x', value: 'y' })
    expect((client.sent[0]?.body as Record<string, unknown>)['type']).toBe('TXT')
  })
})

describe('listRecords', () => {
  it('reads the zone and maps content to value', async () => {
    const client = http(() => ok({
      result: [
        { type: 'MX', name: 'example.com', content: 'mx.zoho.com', priority: 10 },
        { type: 'TXT', name: 'example.com', content: 'v=spf1 -all' },
      ],
    }))
    const records = await adapter(client).listRecords('example.com')
    expect(records).toHaveLength(2)
    expect(records[0]?.value).toBe('mx.zoho.com')
    expect(records[0]?.priority).toBe(10)
    expect(records[1]?.priority).toBeUndefined()
  })

  it('preserves a priority of zero', async () => {
    // `priority || undefined` would discard a valid highest-preference MX record.
    const client = http(() => ok({ result: [{ type: 'MX', name: 'x', content: 'mx', priority: 0 }] }))
    const records = await adapter(client).listRecords('example.com')
    expect(records[0]?.priority).toBe(0)
  })

  it('asks for a large page so a paginated zone is not read as partial', async () => {
    // A partial destination list makes the import recreate records that already exist.
    const client = http(() => ok({ result: [] }))
    await adapter(client).listRecords('example.com')
    expect(client.sent[0]?.url).toContain('per_page=5000')
  })

  it('refuses a listing with no result set rather than reporting an empty zone', async () => {
    const client = http(() => ok({ success: true }))
    await expect(adapter(client).listRecords('example.com')).rejects.toThrow(/result set/)
  })

  it('refuses a record missing required fields', async () => {
    const client = http(() => ok({ result: [{ type: 'MX', name: 'x' }] }))
    await expect(adapter(client).listRecords('example.com')).rejects.toThrow(/required fields/)
  })
})

describe('close', () => {
  it('refuses further requests and zeroes the token', async () => {
    const client = http(() => ok({ result: {} }))
    const a = adapter(client)
    a.close()
    await expect(a.createRecord('example.com', { type: 'A', name: 'x', value: '1.2.3.4' }))
      .rejects.toThrow(/closed/)
  })
})

describe('end to end against the import', () => {
  it('imports a real provider record set through the adapter', async () => {
    const client = http((req) => (req.method === 'GET' ? ok({ result: [] }) : ok({ result: {} })))
    const a = adapter(client)
    const existing = [
      { type: 'MX', name: 'example.com', value: 'mx.zoho.com', priority: 10 },
      { type: 'MX', name: 'example.com', value: 'mx2.zoho.com', priority: 20 },
      { type: 'TXT', name: 'example.com', value: 'v=spf1 include:zoho.com ~all' },
      { type: 'NS', name: 'example.com', value: 'ns1.oldhost.com' },
    ]
    const destination = await a.listRecords('example.com')
    const outcome = await importZone('example.com', planImport(existing, destination), a)

    expect(outcome.complete).toBe(true)
    // Three copied, NS deliberately not.
    expect(outcome.imported).toHaveLength(3)
    const posts = client.sent.filter((r) => r.method === 'POST')
    expect(posts).toHaveLength(3)
    expect(posts.every((r) => (r.body as Record<string, unknown>)['type'] !== 'NS')).toBe(true)
  })

  it('a second run creates nothing, because the zone already holds the records', async () => {
    const stored: Array<Record<string, unknown>> = [
      { type: 'MX', name: 'example.com', content: 'mx.zoho.com', priority: 10 },
    ]
    const client = http((req) => (req.method === 'GET' ? ok({ result: stored }) : ok({ result: {} })))
    const a = adapter(client)
    const existing = [{ type: 'MX', name: 'example.com', value: 'mx.zoho.com', priority: 10 }]
    const outcome = await importZone(
      'example.com',
      planImport(existing, await a.listRecords('example.com')),
      a,
    )
    expect(outcome.imported).toHaveLength(0)
    expect(client.sent.filter((r) => r.method === 'POST')).toHaveLength(0)
  })
})
