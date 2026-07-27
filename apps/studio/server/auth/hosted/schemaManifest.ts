export const AUTH_MODEL_NAMES = Object.freeze({
  user: 'auth_users',
  session: 'auth_sessions',
  account: 'auth_accounts',
  verification: 'auth_verifications',
  organization: 'auth_organizations',
  member: 'auth_members',
  invitation: 'auth_invitations',
  twoFactor: 'auth_two_factors',
})

export const HOSTED_AUTH_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000003_staff_identity',
  betterAuthTables: Object.freeze(Object.values(AUTH_MODEL_NAMES)),
  lifecycleTable: 'auth_staff_profiles',
  legacyIdentityLinkTable: 'auth_legacy_identity_links',
  credentialProviderId: 'credential',
})
