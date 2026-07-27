import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  TransferCollaboratorIntentSchema,
  TransferCollaboratorRecordSchema,
  TransferCommandSchema,
  TransferConfirmationProgressSchema,
  TransferConfirmationSchema,
  TransferLifecycleStateSchema,
  TransferLockSchema,
  TransferManifestSchema,
  TransferOwnershipCoordinateSchema,
  TransferProposalSchema,
  TransferResultSchema,
  TransferRoleSchema,
  TransferStepSchema,
  TransferStepStateSchema,
  assertTransferCommand,
  assertTransferConfirmationLifecycle,
  assertTransferConfirmationProgress,
  assertTransferManifest,
  assertTransferProposal,
  assertTransferResult,
  assertTransferStep,
} from '../../../server/fuma/transfers/contracts'
import {
  TRANSFER_COLLABORATOR_STATES,
  TRANSFER_LIFECYCLE_STATES,
  TRANSFER_STEP_KINDS,
  TRANSFER_STEP_STATES,
} from '../../../server/fuma/transfers/schemaManifest'

const SOURCE = {
  platformId: 'platform-fuma',
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-primary',
} as const
const DESTINATION = {
  platformId: 'platform-fuma',
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-primary',
} as const
const NOW = '2026-07-25T05:10:24.168Z'
const SOURCE_CONFIRMED_AT = '2026-07-25T05:10:54.168Z'
const READY_AT = '2026-07-25T05:11:24.168Z'
const STARTED_AT = '2026-07-25T05:12:24.168Z'
const FINAL_AT = '2026-07-25T05:13:24.168Z'
const CHECKSUM = 'a'.repeat(64)
const FAILURE = {
  code: 'destination-failed',
  message: 'Destination operation failed.',
  retryable: false,
  details: {},
} as const

function manifest() {
  return {
    schemaVersion: 1,
    transferId: 'transfer-01',
    source: SOURCE,
    destination: DESTINATION,
    siteProfileId: 'website',
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: CHECKSUM,
    resources: ['site-record', 'content', 'media'],
    collaborators: [
      {
        userId: 'staff-editor',
        sourceRole: 'editor',
        intent: 'preserve',
        destinationRole: 'editor',
      },
      {
        userId: 'staff-viewer',
        sourceRole: 'viewer',
        intent: 'remove',
        destinationRole: null,
      },
    ],
    capturedAt: NOW,
  }
}

function proposal() {
  return {
    id: 'transfer-01',
    source: SOURCE,
    destination: DESTINATION,
    manifest: manifest(),
    state: 'proposed',
    proposedByUserId: 'staff-owner',
    proposedBySessionId: 'session-01',
    proposedRequestId: 'request-propose',
    cancellationRequestedByUserId: null,
    cancellationRequestId: null,
    cancellationReasonCode: null,
    resumeRequestedByUserId: null,
    resumeRequestId: null,
    resumeReasonCode: null,
    resumeCount: 0,
    failure: null,
    createdAt: NOW,
    updatedAt: NOW,
    readyAt: null,
    startedAt: null,
    compensationStartedAt: null,
    compensationCompletedAt: null,
    completedAt: null,
    cancelledAt: null,
  }
}

function lifecycleProposal(state: string) {
  const base = proposal()
  switch (state) {
    case 'proposed':
      return base
    case 'awaiting-confirmations':
      return { ...base, state, updatedAt: READY_AT }
    case 'ready':
      return { ...base, state, updatedAt: READY_AT, readyAt: READY_AT }
    case 'running':
      return {
        ...base,
        state,
        updatedAt: STARTED_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
      }
    case 'resume-requested':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        resumeRequestedByUserId: 'staff-source-owner',
        resumeRequestId: 'request-resume',
        resumeReasonCode: 'interrupted-effect',
        resumeCount: 1,
      }
    case 'cancellation-requested':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        cancellationRequestedByUserId: 'staff-source-owner',
        cancellationRequestId: 'request-cancel',
        cancellationReasonCode: 'operator-request',
      }
    case 'compensating':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        compensationStartedAt: FINAL_AT,
        failure: FAILURE,
      }
    case 'failed':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        compensationStartedAt: STARTED_AT,
        compensationCompletedAt: FINAL_AT,
        failure: FAILURE,
      }
    case 'completed':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        completedAt: FINAL_AT,
      }
    case 'cancelled':
      return {
        ...base,
        state,
        updatedAt: FINAL_AT,
        readyAt: READY_AT,
        startedAt: STARTED_AT,
        cancellationRequestedByUserId: 'staff-source-owner',
        cancellationRequestId: 'request-cancel',
        cancellationReasonCode: 'operator-request',
        cancelledAt: FINAL_AT,
      }
    default:
      throw new Error(`Unknown lifecycle state: ${state}`)
  }
}

function sourceConfirmation() {
  return {
    side: 'source',
    transferId: 'transfer-01',
    scope: SOURCE,
    confirmedByUserId: 'staff-source-owner',
    confirmedBySessionId: 'session-source',
    requestId: 'request-source-confirm',
    confirmedAt: SOURCE_CONFIRMED_AT,
  }
}

function destinationConfirmation() {
  return {
    side: 'destination',
    transferId: 'transfer-01',
    scope: DESTINATION,
    confirmedByUserId: 'staff-destination-owner',
    confirmedBySessionId: 'session-destination',
    requestId: 'request-destination-confirm',
    confirmedAt: READY_AT,
  }
}

function pendingStep() {
  return {
    id: 'step-01',
    transferId: 'transfer-01',
    lockId: 'lock-01',
    fence: 7,
    definitionId: 'transfer.content-snapshot',
    sequence: 137,
    attempt: 1,
    kind: 'forward',
    state: 'pending',
    receipt: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: null,
    finishedAt: null,
  }
}

function without(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}

describe('FUMA-023 transfer TypeBox contracts', () => {
  it('keeps collaborator roles customer-only and unable to synthesize internal authority', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer']) {
      expect(Value.Check(TransferRoleSchema, role)).toBe(true)
    }
    for (const role of ['protected-owner', 'platform', 'support', 'internal', 'console']) {
      expect(Value.Check(TransferRoleSchema, role)).toBe(false)
    }
  })

  it('requires complete strict ancestry and closed lifecycle/state unions', () => {
    expect(Value.Check(TransferOwnershipCoordinateSchema, SOURCE)).toBe(true)
    expect(Value.Check(
      TransferOwnershipCoordinateSchema,
      without(SOURCE, 'organizationId'),
    )).toBe(false)
    expect(Value.Check(TransferOwnershipCoordinateSchema, {
      ...SOURCE,
      tenantId: 'ambiguous-tenant',
    })).toBe(false)

    for (const state of TRANSFER_LIFECYCLE_STATES) {
      expect(Value.Check(TransferLifecycleStateSchema, state)).toBe(true)
    }
    for (const state of ['pending', 'executing', 'done', 'canceled']) {
      expect(Value.Check(TransferLifecycleStateSchema, state)).toBe(false)
    }
    for (const state of TRANSFER_STEP_STATES) {
      expect(Value.Check(TransferStepStateSchema, state)).toBe(true)
    }
    expect(Value.Check(TransferStepStateSchema, 'completed')).toBe(false)
  })

  it('validates immutable manifests and rejects same-owner or changed-site transfers', () => {
    const valid = manifest()
    expect(Value.Check(TransferManifestSchema, valid)).toBe(true)
    expect(() => assertTransferManifest(valid)).not.toThrow()

    const sameOwner = {
      ...valid,
      destination: { ...SOURCE },
    }
    expect(Value.Check(TransferManifestSchema, sameOwner)).toBe(true)
    expect(() => assertTransferManifest(sameOwner)).toThrow(expect.objectContaining({
      name: 'TransferContractError',
      code: 'same-owner',
      path: 'manifest.destination',
    }))

    const changedSite = {
      ...valid,
      destination: { ...DESTINATION, siteId: 'site-other' },
    }
    expect(() => assertTransferManifest(changedSite)).toThrow(expect.objectContaining({
      code: 'site-identity-mismatch',
      path: 'manifest.destination',
    }))

    expect(Value.Check(TransferManifestSchema, {
      ...valid,
      snapshotChecksum: 'not-a-sha256',
    })).toBe(false)
    expect(Value.Check(TransferManifestSchema, {
      ...valid,
      credentials: { secret: 'forbidden' },
    })).toBe(false)
    for (const [field, value] of [
      ['platformInternalGrantId', 'grant-private'],
      ['billingAuthorityId', 'billing-private'],
      ['paidTransferPendingId', 'pending-private'],
    ] as const) {
      expect(Value.Check(TransferManifestSchema, { ...valid, [field]: value })).toBe(false)
    }
    expect(Value.Check(TransferManifestSchema, without(valid, 'siteCapabilityOverrides'))).toBe(false)
    expect(Value.Check(TransferManifestSchema, without(valid, 'siteCapabilityIds'))).toBe(false)
    expect(() => assertTransferManifest({
      ...valid,
      siteCapabilityIds: ['site.settings', 'site.settings'],
    })).toThrow(expect.objectContaining({
      code: 'duplicate-capability-snapshot',
      path: 'manifest.siteCapabilityIds',
    }))
    expect(() => assertTransferManifest({
      ...valid,
      siteCapabilityOverrides: {
        grant: ['publication.editorial'],
        revoke: ['publication.editorial'],
      },
    })).toThrow(expect.objectContaining({
      code: 'duplicate-capability-snapshot',
      path: 'manifest.siteCapabilityOverrides',
    }))
  })

  it('rejects duplicate collaborator snapshots and enforces preserve/remove intent shape', () => {
    const valid = manifest()
    const duplicate = {
      ...valid,
      collaborators: [...valid.collaborators, valid.collaborators[0]],
    }
    expect(() => assertTransferManifest(duplicate)).toThrow(expect.objectContaining({
      code: 'duplicate-collaborator',
      path: 'manifest.collaborators',
    }))

    expect(Value.Check(TransferCollaboratorIntentSchema, valid.collaborators[0])).toBe(true)
    expect(Value.Check(TransferCollaboratorIntentSchema, valid.collaborators[1])).toBe(true)
    expect(Value.Check(TransferCollaboratorIntentSchema, {
      ...valid.collaborators[0],
      intent: 'remove',
      destinationRole: 'editor',
    })).toBe(false)
    expect(Value.Check(TransferCollaboratorIntentSchema, {
      ...valid.collaborators[0],
      intent: 'preserve',
      destinationRole: null,
    })).toBe(false)
  })

  it('binds proposals to the exact transfer, source, destination, and manifest', () => {
    const valid = proposal()
    expect(Value.Check(TransferProposalSchema, valid)).toBe(true)
    expect(() => assertTransferProposal(valid)).not.toThrow()

    expect(() => assertTransferProposal({
      ...valid,
      id: 'transfer-other',
    })).toThrow(expect.objectContaining({
      code: 'manifest-mismatch',
      path: 'proposal.manifest',
    }))
    expect(() => assertTransferProposal({
      ...valid,
      destination: {
        ...DESTINATION,
        workspaceId: 'workspace-other-destination',
      },
    })).toThrow(expect.objectContaining({ code: 'manifest-mismatch' }))
    expect(Value.Check(TransferProposalSchema, {
      ...valid,
      sourceOrganizationId: 'flattened-duplicate',
    })).toBe(false)
    expect(() => assertTransferProposal({
      ...valid,
      resumeCount: 1,
    })).toThrow(expect.objectContaining({
      code: 'lifecycle-shape-mismatch',
      path: 'proposal.state',
    }))
    expect(() => assertTransferProposal({
      ...valid,
      state: 'completed',
      completedAt: null,
    })).toThrow(expect.objectContaining({ code: 'lifecycle-shape-mismatch' }))
  })

  it('accepts the exact lifecycle matrix and rejects corrupted state facts or timelines', () => {
    for (const state of TRANSFER_LIFECYCLE_STATES) {
      expect(() => assertTransferProposal(lifecycleProposal(state))).not.toThrow()
    }

    expect(() => assertTransferProposal({
      ...lifecycleProposal('cancellation-requested'),
      readyAt: null,
      startedAt: null,
    })).not.toThrow()
    expect(() => assertTransferProposal({
      ...lifecycleProposal('cancelled'),
      readyAt: null,
      startedAt: null,
    })).not.toThrow()
    expect(() => assertTransferProposal({
      ...lifecycleProposal('completed'),
      resumeRequestedByUserId: 'staff-source-owner',
      resumeRequestId: 'request-resume',
      resumeReasonCode: 'interrupted-effect',
      resumeCount: 1,
    })).not.toThrow()

    const corruptions = [
      { ...lifecycleProposal('proposed'), updatedAt: READY_AT },
      { ...lifecycleProposal('proposed'), readyAt: NOW },
      { ...lifecycleProposal('awaiting-confirmations'), failure: FAILURE },
      { ...lifecycleProposal('ready'), startedAt: READY_AT },
      { ...lifecycleProposal('running'), readyAt: null },
      {
        ...lifecycleProposal('resume-requested'),
        resumeRequestedByUserId: null,
      },
      {
        ...lifecycleProposal('cancellation-requested'),
        cancellationRequestId: null,
      },
      { ...lifecycleProposal('compensating'), failure: null },
      { ...lifecycleProposal('failed'), compensationCompletedAt: null },
      { ...lifecycleProposal('completed'), completedAt: null },
      { ...lifecycleProposal('cancelled'), cancelledAt: null },
      { ...lifecycleProposal('running'), updatedAt: NOW },
      {
        ...lifecycleProposal('running'),
        readyAt: FINAL_AT,
        startedAt: STARTED_AT,
        updatedAt: FINAL_AT,
      },
      {
        ...lifecycleProposal('compensating'),
        compensationStartedAt: READY_AT,
      },
      {
        ...lifecycleProposal('failed'),
        compensationStartedAt: FINAL_AT,
        compensationCompletedAt: STARTED_AT,
      },
      {
        ...lifecycleProposal('completed'),
        completedAt: READY_AT,
      },
      {
        ...lifecycleProposal('proposed'),
        updatedAt: '2026-99-25T05:10:24.168Z',
      },
    ]
    for (const corrupted of corruptions) {
      expect(() => assertTransferProposal(corrupted)).toThrow(expect.objectContaining({
        code: 'lifecycle-shape-mismatch',
        path: 'proposal.state',
      }))
    }
  })

  it('models zero, one, or both confirmations without accepting duplicate-side shapes', () => {
    const none = {
      status: 'unconfirmed',
      source: null,
      destination: null,
    }
    const sourceOnly = {
      status: 'partially-confirmed',
      source: sourceConfirmation(),
      destination: null,
    }
    const destinationOnly = {
      status: 'partially-confirmed',
      source: null,
      destination: destinationConfirmation(),
    }
    const dual = {
      status: 'confirmed',
      source: sourceConfirmation(),
      destination: destinationConfirmation(),
    }
    for (const progress of [none, sourceOnly, destinationOnly, dual]) {
      expect(Value.Check(TransferConfirmationProgressSchema, progress)).toBe(true)
      expect(() => assertTransferConfirmationProgress(progress, SOURCE, DESTINATION))
        .not.toThrow()
    }

    expect(Value.Check(TransferConfirmationProgressSchema, {
      status: 'confirmed',
      source: sourceConfirmation(),
      destination: null,
    })).toBe(false)
    expect(Value.Check(TransferConfirmationProgressSchema, {
      status: 'confirmed',
      source: sourceConfirmation(),
      destination: sourceConfirmation(),
    })).toBe(false)
    expect(Value.Check(TransferConfirmationSchema, {
      ...sourceConfirmation(),
      side: 'both',
    })).toBe(false)

    expect(() => assertTransferConfirmationProgress({
      ...dual,
      destination: {
        ...destinationConfirmation(),
        scope: { ...DESTINATION, workspaceId: 'workspace-wrong' },
      },
    }, SOURCE, DESTINATION)).toThrow(expect.objectContaining({
      code: 'confirmation-scope-mismatch',
      path: 'confirmations.destination.scope',
    }))
    expect(() => assertTransferConfirmationProgress({
      ...dual,
      source: {
        ...sourceConfirmation(),
        scope: { ...SOURCE, organizationId: 'organization-wrong' },
      },
    }, SOURCE, DESTINATION, 'transfer-01')).toThrow(expect.objectContaining({
      code: 'confirmation-scope-mismatch',
      path: 'confirmations.source.scope',
    }))
    expect(() => assertTransferConfirmationProgress({
      ...dual,
      source: {
        ...sourceConfirmation(),
        transferId: 'transfer-other',
      },
    }, SOURCE, DESTINATION, 'transfer-01')).toThrow(expect.objectContaining({
      code: 'confirmation-scope-mismatch',
    }))
    expect(() => assertTransferConfirmationProgress({
      ...dual,
      destination: {
        ...destinationConfirmation(),
        confirmedByUserId: sourceConfirmation().confirmedByUserId,
      },
    }, SOURCE, DESTINATION, 'transfer-01')).toThrow(expect.objectContaining({
      code: 'confirmation-actor-conflict',
      path: 'confirmations.destination.confirmedByUserId',
    }))
  })

  it('rejects confirmation progress that contradicts proposal state or ready timestamp', () => {
    const dual = {
      status: 'confirmed',
      source: sourceConfirmation(),
      destination: destinationConfirmation(),
    } as const
    expect(() => assertTransferConfirmationLifecycle(
      lifecycleProposal('ready'),
      dual,
    )).not.toThrow()
    expect(() => assertTransferConfirmationLifecycle(
      lifecycleProposal('proposed'),
      dual,
    )).toThrow(expect.objectContaining({
      code: 'lifecycle-shape-mismatch',
      path: 'confirmations',
    }))
    expect(() => assertTransferConfirmationLifecycle(
      lifecycleProposal('awaiting-confirmations'),
      { status: 'unconfirmed', source: null, destination: null },
    )).toThrow(expect.objectContaining({ code: 'lifecycle-shape-mismatch' }))
    expect(() => assertTransferConfirmationLifecycle(
      lifecycleProposal('ready'),
      {
        status: 'partially-confirmed',
        source: sourceConfirmation(),
        destination: null,
      },
    )).toThrow(expect.objectContaining({ code: 'lifecycle-shape-mismatch' }))
    expect(() => assertTransferConfirmationLifecycle(
      lifecycleProposal('ready'),
      {
        ...dual,
        destination: {
          ...destinationConfirmation(),
          confirmedAt: SOURCE_CONFIRMED_AT,
        },
      },
    )).toThrow(expect.objectContaining({ code: 'lifecycle-shape-mismatch' }))
  })

  it('requires positive fenced locks with exact active/released timestamp shapes', () => {
    const active = {
      id: 'lock-01',
      transferId: 'transfer-01',
      scope: SOURCE,
      fence: 7,
      acquiredByJobId: 'job-transfer-01',
      acquiredByRunId: 'run-transfer-01-1',
      requestId: 'request-run-01',
      acquiredAt: NOW,
      heartbeatAt: NOW,
      state: 'active',
      releasedAt: null,
      releaseReasonCode: null,
    }
    expect(Value.Check(TransferLockSchema, active)).toBe(true)
    expect(Value.Check(TransferLockSchema, { ...active, fence: 0 })).toBe(false)
    expect(Value.Check(TransferLockSchema, {
      ...active,
      releasedAt: NOW,
      releaseReasonCode: 'completed',
    })).toBe(false)
    expect(Value.Check(TransferLockSchema, {
      ...active,
      state: 'released',
      releasedAt: NOW,
      releaseReasonCode: 'completed',
    })).toBe(true)
  })

  it('accepts arbitrary positive safe sequences and definition-qualified forward/compensation attempts', () => {
    const pending = pendingStep()
    expect(Value.Check(TransferStepSchema, pending)).toBe(true)
    expect(() => assertTransferStep(pending)).not.toThrow()

    for (const sequence of [1, 137, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertTransferStep({ ...pending, sequence })).not.toThrow()
    }
    for (const sequence of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(Value.Check(TransferStepSchema, { ...pending, sequence })).toBe(false)
    }
    expect(TRANSFER_STEP_KINDS).toEqual(['forward', 'compensation'])
    for (const kind of TRANSFER_STEP_KINDS) {
      expect(() => assertTransferStep({
        ...pending,
        id: `step-${kind}`,
        kind,
      })).not.toThrow()
    }
    expect(Value.Check(TransferStepSchema, {
      ...pending,
      kind: 'apply',
    })).toBe(false)
    expect(Value.Check(TransferStepSchema, without(pending, 'definitionId'))).toBe(false)
    expect(Value.Check(TransferStepSchema, {
      ...pending,
      definitionId: '',
    })).toBe(false)

    const receipt = { code: 'step-complete', details: { rows: 3 } }
    const error = {
      code: 'destination-busy',
      message: 'Destination is busy.',
      retryable: true,
      details: { retryAfterMs: 500 },
    }
    expect(Value.Check(TransferStepSchema, {
      ...pending,
      state: 'succeeded',
      receipt,
      startedAt: NOW,
      finishedAt: NOW,
    })).toBe(true)
    expect(Value.Check(TransferStepSchema, {
      ...pending,
      state: 'failed',
      error,
      startedAt: NOW,
      finishedAt: NOW,
    })).toBe(true)
    expect(Value.Check(TransferStepSchema, {
      ...pending,
      state: 'failed',
      receipt,
      error,
      startedAt: NOW,
      finishedAt: NOW,
    })).toBe(false)
    expect(Value.Check(TransferStepSchema, { ...pending, attempt: 0 })).toBe(false)
  })

  it('defines closed collaborator progress records for apply, skip, and failure outcomes', () => {
    const base = {
      id: 'collaborator-intent-01',
      transferId: 'transfer-01',
      collaborator: manifest().collaborators[0],
      state: 'pending',
      receipt: null,
      error: null,
      createdAt: NOW,
      updatedAt: NOW,
      appliedAt: null,
    }
    expect(Value.Check(TransferCollaboratorRecordSchema, base)).toBe(true)
    expect(TRANSFER_COLLABORATOR_STATES).toEqual([
      'pending', 'applying', 'applied', 'skipped', 'failed',
    ])
    expect(Value.Check(TransferCollaboratorRecordSchema, {
      ...base,
      state: 'applying',
    })).toBe(true)
    for (const state of ['applied', 'skipped']) {
      expect(Value.Check(TransferCollaboratorRecordSchema, {
        ...base,
        state,
        receipt: { code: 'collaborator-handled', details: {} },
        appliedAt: NOW,
      })).toBe(true)
    }
    expect(Value.Check(TransferCollaboratorRecordSchema, {
      ...base,
      state: 'failed',
      error: {
        code: 'membership-conflict',
        message: 'Membership could not be applied.',
        retryable: false,
        details: {},
      },
    })).toBe(true)
    expect(Value.Check(TransferCollaboratorRecordSchema, {
      ...base,
      state: 'applied',
    })).toBe(false)
    expect(Value.Check(TransferCollaboratorRecordSchema, {
      ...base,
      state: 'completed',
    })).toBe(false)
    expect(Value.Check(TransferCollaboratorRecordSchema, {
      ...base,
      collaborator: {
        ...base.collaborator,
        destinationRole: null,
      },
    })).toBe(false)
  })

  it('closes command variants and semantically validates proposal and step commands', () => {
    const propose = {
      kind: 'propose',
      transferId: 'transfer-01',
      source: SOURCE,
      destination: DESTINATION,
      manifest: manifest(),
      requestId: 'request-propose',
    }
    expect(Value.Check(TransferCommandSchema, propose)).toBe(true)
    expect(() => assertTransferCommand(propose)).not.toThrow()
    expect(() => assertTransferCommand({
      ...propose,
      destination: SOURCE,
      manifest: { ...manifest(), destination: SOURCE },
    })).toThrow(expect.objectContaining({ code: 'same-owner' }))
    expect(() => assertTransferCommand({
      kind: 'record-step',
      step: { ...pendingStep(), sequence: 0 },
    })).toThrow(expect.objectContaining({
      code: 'invalid-contract',
      path: 'command',
    }))

    for (const command of [
      { kind: 'confirm', confirmation: sourceConfirmation() },
      {
        kind: 'acquire-lock',
        transferId: 'transfer-01',
        scope: SOURCE,
        lockId: 'lock-01',
        fence: 7,
        jobId: 'job-01',
        runId: 'run-01',
        requestId: 'request-01',
      },
      { kind: 'record-step', step: pendingStep() },
      { kind: 'cancel', transferId: 'transfer-01', requestId: 'request-02', reasonCode: 'operator-request' },
      { kind: 'resume', transferId: 'transfer-01', requestId: 'request-03', reasonCode: 'destination-ready' },
    ]) {
      expect(Value.Check(TransferCommandSchema, command)).toBe(true)
      expect(() => assertTransferCommand(command)).not.toThrow()
    }
    expect(Value.Check(TransferCommandSchema, { ...propose, actorUserId: 'untrusted-body-user' }))
      .toBe(false)
    for (const field of [
      'eligibility',
      'platformInternalGrantId',
      'billingAuthorityId',
      'paidTransferPendingId',
    ]) {
      expect(Value.Check(TransferCommandSchema, { ...propose, [field]: 'caller-controlled' }))
        .toBe(false)
    }
    expect(Value.Check(TransferCommandSchema, { kind: 'force-complete', transferId: 'transfer-01' }))
      .toBe(false)
  })

  it('returns strict proposal, confirmation, lock, step, cancellation, and resume results', () => {
    const confirmationResult = {
      kind: 'confirmation-recorded',
      proposal: lifecycleProposal('ready'),
      confirmations: {
        status: 'confirmed',
        source: sourceConfirmation(),
        destination: destinationConfirmation(),
      },
    }
    expect(Value.Check(TransferResultSchema, confirmationResult)).toBe(true)
    expect(() => assertTransferResult(confirmationResult)).not.toThrow()

    const stepResult = {
      kind: 'step-recorded',
      proposal: proposal(),
      step: pendingStep(),
    }
    expect(Value.Check(TransferResultSchema, stepResult)).toBe(true)
    expect(() => assertTransferResult(stepResult)).not.toThrow()

    for (const kind of ['cancellation-recorded', 'resume-recorded']) {
      const result = { kind, proposal: proposal() }
      expect(Value.Check(TransferResultSchema, result)).toBe(true)
      expect(() => assertTransferResult(result)).not.toThrow()
    }
    expect(Value.Check(TransferResultSchema, {
      ...confirmationResult,
      rawDatabaseRow: {},
    })).toBe(false)
  })
})
