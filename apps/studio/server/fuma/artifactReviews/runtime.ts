import type { DbClient } from '../../db/client'
import type { ArtifactInstallationAuthority } from '../artifacts'
import { PostgresArtifactReviewRepository } from './postgres'
import { ArtifactScannerRegistry } from './scanners'
import { ArtifactReviewService, type ArtifactReviewInvalidationPort } from './service'
import type { ArtifactReviewInvalidation } from './contracts'
import { UnavailableArtifactReviewSigner, type ArtifactReviewSigner } from './signing'

export class PostgresArtifactReviewInvalidationPort implements ArtifactReviewInvalidationPort {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted artifact review invalidation requires PostgreSQL.')
    this.#db = db
  }
  async publish(event: ArtifactReviewInvalidation): Promise<void> {
    const result = await this.#db`select pg_notify(${'fuma_public_projection'},${JSON.stringify(event)})`
    if (result.rowCount !== 1) throw new Error('Artifact review invalidation could not be published.')
  }
}

export type HostedArtifactReviewRuntime = Readonly<{
  repository: PostgresArtifactReviewRepository
  service: ArtifactReviewService
}>

export function createHostedArtifactReviewRuntime(input: Readonly<{
  db: DbClient
  artifacts: ArtifactInstallationAuthority
  signer?: ArtifactReviewSigner
  scanners?: ArtifactScannerRegistry
}>): HostedArtifactReviewRuntime {
  const repository = new PostgresArtifactReviewRepository(input.db)
  return Object.freeze({
    repository,
    service: new ArtifactReviewService({
      repository,
      artifacts: input.artifacts,
      scanners: input.scanners ?? new ArtifactScannerRegistry(),
      signer: input.signer ?? new UnavailableArtifactReviewSigner(),
      invalidation: new PostgresArtifactReviewInvalidationPort(input.db),
    }),
  })
}
