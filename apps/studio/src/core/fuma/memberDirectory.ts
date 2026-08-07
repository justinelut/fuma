/**
 * The site members directory: the tenant's own end users, scoped to one site.
 *
 * === WHY THIS NEEDS A MODEL RATHER THAN A TABLE COMPONENT ===
 *
 * A member is recorded in TWO places, deliberately, and they do not agree:
 *
 * 1. The AUTH REALM (fuma_member_identities) holds the credential and the email. Its state is
 *    'active' | 'disabled' | 'activation-required'.
 * 2. The PUBLICATION ACCOUNT holds the profile - displayName, locale, timezone - and NO EMAIL. Its
 *    state is 'active' | 'disabled' | 'deletion-pending' | 'deleted'.
 *
 * THE HONESTY DEFECT THAT FOLLOWS, and it is the reason this file exists: a member can be `active`
 * in the publication account while the auth identity is `activation-required`. That person REGISTERED
 * AND HAS NEVER BEEN ABLE TO SIGN IN. A list reading only the account state calls them an active
 * member, and a heading reading "1,240 members" then includes people who never arrived - a number
 * somebody quotes in a pitch or uses to price a newsletter tier.
 *
 * So the effective state is RESOLVED from both records with a stated precedence, and the counts are
 * reported separately rather than as one total.
 */

/** Auth-realm state. Mirrors MemberIdentitySchema's own union. */
export type IdentityState = 'active' | 'disabled' | 'activation-required'

/** Publication-account state. Mirrors PublicationMemberAccountSchema's own union. */
export type AccountState = 'active' | 'disabled' | 'deletion-pending' | 'deleted'

/**
 * One row of the directory.
 *
 * `email` is OPTIONAL because it lives only on the auth identity, and `account` is optional because a
 * WEBSITE-profile site has no publication accounts at all - its members exist purely as auth
 * identities. A row type demanding both would make the directory unusable for one of the two profiles.
 */
export type MemberRow = Readonly<{
  memberIdentityId: string
  /** Absent when the row was built without the auth identity, which is a real state rather than an error. */
  email?: string
  displayName: string
  identityState: IdentityState
  /** Absent for a site with no publication accounts. */
  accountState?: AccountState
  createdAt: string
}>

/**
 * What the directory shows for a member, after both records are considered.
 *
 * `never-activated` is its OWN value rather than a flavour of active or disabled, because it needs a
 * different action: an active member needs nothing, a disabled one needs re-enabling, and this one
 * needs the activation email sending again.
 */
export type EffectiveState = 'active' | 'never-activated' | 'disabled' | 'removed'

/**
 * Resolve the two records into one state.
 *
 * THE PRECEDENCE IS THE DECISION, and each step has a reason:
 * 1. REMOVAL OUTRANKS EVERYTHING. A deleted or deletion-pending account must not be presented as a
 *    member whatever the credential says - showing a removed person's name in a live list is worse
 *    than omitting them, and counting them overstates the audience.
 * 2. NEVER-ACTIVATED OUTRANKS THE ACCOUNT'S OWN 'active'. The credential decides whether somebody can
 *    actually sign in, so the profile saying active cannot make them a member who has arrived.
 * 3. DISABLED IN EITHER PLACE IS DISABLED. Two records, one of which withdraws access, means access
 *    is withdrawn - taking the more permissive reading would let a stale profile re-open a door the
 *    auth realm closed.
 */
export function effectiveState(row: MemberRow): EffectiveState {
  if (row.accountState === 'deleted' || row.accountState === 'deletion-pending') return 'removed'
  if (row.identityState === 'activation-required') return 'never-activated'
  if (row.identityState === 'disabled' || row.accountState === 'disabled') return 'disabled'
  return 'active'
}

/** Whether a row belongs in the list at all. */
export function isListable(row: MemberRow): boolean {
  return effectiveState(row) !== 'removed'
}

export type MemberCounts = Readonly<{
  active: number
  neverActivated: number
  disabled: number
  removed: number
}>

/**
 * Counts reported separately, never as one total.
 *
 * Offering a single "members" figure is precisely how a never-activated registration becomes part of
 * an audience number. A caller that genuinely wants one number can add the fields it means, which
 * makes the choice visible at the call site rather than baked in here.
 */
export function countsFor(rows: readonly MemberRow[]): MemberCounts {
  let active = 0
  let neverActivated = 0
  let disabled = 0
  let removed = 0
  for (const row of rows) {
    switch (effectiveState(row)) {
      case 'active': active += 1; break
      case 'never-activated': neverActivated += 1; break
      case 'disabled': disabled += 1; break
      case 'removed': removed += 1; break
    }
  }
  return Object.freeze({ active, neverActivated, disabled, removed })
}

/**
 * How many rows the surface draws before it stops.
 *
 * Same reasoning as task 8's switcher: a publication can have thousands of members, rendering all of
 * them is slow to paint and nobody reads past the first screen. The cap is only honest if the hidden
 * count is shown, because a member who exists and is not listed reads as deleted.
 */
export const VISIBLE_MEMBER_LIMIT = 50

export type MemberSearch = Readonly<{
  visible: readonly MemberRow[]
  /** Matches beyond the cap. Reported so the cap cannot be mistaken for the whole list. */
  hidden: number
  /** Total matches, so a caller can say what it searched rather than what it drew. */
  matched: number
}>

/**
 * Search and cap.
 *
 * Searches the email AND the display name, because whoever is looking usually has one or the other -
 * a support request arrives with an email address, while a name is what appears in a comment.
 * Removed rows are excluded before searching, so a deleted account cannot be found by typing its
 * address.
 */
export function searchMembers(
  rows: readonly MemberRow[],
  query: string,
  limit: number = VISIBLE_MEMBER_LIMIT,
): MemberSearch {
  const listable = rows.filter(isListable)
  const needle = query.trim().toLowerCase()
  const matches = needle === ''
    ? listable
    : listable.filter(
      (row) =>
        row.displayName.toLowerCase().includes(needle)
        || (row.email ?? '').toLowerCase().includes(needle),
    )
  return Object.freeze({
    visible: Object.freeze(matches.slice(0, limit)),
    hidden: Math.max(0, matches.length - limit),
    matched: matches.length,
  })
}

/** What a row's state means, for a surface that must say rather than colour-code. */
export function describeState(state: EffectiveState): string {
  switch (state) {
    case 'active':
      return 'Active'
    case 'never-activated':
      // States the CONSEQUENCE, because "pending" alone does not say they cannot sign in.
      return 'Registered but never activated — they cannot sign in yet'
    case 'disabled':
      return 'Disabled — they cannot sign in'
    case 'removed':
      return 'Removed'
  }
}

export type DirectoryProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews what a directory can and cannot honestly show for a given site.
 *
 * Reports rather than refuses: a site with no accounts is a perfectly ordinary Website-profile site,
 * and a directory that refused to render for it would leave that profile with no members surface at
 * all - which is the defect this task exists to remove.
 */
export function reviewDirectory(input: Readonly<{
  rows: readonly MemberRow[]
  /** True when the site keeps publication accounts (a publication profile). */
  hasPublicationAccounts: boolean
  /** True when the auth realm's identities were readable for this listing. */
  identitiesEnumerable: boolean
}>): readonly DirectoryProblem[] {
  const problems: DirectoryProblem[] = []

  if (!input.identitiesEnumerable) {
    // THE REAL GAP, recorded rather than worked around: the auth realm's only read is
    // findIdentityByEmail, so identities cannot be enumerated. Without them a row has no email and no
    // credential state, which is exactly the information that distinguishes a member who arrived from
    // one who never did.
    problems.push({
      code: 'identities-not-enumerable',
      message: 'The member identity realm exposes only findIdentityByEmail, so this list cannot show addresses or say who has never activated. A scoped list read on the identity repository is what closes that.',
    })
  }

  if (!input.hasPublicationAccounts && input.rows.some((row) => row.accountState !== undefined)) {
    problems.push({
      code: 'account-state-without-accounts',
      message: 'A row carries a publication account state for a site that has no publication accounts, so the two sources disagree about what this site keeps.',
    })
  }

  const withoutIdentity = input.rows.filter((row) => row.memberIdentityId === '')
  if (withoutIdentity.length > 0) {
    // A row with no identity cannot be acted on - there is nothing to disable or re-invite.
    problems.push({
      code: 'row-without-identity',
      message: `${withoutIdentity.length} row(s) carry no member identity, so nothing in the list can be enabled, disabled or re-invited.`,
    })
  }

  return Object.freeze(problems)
}

/**
 * What the directory is, recorded because two records for one person invites the wrong summary.
 */
export const DIRECTORY_CONTRACT = Object.freeze({
  scope: 'A member belongs to one site. The identity realm keys every row on the site and its owner generation, so one site\'s members are not reachable from another.',
  twoRecords: 'The credential and the email live in the auth realm; the profile lives in the publication account. Neither is the whole member.',
  noSingleTotal: 'Counts are reported per state rather than as one number, because a never-activated registration in a members total overstates the audience.',
  notStaff: 'These are the tenant\'s own end users, never platform staff. The two realms are separate tables so one email can hold both without either becoming the other.',
})
