import type { DbClient } from '../../db/client'
import { createMemberAuthBoundary, type MemberAuthBoundary } from './boundary'
import { PostgresMemberSiteAuthority } from './postgresAuthority'
import { PostgresMemberIdentityRepository } from './postgresRepository'
import { MemberAuthenticationService } from './service'

export type HostedMemberIdentityRuntime = Readonly<{
  boundary: MemberAuthBoundary
  service: MemberAuthenticationService
  repository: PostgresMemberIdentityRepository
}>

export function readMemberAuthSecret(
  staffSecret: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.FUMA_MEMBER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('FUMA_MEMBER_AUTH_SECRET must contain at least 32 characters.')
  if (secret === staffSecret) throw new Error('FUMA_MEMBER_AUTH_SECRET must not equal the Better Auth staff secret.')
  return secret
}

export function createHostedMemberIdentityRuntime(input: Readonly<{ db: DbClient; secret: string }>): HostedMemberIdentityRuntime {
  const repository = new PostgresMemberIdentityRepository(input.db)
  const service = new MemberAuthenticationService({ repository, secret: input.secret })
  const boundary = createMemberAuthBoundary({ service, authority: new PostgresMemberSiteAuthority(input.db) })
  return Object.freeze({ boundary, service, repository })
}
