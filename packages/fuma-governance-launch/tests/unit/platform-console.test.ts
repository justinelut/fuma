import { describe, expect, it } from 'bun:test'
import {
  CONSOLE_VIEWS,
  PlatformConsoleRegistry,
  PlatformConsoleService,
  type ConsoleActionDelegate,
  type ConsoleQuery,
  type InternalAuthority,
  type PlatformConsoleReadSource,
} from '../../src'

const now = new Date('2026-07-29T12:00:00.000Z')
const reader: InternalAuthority = Object.freeze({
  actorId: 'staff-reader', host: 'admin.trimly.co.ke',
  authorities: new Set(['internal.console.read']), stepUpAt: null, protectedOwner: false,
})
const writer: InternalAuthority = Object.freeze({
  actorId: 'staff-writer', host: 'admin.trimly.co.ke',
  authorities: new Set(['internal.console.read', 'internal.console.write', 'internal.commercial.offer.issue']),
  stepUpAt: '2026-07-29T11:59:00.000Z', protectedOwner: false,
})

class Rows implements PlatformConsoleReadSource {
  constructor(readonly values: Partial<Record<ConsoleQuery['view'], readonly Readonly<Record<string, unknown>>[]>>) {}
  async read(view: ConsoleQuery['view']) { return this.values[view] ?? [] }
}

function service(source: PlatformConsoleReadSource, registry = new PlatformConsoleRegistry()) {
  return new PlatformConsoleService({ source, registry, now: () => now })
}

describe('FUMA-071 complete console queries', () => {
  it('covers every domain view and redacts forbidden, nested, and non-allowlisted values', async () => {
    const source = new Rows(Object.fromEntries(CONSOLE_VIEWS.map((view) => [view, [{
      organizationId: 'org-visible', state: 'active', secretToken: 'forbidden', arbitrary: 'forbidden', nested: { private: true },
    }]])))
    for (const view of CONSOLE_VIEWS) {
      const page = await service(source).query({ view, limit: 10 }, reader)
      expect(page.view).toBe(view)
      expect(JSON.stringify(page)).not.toMatch(/secretToken|forbidden|arbitrary|nested|private/)
      expect(Object.isFrozen(page)).toBe(true)
    }
  })

  it('searches only redacted fields and binds opaque pagination to view and filter', async () => {
    const source = new Rows({ clients: [
      { organizationId: 'org-a', name: 'Kijani One', lifecycle: 'provisional', privateJson: 'needle-secret' },
      { organizationId: 'org-b', name: 'Kijani Two', lifecycle: 'accepted' },
      { organizationId: 'org-c', name: 'Elsewhere', lifecycle: 'active' },
    ] })
    const console = service(source)
    const first = await console.query({ view: 'clients', filter: 'kijani', limit: 1 }, reader)
    expect(first).toMatchObject({ total: 2, rows: [{ organizationId: 'org-a', name: 'Kijani One', lifecycle: 'provisional' }] })
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const second = await console.query({ view: 'clients', filter: 'kijani', cursor: first.nextCursor, limit: 1 }, reader)
    expect(second.rows[0]).toMatchObject({ organizationId: 'org-b' })
    expect(second.nextCursor).toBeNull()
    expect((await console.query({ view: 'clients', filter: 'needle-secret', limit: 10 }, reader)).rows).toEqual([])
    await expect(console.query({ view: 'offers', filter: 'kijani', cursor: first.nextCursor, limit: 1 }, reader)).rejects.toThrow('cursor')
  })

  it('leaves FUMA-072/073/074 seams empty by default and explicitly mounts FUMA-068 metadata', () => {
    const registry = new PlatformConsoleRegistry()
    expect(registry.list()).toEqual([])
    expect(registry.actions()).toEqual([])
    const mounted = registry.register({ contributionId: 'artifact-review', ownerTicket: 'FUMA-068', routes: ['/internal/artifacts/reviews'], requiredAuthorities: ['internal.plugins.review'], mounted: false })
    expect(mounted).not.toHaveProperty('mounted')
    expect(registry.list()).toHaveLength(1)
    expect(registry.list().some(({ ownerTicket }) => ['FUMA-072', 'FUMA-073', 'FUMA-074'].includes(ownerTicket))).toBe(false)
  })
})

describe('FUMA-071 bounded delegated actions', () => {
  it('requires admin host, write plus domain capability and fresh step-up, then returns only a bounded receipt', async () => {
    let received: unknown
    const registry = new PlatformConsoleRegistry()
    const delegate: ConsoleActionDelegate = Object.freeze({
      actionId: 'commercial.offer.issue', requiredAuthority: 'internal.commercial.offer.issue', requiresFreshStepUp: true,
      async execute(input: unknown, context: Readonly<{ actorId: string; requestId: string; now: string }>) {
        received = { input, context }
        return { actionId: 'commercial.offer.issue', requestId: context.requestId, state: 'completed', resourceId: 'offer-a', resourceVersion: 1 }
      },
    })
    registry.registerAction(delegate)
    const result = await service(new Rows({}), registry).execute({ actionId: 'commercial.offer.issue', requestId: 'request-a', input: { offerId: 'offer-a' } }, writer)
    expect(result).toEqual({ actionId: 'commercial.offer.issue', requestId: 'request-a', state: 'completed', resourceId: 'offer-a', resourceVersion: 1 })
    expect(received).toMatchObject({ context: { actorId: 'staff-writer', requestId: 'request-a', now: now.toISOString() } })
    for (const authority of [
      { ...writer, host: 'app.trimly.co.ke' },
      { ...writer, authorities: new Set(['internal.console.write']) },
      { ...writer, stepUpAt: '2026-07-29T11:40:00.000Z' },
    ]) await expect(service(new Rows({}), registry).execute({ actionId: 'commercial.offer.issue', requestId: 'request-a', input: {} }, authority)).rejects.toThrow()
  })

  it('rejects duplicate delegates and mismatched or secret-shaped delegate output', async () => {
    const registry = new PlatformConsoleRegistry()
    const delegate: ConsoleActionDelegate = {
      actionId: 'commercial.offer.issue', requiredAuthority: 'internal.commercial.offer.issue', requiresFreshStepUp: true,
      async execute(_input, context) { return { actionId: 'commercial.offer.issue', requestId: `${context.requestId}-changed`, state: 'completed', resourceId: 'offer-a', resourceVersion: 1, secret: 'no' } },
    }
    registry.registerAction(delegate)
    expect(() => registry.registerAction(delegate)).toThrow('already registered')
    await expect(service(new Rows({}), registry).execute({ actionId: 'commercial.offer.issue', requestId: 'request-a', input: {} }, writer)).rejects.toThrow('console.action.result')
  })
})
