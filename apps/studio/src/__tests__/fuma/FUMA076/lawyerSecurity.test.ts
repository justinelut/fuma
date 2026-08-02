import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { planLawyerImport } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot } from './lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

function snapshot(): Record<string, unknown> { return createFUMA076LawyerSnapshot() as Record<string, unknown> }
function ghost(value: Record<string, unknown>): Record<string, unknown> { return value.ghostExport as Record<string, unknown> }
function data(value: Record<string, unknown>): Record<string, unknown> { return ghost(value).data as Record<string, unknown> }

describe('FUMA-076 hostile and security boundaries', () => {
  it('rejects passwords, sessions, cookies, API keys, provider secrets, and unknown top-level authority', async () => {
    for (const forbidden of ['password', 'sessions', 'cookies', 'api_key', 'resend_api_key', 'paystack_secret_key']) {
      const value = snapshot()
      const users = data(value).users as Record<string, unknown>[]
      users[0] = { ...users[0], [forbidden]: 'must-never-import' }
      await expect(planLawyerImport(value, { importId: `hostile-${forbidden}`, dryRun: true, digest })).rejects.toMatchObject({ code: 'secret-detected' })
    }
    const extra = { ...snapshot(), tenantId: 'caller-selected-tenant' }
    await expect(planLawyerImport(extra, { importId: 'hostile-extra', dryRun: true, digest })).rejects.toMatchObject({ code: 'invalid-snapshot' })
  })

  it('quarantines unsafe reserved JSON without importing it as configuration', async () => {
    const value = snapshot()
    const posts = data(value).posts as Record<string, unknown>[]
    const target = posts.find((row) => row.slug === '_theme')!
    target.custom_excerpt = '{"__proto__":{"polluted":true}}'
    const plan = await planLawyerImport(value, { importId: 'unsafe-reserved-json', dryRun: true, digest })
    expect(plan.report.quarantine).toContainEqual(expect.objectContaining({ sourceId: target.id, field: 'custom_excerpt', reason: 'unsafe-json' }))
    expect(plan.report.reservedPages).toContainEqual(expect.objectContaining({ slug: '_theme', state: 'quarantined', mappedSettingKey: null }))
    expect(plan.genericPlan.objects.some(({ kind, value: mapped }) => kind === 'setting' && mapped.key === 'lawyer.reserved._theme')).toBe(false)
  })

  it('fails closed when declared counts or route uniqueness drift', async () => {
    const countDrift = snapshot()
    countDrift.expectedCounts = { ...(countDrift.expectedCounts as Record<string, unknown>), posts: 41 }
    await expect(planLawyerImport(countDrift, { importId: 'count-drift', dryRun: true, digest })).rejects.toMatchObject({ code: 'count-mismatch' })

    const duplicateRoute = snapshot()
    const routes = duplicateRoute.routes as Record<string, unknown>[]
    routes.push(structuredClone(routes[0]!))
    duplicateRoute.expectedCounts = { ...(duplicateRoute.expectedCounts as Record<string, unknown>), routes: 70 }
    await expect(planLawyerImport(duplicateRoute, { importId: 'duplicate-route', dryRun: true, digest })).rejects.toMatchObject({ code: 'invalid-snapshot' })
  })
})
