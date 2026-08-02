import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { AuditService, PostgresAuditRepository } from '../audit'
import type { MeteringCollector } from '../metering'
import type { TenantObjectStorage } from '../objectStorage'
import { GitHubAppInstallationTokenAuthority, SafeGitHubZipballFetchPort, type HostedNextSourceGitHubConfig } from './github'
import { createNextSourceScopedRoutes } from './routes'

export function createHostedNextSourceRuntime(input: Readonly<{
  db: DbClient
  storage: TenantObjectStorage
  releaseStorage: TenantObjectStorage
  metering: MeteringCollector
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  githubConfig?: HostedNextSourceGitHubConfig
}>) {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted Next source runtime requires PostgreSQL.')
  const audit = new AuditService({ repository: new PostgresAuditRepository(input.db) })
  const github = input.githubConfig
    ? Object.freeze({ config: input.githubConfig, tokens: new GitHubAppInstallationTokenAuthority({ config: input.githubConfig }), fetch: new SafeGitHubZipballFetchPort() })
    : undefined
  return Object.freeze({
    audit,
    github,
    scopedRoutes: createNextSourceScopedRoutes({ db: input.db, storage: input.storage, releaseStorage: input.releaseStorage, metering: input.metering, audit, resolveSession: input.resolveSession, ...(github ? { github } : {}) }),
  })
}
