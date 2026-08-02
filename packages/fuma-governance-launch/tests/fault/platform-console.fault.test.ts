import { describe, expect, it } from 'bun:test'
import { PlatformConsoleRegistry, PlatformConsoleService, type InternalAuthority, type PlatformConsoleReadSource } from '../../src'

const reader: InternalAuthority = { actorId: 'staff-reader', host: 'admin.trimly.co.ke', authorities: new Set(['internal.console.read']), stepUpAt: null, protectedOwner: false }
const writer: InternalAuthority = { actorId: 'staff-writer', host: 'admin.trimly.co.ke', authorities: new Set(['internal.console.write', 'internal.jobs.retry']), stepUpAt: '2026-07-29T11:59:00.000Z', protectedOwner: false }
const now = () => new Date('2026-07-29T12:00:00.000Z')

describe('FUMA-071 console fault containment', () => {
  it('fails closed without partial rows when a domain read authority is unavailable', async () => {
    const source: PlatformConsoleReadSource = { async read() { throw new Error('domain-read-unavailable') } }
    const service = new PlatformConsoleService({ source, registry: new PlatformConsoleRegistry(), now })
    await expect(service.query({ view: 'jobs', limit: 10 }, reader)).rejects.toThrow('domain-read-unavailable')
  })

  it('does not retry, translate, or claim success for a failed domain delegate', async () => {
    let calls = 0
    const registry = new PlatformConsoleRegistry()
    registry.registerAction({
      actionId: 'jobs.retry', requiredAuthority: 'internal.jobs.retry', requiresFreshStepUp: true,
      async execute() { calls += 1; throw new Error('canonical-job-authority-conflict') },
    })
    const service = new PlatformConsoleService({ source: { async read() { return [] } }, registry, now })
    await expect(service.execute({ actionId: 'jobs.retry', requestId: 'request-retry', input: { jobId: 'job-a' } }, writer)).rejects.toThrow('canonical-job-authority-conflict')
    expect(calls).toBe(1)
  })

  it('rejects a previously valid cursor after source contraction instead of skipping authority drift', async () => {
    let rows: readonly Readonly<Record<string, unknown>>[] = [{ jobId: 'job-a' }, { jobId: 'job-b' }]
    const source: PlatformConsoleReadSource = { async read() { return rows } }
    const service = new PlatformConsoleService({ source, registry: new PlatformConsoleRegistry(), now })
    const first = await service.query({ view: 'jobs', limit: 1 }, reader)
    expect(first.nextCursor).not.toBeNull()
    rows = []
    await expect(service.query({ view: 'jobs', cursor: first.nextCursor, limit: 1 }, reader)).rejects.toThrow('beyond')
  })
})
