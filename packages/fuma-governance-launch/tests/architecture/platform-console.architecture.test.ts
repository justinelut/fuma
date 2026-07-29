import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('FUMA-071 platform console architecture', () => {
  it('keeps one projection/delegation boundary without SQL, app imports, Zod, or migration ownership', () => {
    const operations = source('packages/fuma-governance-launch/src/operations.ts')
    const contracts = source('packages/fuma-governance-launch/src/contracts.ts')
    for (const view of ['users', 'organizations', 'clients', 'workspaces', 'sites', 'plans', 'offers', 'contracts', 'invoices', 'economics', 'usage', 'domains', 'email', 'jobs', 'releases', 'ai', 'audit']) {
      expect(contracts).toContain(`'${view}'`)
      expect(operations).toContain(`${view}: Object.freeze(`)
    }
    expect(operations).toContain('PlatformConsoleReadSource')
    expect(operations).toContain('ConsoleActionDelegate')
    expect(operations).not.toMatch(/\b(?:select|insert|update|delete)\s+(?:from|into|fuma_)/i)
    expect(`${operations}\n${contracts}`).not.toMatch(/from ['"](?:apps\/|@fuma\/studio)|\b(?:zod|z\.object)\b/i)
    expect(source('apps/studio/server/fuma/db/migrations/index.ts')).not.toContain('platform_console')
  })

  it('delegates immutable custom offers and FUMA-068 reviews to their existing services', () => {
    const composition = source('apps/studio/server/fuma/platformConsole/composition.ts')
    expect(composition).toContain("from '../entitlements/service'")
    expect(composition).toContain('await entitlements.propose(input)')
    expect(composition).toContain('await entitlements.issue(draft)')
    expect(composition).toContain("from '../artifactReviews/service'")
    expect(composition).toContain("from '../artifactReviews/consoleContribution'")
    expect(composition).toContain('await reviews.decide(command)')
    expect(composition).toContain('await reviews.revoke(command)')
    expect(composition).not.toMatch(/\b(?:select|insert|update|delete)\s+(?:from|into|fuma_)/i)
  })

  it('keeps future support, expert and transfer seams empty until their owners compose them', () => {
    const composition = source('apps/studio/server/fuma/platformConsole/composition.ts')
    for (const ticket of ['FUMA-072', 'FUMA-073', 'FUMA-074']) expect(composition).toContain(`ownerTicket: '${ticket}'`)
    expect(composition.match(/mounted: false as const/g)).toHaveLength(3)
    expect(composition).not.toContain('beginSupportSession(')
    expect(composition).not.toContain('approveExpertRelease(')
    expect(composition).not.toContain('authorizeTransferHandoff(')
  })

  it('requires trusted production staff attestation and keeps app-local UI independent of Studio', () => {
    const host = source('apps/control-surfaces/lib/host.ts')
    const page = source('apps/control-surfaces/app/internal/page.tsx')
    const model = source('apps/control-surfaces/app/internal/console-model.ts')
    expect(host).toContain('FUMA_INTERNAL_AUTHORITY_ATTESTATION_SECRET')
    expect(host).toContain('timingSafeEqual')
    expect(host).toContain("authorities.includes('internal.console.read')")
    expect(page).toContain('requireInternalConsoleAuthority')
    expect(page).toContain('paid-transfer-pending')
    expect(page).toContain('setup KES 650.00 separate from recurring KES 2,400.00')
    expect(`${page}\n${model}`).not.toMatch(/from ['"][^'"]*apps\/studio/)
    expect(source('apps/studio/server/fuma/platformConsole/composition.ts')).not.toContain('tailwind')
  })
})
