import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  OrganizationBootstrapInputSchema,
  PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
  PLATFORM_ORGANIZATION_ID,
  PLATFORM_ORGANIZATION_LAUNCH_LIMITS,
  PLATFORM_ORGANIZATION_NAME,
  PLATFORM_ORGANIZATION_PLACEMENT_CLASS,
  PLATFORM_ORGANIZATION_PLACEMENT_KEY,
  PLATFORM_ORGANIZATION_PROFILE_KIND,
  PLATFORM_ORGANIZATION_PROFILE_STATUS,
  PLATFORM_ORGANIZATION_SLUG,
  PLATFORM_OWNER_MEMBERSHIP_ID,
  OrganizationBootstrapError,
  type OrganizationBootstrapInput,
  type OrganizationBootstrapReceiptRecord,
  type OrganizationBootstrapResult,
  type OrganizationLimitsRecord,
  type OrganizationMembershipRecord,
  type OrganizationPlacementRecord,
  type OrganizationProfileRecord,
  type OrganizationRecord,
} from './contracts'
import type {
  OrganizationBootstrapRepository,
  OrganizationBootstrapTransaction,
} from './repository'

const BOOTSTRAP_LOCK_KEY = 'fuma:organization-bootstrap:platform:v1'

export interface OrganizationBootstrapServiceOptions {
  repository: OrganizationBootstrapRepository
  now?: () => Date
}

function conflict(message: string): never {
  throw new OrganizationBootstrapError('platform-conflict', message)
}

function normalizeOwnerEmail(email: string): string {
  return email.trim().toLowerCase()
}

function validateInput(input: unknown): OrganizationBootstrapInput {
  const parsed = safeParseValue(OrganizationBootstrapInputSchema, input)
  if (!parsed.ok) {
    throw new OrganizationBootstrapError('invalid-input', 'Protected owner bootstrap input is invalid.')
  }
  const normalized = normalizeOwnerEmail(parsed.value.protectedOwnerEmail)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new OrganizationBootstrapError('invalid-input', 'Protected owner email is invalid.')
  }
  return { protectedOwnerEmail: normalized }
}

function assertPlatformOrganization(rows: readonly OrganizationRecord[]): OrganizationRecord | null {
  if (rows.length === 0) return null
  if (rows.length !== 1) conflict('Platform organization ID and slug identify different organizations.')
  const row = rows[0]
  if (
    row.id !== PLATFORM_ORGANIZATION_ID
    || row.name !== PLATFORM_ORGANIZATION_NAME
    || row.slug !== PLATFORM_ORGANIZATION_SLUG
  ) {
    conflict('Existing platform organization does not match the fixed platform identity.')
  }
  return row
}

function assertPlatformMembership(
  rows: readonly OrganizationMembershipRecord[],
  ownerUserId: string,
): OrganizationMembershipRecord | null {
  if (rows.length === 0) return null
  if (rows.length !== 1) conflict('Platform owner membership collides with existing membership data.')
  const row = rows[0]
  if (
    row.id !== PLATFORM_OWNER_MEMBERSHIP_ID
    || row.organizationId !== PLATFORM_ORGANIZATION_ID
    || row.userId !== ownerUserId
    || row.role !== 'owner'
  ) {
    conflict('Existing platform owner membership does not match protected-owner semantics.')
  }
  return row
}

function assertPlatformProfile(row: OrganizationProfileRecord | null): void {
  if (row !== null && (
    row.organizationId !== PLATFORM_ORGANIZATION_ID
    || row.kind !== PLATFORM_ORGANIZATION_PROFILE_KIND
    || row.status !== PLATFORM_ORGANIZATION_PROFILE_STATUS
  )) {
    conflict('Existing platform organization profile conflicts with launch bootstrap data.')
  }
}

function assertPlatformLimits(row: OrganizationLimitsRecord | null): void {
  if (row !== null && (
    row.organizationId !== PLATFORM_ORGANIZATION_ID
    || row.maxWorkspaces !== PLATFORM_ORGANIZATION_LAUNCH_LIMITS.maxWorkspaces
    || row.maxSites !== PLATFORM_ORGANIZATION_LAUNCH_LIMITS.maxSites
    || row.maxStaff !== PLATFORM_ORGANIZATION_LAUNCH_LIMITS.maxStaff
  )) {
    conflict('Existing platform organization limits conflict with finite launch limits.')
  }
}

function assertPlatformPlacement(row: OrganizationPlacementRecord | null): void {
  if (row !== null && (
    row.organizationId !== PLATFORM_ORGANIZATION_ID
    || row.placementClass !== PLATFORM_ORGANIZATION_PLACEMENT_CLASS
    || row.placementKey !== PLATFORM_ORGANIZATION_PLACEMENT_KEY
  )) {
    conflict('Existing platform organization placement conflicts with shared launch placement.')
  }
}

function assertBootstrapReceipt(
  rows: readonly OrganizationBootstrapReceiptRecord[],
  ownerUserId: string,
): OrganizationBootstrapReceiptRecord | null {
  if (rows.length === 0) return null
  if (rows.length !== 1) conflict('Platform bootstrap receipt key and organization identify different receipts.')
  const row = rows[0]
  if (
    row.bootstrapKey !== PLATFORM_ORGANIZATION_BOOTSTRAP_KEY
    || row.organizationId !== PLATFORM_ORGANIZATION_ID
    || row.ownerUserId !== ownerUserId
  ) {
    conflict('Existing platform bootstrap receipt conflicts with protected-owner identity.')
  }
  return row
}

export class OrganizationBootstrapService {
  readonly #repository: OrganizationBootstrapRepository
  readonly #now: () => Date

  constructor(options: OrganizationBootstrapServiceOptions) {
    this.#repository = options.repository
    this.#now = options.now ?? (() => new Date())
  }

  async bootstrap(input: unknown): Promise<OrganizationBootstrapResult> {
    const validated = validateInput(input)
    return await this.#repository.transaction(async (tx) => {
      await tx.acquireBootstrapLock(BOOTSTRAP_LOCK_KEY)
      return await this.#bootstrapTransaction(tx, validated)
    })
  }

  async #bootstrapTransaction(
    tx: OrganizationBootstrapTransaction,
    input: OrganizationBootstrapInput,
  ): Promise<OrganizationBootstrapResult> {
    const owners = await tx.findUsersByNormalizedEmail(input.protectedOwnerEmail)
    if (owners.length === 0) {
      throw new OrganizationBootstrapError('owner-missing', 'Configured protected owner does not exist.')
    }
    if (owners.length !== 1) {
      throw new OrganizationBootstrapError('owner-ambiguous', 'Configured protected owner is ambiguous.')
    }
    const owner = owners[0]

    const organizations = await tx.findPlatformOrganizations(
      PLATFORM_ORGANIZATION_ID,
      PLATFORM_ORGANIZATION_SLUG,
    )
    const memberships = await tx.findPlatformMemberships(
      PLATFORM_OWNER_MEMBERSHIP_ID,
      PLATFORM_ORGANIZATION_ID,
      owner.id,
    )
    const profile = await tx.findOrganizationProfile(PLATFORM_ORGANIZATION_ID)
    const limits = await tx.findOrganizationLimits(PLATFORM_ORGANIZATION_ID)
    const placement = await tx.findOrganizationPlacement(PLATFORM_ORGANIZATION_ID)
    const receipt = await tx.findBootstrapReceipts(
      PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
      PLATFORM_ORGANIZATION_ID,
    )

    const organization = assertPlatformOrganization(organizations)
    const membership = assertPlatformMembership(memberships, owner.id)
    assertPlatformProfile(profile)
    assertPlatformLimits(limits)
    assertPlatformPlacement(placement)
    const existingReceipt = assertBootstrapReceipt(receipt, owner.id)

    const now = this.#now()
    if (!Number.isFinite(now.getTime())) {
      throw new OrganizationBootstrapError('invalid-input', 'Organization bootstrap clock returned an invalid date.')
    }

    await tx.enforceProtectedAdmin(owner.id, now)
    if (organization === null) {
      await tx.insertOrganization({
        id: PLATFORM_ORGANIZATION_ID,
        name: PLATFORM_ORGANIZATION_NAME,
        slug: PLATFORM_ORGANIZATION_SLUG,
      }, now)
    }
    if (membership === null) {
      await tx.insertMembership({
        id: PLATFORM_OWNER_MEMBERSHIP_ID,
        organizationId: PLATFORM_ORGANIZATION_ID,
        userId: owner.id,
        role: 'owner',
      }, now)
    }
    if (profile === null) {
      await tx.insertOrganizationProfile({
        organizationId: PLATFORM_ORGANIZATION_ID,
        kind: PLATFORM_ORGANIZATION_PROFILE_KIND,
        status: PLATFORM_ORGANIZATION_PROFILE_STATUS,
      }, now)
    }
    if (limits === null) {
      await tx.insertOrganizationLimits({
        organizationId: PLATFORM_ORGANIZATION_ID,
        ...PLATFORM_ORGANIZATION_LAUNCH_LIMITS,
      }, now)
    }
    if (placement === null) {
      await tx.insertOrganizationPlacement({
        organizationId: PLATFORM_ORGANIZATION_ID,
        placementClass: PLATFORM_ORGANIZATION_PLACEMENT_CLASS,
        placementKey: PLATFORM_ORGANIZATION_PLACEMENT_KEY,
      }, now)
    }
    if (existingReceipt === null) {
      await tx.insertBootstrapReceipt({
        bootstrapKey: PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
        organizationId: PLATFORM_ORGANIZATION_ID,
        ownerUserId: owner.id,
      }, now)
    }

    return {
      ownerUserId: owner.id,
      organizationId: PLATFORM_ORGANIZATION_ID,
      membershipId: PLATFORM_OWNER_MEMBERSHIP_ID,
      bootstrapKey: PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
      placementClass: PLATFORM_ORGANIZATION_PLACEMENT_CLASS,
      placementKey: PLATFORM_ORGANIZATION_PLACEMENT_KEY,
      limits: { ...PLATFORM_ORGANIZATION_LAUNCH_LIMITS },
    }
  }
}
