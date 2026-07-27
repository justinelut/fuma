import { describe, expect, it } from 'bun:test'
import type { TransferContribution } from '@core/fuma'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
  TransferStepRegistryError,
  createTransferStepRegistry,
  type TransferStepDefinition,
  type TransferStepRegistryErrorCode,
} from '../../../server/fuma/transfers/stepRegistry'

function handler(id: string, order: number, dependsOn: readonly string[] = []): TransferStepDefinition {
  return {
    id,
    order,
    dependsOn,
    async apply() {
      return { code: `${id}-applied`, details: {} }
    },
    async compensate() {
      return {
        status: 'compensated',
        receipt: { code: `${id}-compensated`, details: {} },
      }
    },
    async verify() {
      return {
        status: 'verified',
        receipt: { code: `${id}-verified`, details: {} },
      }
    },
  }
}

function base(): TransferStepDefinition {
  return {
    ...handler(BASE_OWNERSHIP_TRANSFER_STEP_ID, BASE_OWNERSHIP_TRANSFER_STEP_ORDER),
    mandatory: true,
  }
}

function contribution(id: string, stepId: string): TransferContribution {
  return { id, stepId, permission: `${id}.run` }
}

function registryError(code: TransferStepRegistryErrorCode) {
  return expect.objectContaining({ name: 'TransferStepRegistryError', code })
}

describe('FUMA-023 deterministic transfer step registry', () => {
  it('preserves stable definition IDs while sorting arbitrary positive orders independent of input order', () => {
    const registry = createTransferStepRegistry([
      handler('transfer.prepare-content', 1),
      handler('transfer.content', 413, [
        BASE_OWNERSHIP_TRANSFER_STEP_ID,
        'transfer.prepare-content',
      ]),
      handler('transfer.finalize', Number.MAX_SAFE_INTEGER, [BASE_OWNERSHIP_TRANSFER_STEP_ID]),
      base(),
    ])
    const left = registry.compose([
      contribution('transfer.finalize-contribution', 'transfer.finalize'),
      contribution('transfer.content-contribution', 'transfer.content'),
    ])
    const right = registry.compose([
      contribution('transfer.content-contribution', 'transfer.content'),
      contribution('transfer.finalize-contribution', 'transfer.finalize'),
    ])

    expect(left.map(({ id }) => id)).toEqual([
      'transfer.prepare-content',
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
      'transfer.content',
      'transfer.finalize',
    ])
    expect(right.map(({ id }) => id)).toEqual(left.map(({ id }) => id))
    expect(left.map(({ order }) => order)).toEqual([
      1,
      BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
      413,
      Number.MAX_SAFE_INTEGER,
    ])
    expect(registry.get('transfer.prepare-content')?.id).toBe('transfer.prepare-content')
    expect(registry.get('transfer.content')?.id).toBe('transfer.content')
    expect(registry.get('transfer.finalize')?.id).toBe('transfer.finalize')
    expect(left.map(({ contribution: selected }) => selected?.id ?? null)).toEqual([
      null,
      null,
      'transfer.content-contribution',
      'transfer.finalize-contribution',
    ])
    expect(Object.isFrozen(left)).toBe(true)
    expect(left.every(Object.isFrozen)).toBe(true)
  })

  it('always composes base ownership even when a profile contributes no resource steps', () => {
    const registry = createTransferStepRegistry([base()])
    const composed = registry.compose([])

    expect(composed).toHaveLength(1)
    expect(composed[0]).toMatchObject({
      id: BASE_OWNERSHIP_TRANSFER_STEP_ID,
      order: BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
      mandatory: true,
      contribution: null,
    })
  })

  it('accepts the full positive safe order range and rejects non-positive or unsafe orders', () => {
    const registry = createTransferStepRegistry([
      handler('transfer.first', 1),
      base(),
      handler('transfer.last', Number.MAX_SAFE_INTEGER, [BASE_OWNERSHIP_TRANSFER_STEP_ID]),
    ])

    expect(registry.steps.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'transfer.first', order: 1 },
      { id: BASE_OWNERSHIP_TRANSFER_STEP_ID, order: BASE_OWNERSHIP_TRANSFER_STEP_ORDER },
      { id: 'transfer.last', order: Number.MAX_SAFE_INTEGER },
    ])

    for (const order of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createTransferStepRegistry([
        base(),
        handler('transfer.invalid-order', order),
      ])).toThrow(registryError('invalid-definition'))
    }
  })

  it('rejects duplicate step IDs and orders', () => {
    expect(() => createTransferStepRegistry([
      base(),
      handler(BASE_OWNERSHIP_TRANSFER_STEP_ID, 50),
    ])).toThrow(registryError('duplicate-step-id'))

    expect(() => createTransferStepRegistry([
      base(),
      handler('transfer.same-order', BASE_OWNERSHIP_TRANSFER_STEP_ORDER),
    ])).toThrow(registryError('duplicate-step-order'))
  })

  it('rejects missing, cyclic, repeated, and order-inverting dependencies', () => {
    expect(() => createTransferStepRegistry([
      base(),
      handler('transfer.missing', 60, ['transfer.not-registered']),
    ])).toThrow(registryError('missing-dependency'))

    expect(() => createTransferStepRegistry([
      base(),
      handler('transfer.cycle-a', 60, ['transfer.cycle-b']),
      handler('transfer.cycle-b', 70, ['transfer.cycle-a']),
    ])).toThrow(registryError('cyclic-dependency'))

    expect(() => createTransferStepRegistry([
      base(),
      handler('transfer.repeated', 60, [
        BASE_OWNERSHIP_TRANSFER_STEP_ID,
        BASE_OWNERSHIP_TRANSFER_STEP_ID,
      ]),
    ])).toThrow(registryError('nondeterministic-composition'))

    expect(() => createTransferStepRegistry([
      base(),
      handler('transfer.late-dependency', 80),
      handler('transfer.early-dependent', 70, ['transfer.late-dependency']),
    ])).toThrow(registryError('nondeterministic-composition'))
  })

  it('rejects a missing or malformed mandatory base ownership step', () => {
    expect(() => createTransferStepRegistry([
      handler('transfer.content', 60),
    ])).toThrow(registryError('missing-base-ownership-step'))

    expect(() => createTransferStepRegistry([
      { ...base(), mandatory: false },
    ])).toThrow(registryError('missing-base-ownership-step'))

    expect(() => createTransferStepRegistry([
      { ...base(), dependsOn: ['transfer.prepare'] },
      handler('transfer.prepare', 20),
    ])).toThrow(registryError('missing-base-ownership-step'))
  })

  it('rejects duplicate contribution IDs, colliding step selection, and unknown handlers', () => {
    const registry = createTransferStepRegistry([
      base(),
      handler('transfer.content', 60, [BASE_OWNERSHIP_TRANSFER_STEP_ID]),
    ])

    expect(() => registry.compose([
      contribution('transfer.shared', 'transfer.content'),
      contribution('transfer.shared', 'transfer.content'),
    ])).toThrow(registryError('duplicate-contribution-id'))

    expect(() => registry.compose([
      contribution('transfer.one', 'transfer.content'),
      contribution('transfer.two', 'transfer.content'),
    ])).toThrow(registryError('contribution-collision'))

    expect(() => registry.compose([
      contribution('transfer.base', BASE_OWNERSHIP_TRANSFER_STEP_ID),
    ])).toThrow(registryError('contribution-collision'))

    expect(() => registry.compose([
      contribution('transfer.unknown', 'transfer.not-registered'),
    ])).toThrow(registryError('unknown-contribution-step'))
  })

  it('requires all three handlers and reports stable typed errors', () => {
    const malformed = {
      ...handler('transfer.malformed', 60),
      verify: undefined,
    } as unknown as TransferStepDefinition

    try {
      createTransferStepRegistry([base(), malformed])
    } catch (error) {
      expect(error).toBeInstanceOf(TransferStepRegistryError)
      if (!(error instanceof TransferStepRegistryError)) throw error
      expect(error.code).toBe('invalid-definition')
      expect(error.path).toBe('steps[1].verify')
      return
    }
    throw new Error('Expected malformed transfer step definition to be rejected')
  })
})
