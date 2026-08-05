import { describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db/client'
import {
  createEntitlementAdminBoundary,
  type EntitlementAdminMutationReceipt,
  type EntitlementAdminWorkspace,
} from '../../../server/fuma/entitlements'

const NOW = new Date('2026-08-04T09:00:00.000Z')
const SECRET = 'control-runtime-secret-that-is-at-least-32-bytes'
const quotas = Object.freeze({ sites: 1, pages: 10, cmsItems: 10, members: 10, storageBytes: 10, bandwidthBytes: 10, emailRecipientsDay: 10, emailRecipientsMonth: 10, buildPublishMinutes: 10, pluginComputeMinutes: 10, aiCredits: 10, releaseRetentionBytes: 10, collaborators: 2, customDomains: 1 })
const workspace: EntitlementAdminWorkspace = Object.freeze({ generatedAt: NOW.toISOString(), priceBooks: [], offers: [], internalGrant: null, adjustments: [], recentEvents: [] })

function db(row = { role: 'admin', banned: false, ban_expires: null, staff_profile: true, platform_owner: true }): DbClient {
  const tagged = async () => ({ rows: [row], rowCount: 1 })
  return Object.assign(tagged, {
    dialect: 'postgres',
    unsafe: tagged,
    transaction: async <T>(callback: (client: DbClient) => Promise<T>) => await callback(client),
  }) as unknown as DbClient
}
function runtime(input: { createdAt?: Date; authorityRow?: Parameters<typeof db>[0] } = {}) {
  const calls: Array<{ command: unknown; authority: unknown }> = []
  const database = db(input.authorityRow)
  const client = database
  const service = {
    async workspace() { return workspace },
    async execute(command: unknown, authority: unknown): Promise<EntitlementAdminMutationReceipt> {
      calls.push({ command, authority })
      return { requestId: 'request-1234', operation: 'ensure-internal-grant', resourceId: 'platform-internal', resourceVersion: null, state: 'active' }
    },
  }
  const boundary = createEntitlementAdminBoundary({
    db: database,
    service: service as never,
    protectedOwnerEmail: 'owner@example.com',
    consoleHost: 'admin.trimly.co.ke',
    runtimeSecret: SECRET,
    now: () => NOW,
    resolveSession: async (headers) => headers.get('x-test-session') === 'ok' ? {
      userId: 'owner-user', sessionId: 'session-owner', impersonatedBy: null, email: 'owner@example.com',
      createdAt: input.createdAt ?? new Date(NOW.getTime() - 60_000),
    } : null,
  })
  return { boundary, calls, client }
}
function request(method: 'GET' | 'POST', body?: unknown, secret = SECRET) {
  return new Request('https://app.trimly.co.ke/api/fuma/internal/entitlements', {
    method,
    headers: { 'x-test-session': 'ok', 'x-fuma-control-runtime-secret': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('entitlement and price-book production admin boundary', () => {
  it('returns only the strict internal projection after private transport and Better Auth resolution', async () => {
    const { boundary } = runtime()
    expect(boundary.handles(request('GET'))).toBe(true)
    const response = await boundary.handle(request('GET'))
    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ result: workspace })
    expect(response?.headers.get('cache-control')).toContain('no-store')
    const authority = await boundary.handle(new Request('https://app.trimly.co.ke/api/fuma/internal/entitlements/authority', {
      headers: { 'x-test-session': 'ok', 'x-fuma-control-runtime-secret': SECRET },
    }))
    expect(authority?.status).toBe(200)
    expect(await authority?.json()).toEqual({ result: { actorId: 'owner-user', sessionId: 'session-owner', protectedOwner: true, fresh: true } })
  })

  it('derives protected-owner actor identity and rejects caller authority fields', async () => {
    const { boundary, calls } = runtime()
    const command = { kind: 'ensure-internal-grant', requestId: 'request-1234', quotas }
    const response = await boundary.handle(request('POST', command))
    expect(response?.status).toBe(200)
    expect(calls[0]).toMatchObject({ authority: { actorId: 'owner-user', sessionId: 'session-owner', protectedOwner: true, fresh: true } })
    const hostile = await boundary.handle(request('POST', { ...command, actorId: 'attacker', protectedOwner: true }))
    expect(hostile?.status).toBe(400)
    expect(calls).toHaveLength(1)
  })

  it('fails closed for missing private transport, stale sessions, non-platform owners, and impersonation/session absence', async () => {
    expect((await runtime().boundary.handle(request('GET', undefined, 'wrong-secret')))?.status).toBe(403)
    expect((await runtime({ createdAt: new Date(NOW.getTime() - 10 * 60_000) }).boundary.handle(request('POST', { kind: 'ensure-internal-grant', requestId: 'request-1234', quotas })))?.status).toBe(403)
    expect((await runtime({ authorityRow: { role: 'admin', banned: false, ban_expires: null, staff_profile: true, platform_owner: false } }).boundary.handle(request('GET')))?.status).toBe(403)
    const noCookie = request('GET'); noCookie.headers.delete('x-test-session')
    expect((await runtime().boundary.handle(noCookie))?.status).toBe(403)
  })
})
