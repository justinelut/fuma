import { describe, expect, it, mock } from 'bun:test'
import type { DbClient } from '../../../server/db/client'
import { createHostedCloudflareRuntime, FetchCloudflareHttpClient } from '../../../server/fuma/cloudflare/runtime'
import { createCloudflareRouteDeclarations } from '../../../server/fuma/cloudflare/routes'
import { cloudflareDomain, cloudflareScope, createCloudflareFixture, subdomainCapability } from './cloudflareSaasTestFixture'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'
import type { DomainPublicProjection, DomainRecord } from '../../../server/fuma/domains/contracts'

function inertPostgres(): DbClient {
  const unavailable = async () => { throw new Error('Database calls are not expected during composition.') }
  return Object.assign(unavailable, { unsafe: unavailable, transaction: unavailable, dialect: 'postgres' as const }) as DbClient
}

function routeInput(method: string, path: string, payload?: unknown): FumaScopedRouteHandlerInput {
  const { profileId: _profileId, ...repositoryScope } = cloudflareScope
  return {
    request: new Request(`https://5174.blyss.co.ke${path}`, {
      method,
      headers: payload === undefined ? undefined : { 'content-type': 'application/json', origin: 'https://5174.blyss.co.ke' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    params: {},
    repositoryScope,
    context: {
      profile: { id: 'website' },
      actor: { kind: 'staff', userId: 'user-a', sessionId: 'session-a', impersonator: null },
    },
  } as unknown as FumaScopedRouteHandlerInput
}

function projection(record: DomainRecord): DomainPublicProjection {
  return {
    domainId: record.domainId,
    hostname: record.hostname,
    unicodeHostname: record.unicodeHostname,
    kind: record.kind,
    desired: record.desired,
    observed: record.observed,
    certificate: record.certificate,
    version: record.version,
    updatedAt: record.updatedAt,
    credential: null,
  }
}

describe('hosted Cloudflare production composition', () => {
  it('mounts one runtime across web routes, worker handlers, scheduler discovery, and the selected-site UI', async () => {
    const [server, worker, scheduler, shell] = await Promise.all([
      Bun.file(new URL('../../../server/index.ts', import.meta.url)).text(),
      Bun.file(new URL('../../../server/fuma/publication/workerComposition.ts', import.meta.url)).text(),
      Bun.file(new URL('../../../server/fuma/jobs/integration.ts', import.meta.url)).text(),
      Bun.file(new URL('../../admin/preauth/HostedStaffShell.tsx', import.meta.url)).text(),
    ])
    expect(server).toContain('hostedCloudflareRuntime?.scopedRoutes')
    expect(worker).toContain('...(cloudflare?.jobs ?? {})')
    expect(scheduler).toContain('new PostgresRecurringCloudflareSource(deps.db)')
    expect(shell).toContain('<DomainsRouteContent')
  })

  it('constructs one durable runtime without provider calls and closes token custody', () => {
    const requests = mock(async () => ({ status: 500, body: null }))
    const runtime = createHostedCloudflareRuntime({
      db: inertPostgres(),
      config: {
        cloudflare: { owner: 'fuma', accountId: 'account-a', zoneId: 'zone-a', apiToken: 'token-1234567890123456' },
        hosts: { customerRouting: 'customers.trimly.co.ke' } as never,
      },
      domains: {
        repository: { exact: mock(async () => null) } as never,
        service: { create: mock(async () => null), list: mock(async () => []), transition: mock(async () => null) } as never,
      },
      http: { request: requests },
    })
    expect(runtime.scopedRoutes.map(({ path }) => path)).toContain('/settings/domains/cloudflare')
    expect(Object.keys(runtime.jobs)).toEqual(['fuma.cloudflare-reconcile'])
    expect(requests).not.toHaveBeenCalled()
    runtime.close()
  })

  it('uses a bounded official Cloudflare transport and rejects foreign origins', async () => {
    const fetch = mock(async () => Response.json({ success: true, result: {} }))
    const http = new FetchCloudflareHttpClient(fetch as unknown as typeof globalThis.fetch)
    await http.request({ method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones/zone-a/custom_hostnames', headers: {}, body: null })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(http.request({ method: 'GET', url: 'https://attacker.example/client/v4', headers: {}, body: null }))
      .rejects.toMatchObject({ code: 'configuration' })
  })

  it('creates, prevalidates, and lists a customer-owned DNS hostname without customer Cloudflare credentials', async () => {
    const fixture = createCloudflareFixture()
    const records = new Map<string, DomainRecord>()
    const routes = createCloudflareRouteDeclarations({
      reconciler: fixture.reconciler,
      domains: { async exact(_scope, domainId) { return records.get(domainId) ?? null } },
      catalog: {
        async list() { return [...records.values()].map(projection) },
        async create(scope, raw) {
          const command = raw as { domainId: string; hostname: string; requestedAt: string }
          const value = cloudflareDomain({
            ...scope,
            domainId: command.domainId,
            hostname: command.hostname,
            unicodeHostname: command.hostname,
            createdAt: command.requestedAt,
            updatedAt: command.requestedAt,
          })
          records.set(command.domainId, value)
          return projection(value)
        },
      },
      now: () => new Date('2026-08-04T12:00:00.000Z'),
    })
    const create = routes.find(({ method, path }) => method === 'POST' && path === '/settings/domains/cloudflare')!
    const input = routeInput('POST', '/settings/domains/cloudflare', {
      domainId: 'domain-new',
      hostname: 'www.customer.example',
      capability: subdomainCapability,
    })
    const created = await create.handler(input)
    const body = await created.json()
    expect(created.status).toBe(201)
    expect(body).toMatchObject({
      customerAccountRequired: false,
      customerTokenRequired: false,
      authoritativeDnsRetainedByCustomer: true,
      binding: { domainId: 'domain-new', lifecycle: 'awaiting-dns' },
    })
    expect(JSON.stringify(body)).not.toContain('platform-token')

    const list = routes.find(({ method, path }) => method === 'GET' && path === '/settings/domains/cloudflare')!
    const listed = await list.handler(routeInput('GET', '/settings/domains/cloudflare'))
    expect(await listed.json()).toMatchObject({ domains: [{ domain: { domainId: 'domain-new' }, binding: { domainId: 'domain-new' } }] })
  })
})
