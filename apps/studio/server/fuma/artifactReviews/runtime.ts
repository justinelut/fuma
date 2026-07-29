import type { DbClient } from '../../db/client'
import type { ArtifactInstallationAuthority } from '../artifacts'
import { PostgresArtifactReviewRepository } from './postgres'
import { ArtifactScannerRegistry } from './scanners'
import { ArtifactReviewService } from './service'
import { UnavailableArtifactReviewSigner, type ArtifactReviewSigner } from './signing'

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
    }),
  })
}
