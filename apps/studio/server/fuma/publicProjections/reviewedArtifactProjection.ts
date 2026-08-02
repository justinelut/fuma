import {
  PublicComponentSchema,
  PublicPluginSchema,
  type PublicComponent,
  type PublicPlugin,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { DbClient } from '../../db/client'
import {
  ArtifactReviewDecisionSchema,
  ArtifactReviewSubmissionSchema,
  parseReviewContract,
  type ArtifactReviewDecision,
  type ArtifactReviewSubmission,
} from '../artifactReviews/contracts'
import { PublicProjectionUnavailableError } from './authority'
import { boundedSearchMatch, paginatePublicDiscovery, sortedUnique } from './discoveryPagination'
import type { ApprovedPublicProjectionSource } from './adapters/validatedDomainAdapter'

const ReviewedPublicMetadataSchema = Type.Object({
  id: PublicPluginSchema.properties.id,
  slug: PublicPluginSchema.properties.slug,
  name: PublicPluginSchema.properties.name,
  summary: PublicPluginSchema.properties.summary,
  categories: PublicPluginSchema.properties.categories,
  publisherName: PublicPluginSchema.properties.publisherName,
  publisherVerified: Type.Literal(true),
  permissionLabels: PublicPluginSchema.properties.permissionLabels,
  imageUrl: PublicPluginSchema.properties.imageUrl,
}, { additionalProperties: false })

type ReviewedArtifactRow = Readonly<{
  artifact_kind: 'plugin' | 'component-pack'
  package_id: string
  exact_version: string
  content_hash_sha256: string
  submission_json: unknown
  decision_json: unknown
  decided_at: string | Date
  publisher_name: string
  publisher_memberships: string | number | bigint
}>

function storedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return null }
}

function timestamp(value: string | Date): string {
  const epoch = new Date(value).getTime()
  if (!Number.isFinite(epoch)) throw new PublicProjectionUnavailableError('Reviewed artifact timestamp failed validation.')
  return new Date(epoch).toISOString()
}

function parseStored<T>(schema: Parameters<typeof parseReviewContract>[0], value: unknown, label: string): T {
  try { return parseReviewContract(schema, storedJson(value), label) as T }
  catch { throw new PublicProjectionUnavailableError(`Reviewed artifact ${label} failed validation.`) }
}

function publicArtifact(row: ReviewedArtifactRow): PublicPlugin | PublicComponent {
  const submission = parseStored<ArtifactReviewSubmission>(ArtifactReviewSubmissionSchema, row.submission_json, 'submission')
  const decision = parseStored<ArtifactReviewDecision>(ArtifactReviewDecisionSchema, row.decision_json, 'decision')
  const metadata = submission.metadata.public
  if (!Value.Check(ReviewedPublicMetadataSchema, metadata)
    || submission.artifact.kind !== row.artifact_kind
    || submission.artifact.packageId !== row.package_id
    || submission.artifact.exactVersion !== row.exact_version
    || submission.artifact.contentHashSha256 !== row.content_hash_sha256
    || submission.scanState !== 'clean'
    || decision.submissionId !== submission.submissionId
    || decision.artifactId !== submission.artifact.artifactId
    || decision.contentHashSha256 !== submission.artifact.contentHashSha256
    || decision.decision !== 'approved'
    || decision.signature === null
    || timestamp(decision.decidedAt) !== timestamp(row.decided_at)
    || Number(row.publisher_memberships) !== 1
    || metadata.publisherName !== row.publisher_name) {
    throw new PublicProjectionUnavailableError('Reviewed artifact authority binding changed.')
  }
  const reviewEvidence = {
    contentHashSha256: submission.artifact.contentHashSha256,
    signatureKeyId: decision.signature.keyId,
    signaturePayloadHashSha256: decision.signature.payloadHashSha256,
    provenanceHashSha256: submission.metadata.evidence.provenanceHashSha256,
    licenseSpdx: submission.metadata.evidence.license.spdx,
    accessibilityStandard: submission.metadata.evidence.accessibility.standard,
    minimumRuntimeVersion: submission.metadata.evidence.runtimeCompatibility.minimumVersion,
  }
  const item = {
    ...metadata,
    publisherVerified: true as const,
    version: submission.artifact.exactVersion,
    reviewEvidence,
    reviewedAt: timestamp(row.decided_at),
    artifactKind: row.artifact_kind,
  }
  const schema = row.artifact_kind === 'plugin' ? PublicPluginSchema : PublicComponentSchema
  if (!Value.Check(schema, item)) throw new PublicProjectionUnavailableError('Reviewed artifact public projection failed validation.')
  return item as PublicPlugin | PublicComponent
}

async function readCurrentReviewedArtifacts(db: DbClient): Promise<readonly (PublicPlugin | PublicComponent)[]> {
  const result = await db<ReviewedArtifactRow>`
    with approved as (
      select submission.artifact_kind,submission.package_id,submission.exact_version,
        submission.content_hash_sha256,submission.submission_json,decision.decision_json,
        decision.decision_id,decision.decided_at,submission.submitter_id,
        row_number() over (
          partition by submission.artifact_kind,submission.package_id
          order by decision.decided_at desc,submission.exact_version desc,submission.submission_id
        ) as release_rank
      from fuma_artifact_review_submissions_v2 submission
      join fuma_artifact_review_decisions_v2 decision on decision.submission_id=submission.submission_id
        and decision.artifact_id=submission.artifact_id
        and decision.content_hash_sha256=submission.content_hash_sha256
      where submission.scan_state='clean' and decision.decision='approved'
        and decision.signature_key_id is not null
        and decision.signature_payload_hash_sha256 is not null
        and decision.signature_value is not null
        and (select count(*) from fuma_artifact_scan_reports_v2 report
          where report.submission_id=submission.submission_id and report.state='clean')>=2
        and not exists (select 1 from fuma_artifact_scan_reports_v2 report
          where report.submission_id=submission.submission_id and report.state<>'clean')
    )
    select approved.artifact_kind,approved.package_id,approved.exact_version,
      approved.content_hash_sha256,approved.submission_json,approved.decision_json,approved.decided_at,
      publisher.publisher_name,publisher.publisher_memberships
    from approved
    join lateral (
      select min(organization.name) as publisher_name,
        count(distinct membership.organization_id)::integer as publisher_memberships
      from auth_members membership
      join auth_organizations organization on organization.id=membership.organization_id
      join fuma_organization_profiles profile on profile.organization_id=membership.organization_id
        and profile.kind='customer' and profile.status='active'
      where membership.user_id=approved.submitter_id and membership.role in ('owner','admin')
    ) publisher on publisher.publisher_memberships=1
    where approved.release_rank=1
      and not exists (select 1 from fuma_artifact_review_revocations_v2 revocation
        where revocation.decision_id=approved.decision_id)
      and not exists (
        select 1 from lateral (
          select moderation.event from fuma_moderation_evidence_v2 moderation
          where moderation.subject_kind='plugin' and moderation.subject_id=approved.package_id
          order by moderation.created_at desc,moderation.evidence_id desc limit 1
        ) latest_moderation where latest_moderation.event='suspended'
      )
    order by approved.artifact_kind,approved.package_id
  `
  return Object.freeze(result.rows.map(publicArtifact))
}

function facets(items: readonly (PublicPlugin | PublicComponent)[]) {
  return Object.freeze({ categories: sortedUnique(items.flatMap((item) => [...item.categories]), 24) })
}

export class ApprovedReviewedArtifactsProjectionSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  readonly #resource: 'plugins' | 'components'
  readonly #kind: 'plugin' | 'component-pack'

  constructor(db: DbClient, resource: 'plugins' | 'components') {
    this.#db = db
    this.#resource = resource
    this.#kind = resource === 'plugins' ? 'plugin' : 'component-pack'
  }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const allItems = (await readCurrentReviewedArtifacts(this.#db))
      .filter((item) => item.artifactKind === this.#kind)
    const filteredItems = allItems.filter((item) => (
      (query.category === undefined || item.categories.includes(String(query.category)))
      && (query.slug === undefined || item.slug === query.slug)
      && boundedSearchMatch(query.query, [item.name, item.summary, item.publisherName, ...item.categories, ...item.permissionLabels])
    ))
    return paginatePublicDiscovery({
      resource: this.#resource as PublicProjectionResource,
      allItems,
      filteredItems,
      facets: facets(allItems),
      query,
    })
  }
}
