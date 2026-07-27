import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { extname, join, relative } from 'path'
import { Value } from '@core/utils/typeboxHelpers'
import {
  TransferCompensateJobPayloadSchema,
  TransferExecuteJobPayloadSchema,
  TransferResumeJobPayloadSchema,
} from '../../../server/fuma/transfers'

const ROOT = join(import.meta.dir, '../../..')
const JOBS_PATH = 'server/fuma/transfers/jobs.ts'

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function productionTypeScript(root: string): string[] {
  const paths: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry)
      const stat = statSync(absolute)
      if (stat.isDirectory()) {
        if (entry !== '__tests__') walk(absolute)
      } else if (['.ts', '.tsx'].includes(extname(absolute))
        && !/\.(?:test|spec)\.[^.]+$/.test(absolute)) {
        paths.push(relative(ROOT, absolute).replaceAll('\\', '/'))
      }
    }
  }
  walk(join(ROOT, root))
  return paths.sort()
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing section start: ${start}`).toBeGreaterThan(-1)
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

function expectOrdered(source: string, labels: readonly string[]): void {
  let previous = -1
  for (const label of labels) {
    const current = source.indexOf(label)
    expect(current, `missing transfer boundary marker: ${label}`).toBeGreaterThan(-1)
    expect(current, `transfer boundary marker is out of order: ${label}`).toBeGreaterThan(previous)
    previous = current
  }
}

describe('FUMA-023 transfer architecture boundaries', () => {
  it('keeps saga execution reachable only through trusted durable-job handlers', () => {
    const outsideJobModule = productionTypeScript('server')
      .filter((path) => path !== JOBS_PATH)
      .filter((path) => /\bTransferSagaExecutor\b|\.runOne\s*\(/.test(read(path)))
    expect(outsideJobModule).toEqual([])

    const jobs = read(JOBS_PATH)
    expect(jobs.match(/new TransferSagaExecutor\(/g)).toHaveLength(1)
    expect(jobs.match(/executor\.runOne\(/g)).toHaveLength(1)
    expectOrdered(jobs, [
      'deriveFumaJobContext({',
      "trusted.kind !== 'site'",
      'handlerContext.readDurableResult(durableEffectKey)',
      'executor.runOne(jobKind, payload, trusted)',
    ])
    expectOrdered(section(
      jobs,
      'const prior = await handlerContext.readDurableResult(durableEffectKey)',
      'const result = parseCommittedResult(committedResult)',
    ), [
      'handlerContext.readDurableResult(durableEffectKey)',
      'executor.runOne(jobKind, payload, trusted)',
      'handlerContext.commitDurableResult(',
    ])
  })

  it('checks server-owned eligibility for new proposals and again before the start lock', () => {
    const service = read('server/fuma/transfers/service.ts')
    const proposal = section(service, 'async propose(', 'async confirm(')
    const start = section(service, 'async start(', 'async resume(')

    expect(service).toContain('eligibilityAuthority: TransferEligibilityAuthority')
    expect(service).toContain("decision: Type.Literal('eligible')")
    expect(service).toContain("decision: Type.Literal('ineligible')")
    expectOrdered(proposal, [
      'this.#manifestAuthority.capture({',
      'assertProposingSourceComposition(',
      "this.#assertEligible('proposal', trustedManifest)",
      'transaction.insertProposal(',
    ])
    expectOrdered(start, [
      "aggregate.proposal.state !== 'ready'",
      'assertExpectedVersion(',
      "this.#assertEligible('start', aggregate.proposal.manifest)",
      'transaction.acquireLock(',
      'transaction.recordStart(',
      'this.#enqueue.enqueue(',
    ])
    expect(section(service, 'export type ProposeTransferInput', 'export type ConfirmTransferInput'))
      .not.toContain('eligibility')
    expect(section(service, 'export type StartTransferInput', 'export type CancelTransferInput'))
      .not.toContain('eligibility')
  })

  it('keeps every durable transfer payload closed to the immutable transfer ID', () => {
    for (const schema of [
      TransferExecuteJobPayloadSchema,
      TransferResumeJobPayloadSchema,
      TransferCompensateJobPayloadSchema,
    ]) {
      expect(Value.Check(schema, { transferId: 'transfer-architecture' })).toBe(true)
      for (const forbidden of [
        'platformInternalGrantId',
        'billingAuthorityId',
        'paidTransferPendingId',
        'actor',
        'permissions',
        'fence',
      ]) {
        expect(Value.Check(schema, {
          transferId: 'transfer-architecture',
          [forbidden]: 'caller-controlled',
        })).toBe(false)
      }
    }
  })

  it('keeps base ownership atomic and excludes content plus control-plane authority effects', () => {
    const base = read('server/fuma/transfers/baseOwnershipStep.ts')
    const adapter = section(base, 'export interface BaseOwnershipAdapter {', '\n}')
    expect(adapter.match(/^\s{2}([a-zA-Z]+)\(/gm)?.map((line) => line.trim().split('(')[0]))
      .toEqual(['inspectBaseOwnership', 'publishBaseOwnership', 'restoreBaseOwnership'])
    expect(adapter).not.toMatch(/content|object|grant|billing|payment|contract/i)

    const postgres = read('server/fuma/transfers/postgresBaseOwnershipAdapter.ts')
    expect(postgres).not.toMatch(/platform[_-]internal|billing[_-]authority|paid[_-]transfer|payment[_-]id|contract[_-]id/i)
  })
})


describe('FUMA-024 tenant-object transfer architecture boundaries', () => {
  it('keeps tenant-object copy and policy mandatory, canonical, and outside profile contributions', () => {
    const copy = [
      read('server/fuma/transfers/objectCopyStep.ts'),
      read('server/fuma/transfers/objectCopyContracts.ts'),
      read('server/fuma/transfers/objectCopyAdapter.ts'),
    ].join('\n')
    const policy = read('server/fuma/transfers/objectOwnershipPolicyStep.ts')
    const registrations = read('server/fuma/transfers/registrations.ts')
    const profiles = read('src/core/fuma/launchProfiles.ts')

    expect(copy).toContain("from '../tenantObjects'")
    expect(copy).toContain("export const OBJECT_COPY_TRANSFER_STEP_ID = 'transfer.tenant-objects-copy'")
    expect(copy).toContain('mandatory: true')
    expect(copy).toContain('captureTenantObjectInventory')
    expect(copy).not.toMatch(/ObjectCopyManifest|missing-media-resource|transfer\.media\.assets/)

    expect(policy).toContain("dependsOn: Object.freeze([OBJECT_COPY_TRANSFER_STEP_ID])")
    expect(policy).toContain('assertTenantObjectCopyProgressReceipt')
    expect(policy).toContain('assertTenantObjectRebindReceipt')
    expect(policy).toContain('mandatory: true')

    expect(registrations).toContain('createRegisteredTransferStepRegistry')
    expect(registrations).toContain('definitions.${OBJECT_COPY_TRANSFER_STEP_ID}')
    expect(registrations).toContain('definitions.${OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID}')
    expect(profiles).not.toMatch(/transfer\.media(?:\.assets)?|transfer\.object-policy/)
  })

  it('keeps stable owner-key ancestry in the same base-ownership transaction as the site row', () => {
    const adapter = read('server/fuma/transfers/postgresBaseOwnershipAdapter.ts')
    const publish = section(
      adapter,
      '  publishBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult> {',
      '  restoreBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult> {',
    )
    const restore = section(
      adapter,
      '  restoreBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult> {',
      '  async #inspect(',
    )

    expectOrdered(publish, [
      'return this.#db.transaction(async (db) => {',
      'update fuma_tenant_owner_keys',
      'update fuma_sites',
      "return atomicResult('applied'",
    ])
    expectOrdered(restore, [
      'return this.#db.transaction(async (db) => {',
      'update fuma_tenant_owner_keys',
      'update fuma_sites',
      "return atomicResult('compensated'",
    ])
  })
})
