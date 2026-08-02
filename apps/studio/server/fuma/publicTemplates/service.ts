import { FUMA_DEFAULT_DEPLOYMENT_PROFILE } from '@fuma/brand'
import type { PublicProfile, PublicTemplate, PublicTemplateTombstone } from '@fuma/public-contracts'
import {
  ApprovableTemplateReleaseSchema,
  ApproveTemplateCommandSchema,
  StoredPublicTemplateReleaseSchema,
  TemplateCatalogError,
  TemplateInstallResolutionSchema,
  WithdrawTemplateCommandSchema,
  frozenTemplate,
  strictTemplateValue,
  templateTombstone,
  type ApprovableTemplateRelease,
  type ApproveTemplateCommand,
  type StoredPublicTemplateRelease,
  type TemplateInstallResolution,
  type TemplateReleaseAuthority as TemplateReleaseCoordinates,
  type WithdrawTemplateCommand,
} from './contracts'

export const TEMPLATE_PREVIEW_HOST = FUMA_DEFAULT_DEPLOYMENT_PROFILE.hosts.templatePreview
export const TEMPLATE_IMAGE_BYTE_BUDGET = 300_000 as const
const ALLOWED_IMAGE_MIME = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp'])

export type TemplateDiscoveryFilter = Readonly<{
  profile?: PublicProfile
  capability?: string
  industry?: string
  style?: string
  slug?: string
}>

export interface PublicTemplateCatalogRepository {
  list(): Promise<readonly StoredPublicTemplateRelease[]>
  get(templateId: string): Promise<StoredPublicTemplateRelease | null>
  save(record: StoredPublicTemplateRelease, expectedVersion: number | null): Promise<boolean>
}

export interface TemplateReleaseInspector {
  inspect(authority: TemplateReleaseCoordinates): Promise<ApprovableTemplateRelease | null>
}

export type TemplateDiscovery = Readonly<{
  items: readonly PublicTemplate[]
  tombstones: readonly PublicTemplateTombstone[]
}>

function canonicalTimestamp(value: string, label: string): void {
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TemplateCatalogError('invalid-contract', `${label} must be canonical UTC.`)
  }
}

function previewRoot(previewHost: string, releaseId: string): string {
  return `https://${previewHost}/releases/${releaseId}/`
}

function previewAsset(previewHost: string, releaseId: string, path: string): string {
  return new URL(path.slice(1), previewRoot(previewHost, releaseId)).toString()
}

function artifactAt(release: ApprovableTemplateRelease, logicalPath: string) {
  return release.artifacts.find((artifact) => artifact.logicalPath === logicalPath) ?? null
}

function assertApprovableRelease(command: ApproveTemplateCommand, release: ApprovableTemplateRelease, previewHost: string): void {
  if (release.releaseId !== command.releaseAuthority.releaseId || release.manifestHashSha256 !== command.expectedManifestHashSha256) {
    throw new TemplateCatalogError('release-stale', 'The exact immutable release changed before approval.')
  }
  const index = artifactAt(release, '/index.html')
  if (!index || index.mimeType !== 'text/html') {
    throw new TemplateCatalogError('release-unavailable', 'The template release has no HTML preview root.')
  }
  const image = artifactAt(release, command.metadata.image.logicalPath)
  if (!image || !ALLOWED_IMAGE_MIME.has(image.mimeType) || image.sizeBytes !== command.metadata.image.byteSize) {
    throw new TemplateCatalogError('release-unavailable', 'The template discovery image is missing or does not match its immutable artifact.')
  }
  if (image.sizeBytes > TEMPLATE_IMAGE_BYTE_BUDGET) {
    throw new TemplateCatalogError('invalid-contract', 'The template discovery image exceeds its byte budget.')
  }
  const expectedImageUrl = previewAsset(previewHost, release.releaseId, image.logicalPath)
  if (command.metadata.image.url !== expectedImageUrl) {
    throw new TemplateCatalogError('invalid-contract', 'The template image URL must target the exact isolated release artifact.')
  }
}

function matches(item: PublicTemplate, filter: TemplateDiscoveryFilter): boolean {
  return (filter.profile === undefined || item.profiles.includes(filter.profile))
    && (filter.capability === undefined || item.capabilities.includes(filter.capability))
    && (filter.industry === undefined || item.industries.includes(filter.industry))
    && (filter.style === undefined || item.styles.includes(filter.style))
    && (filter.slug === undefined || item.slug === filter.slug)
}

async function currentApprovedRecords(
  records: readonly StoredPublicTemplateRelease[],
  releases: TemplateReleaseInspector,
): Promise<readonly StoredPublicTemplateRelease[]> {
  const decisions = await Promise.all(records.map(async (record) => {
    if (record.state !== 'approved' || record.withdrawnAt !== null) return null
    const release = await releases.inspect(record.releaseAuthority)
    return release?.retained === true
      && release.releaseId === record.template.releaseId
      && release.manifestHashSha256 === record.manifestHashSha256
      ? record
      : null
  }))
  return decisions.filter((record): record is StoredPublicTemplateRelease => record !== null)
}

export class PublicTemplateCatalogService {
  private readonly repository: PublicTemplateCatalogRepository
  private readonly releases: TemplateReleaseInspector
  private readonly previewHost: string

  constructor(
    repository: PublicTemplateCatalogRepository,
    releases: TemplateReleaseInspector,
    previewHost: string = TEMPLATE_PREVIEW_HOST,
  ) {
    this.repository = repository
    this.releases = releases
    this.previewHost = previewHost
  }

  async approve(input: ApproveTemplateCommand): Promise<StoredPublicTemplateRelease> {
    const command = strictTemplateValue(ApproveTemplateCommandSchema, input, 'Template approval')
    canonicalTimestamp(command.approvedAt, 'approvedAt')
    const releaseValue = await this.releases.inspect(command.releaseAuthority)
    if (!releaseValue) throw new TemplateCatalogError('release-unavailable', 'The exact immutable release is unavailable.')
    const release = strictTemplateValue(ApprovableTemplateReleaseSchema, releaseValue, 'Template release')
    assertApprovableRelease(command, release, this.previewHost)

    const current = await this.repository.get(command.metadata.id)
    if ((command.expectedVersion === null && current !== null)
      || (command.expectedVersion !== null && current?.version !== command.expectedVersion)) {
      throw new TemplateCatalogError('conflict', 'Template approval authority changed concurrently.')
    }
    if (current?.state === 'withdrawn') {
      throw new TemplateCatalogError('conflict', 'A withdrawn stable template ID cannot be re-approved.')
    }
    if (current && current.template.slug !== command.metadata.slug) {
      throw new TemplateCatalogError('conflict', 'A stable public template cannot change canonical slug.')
    }
    const version = (current?.version ?? 0) + 1
    const template = frozenTemplate({
      ...command.metadata,
      image: {
        url: command.metadata.image.url,
        alt: command.metadata.image.alt,
        width: command.metadata.image.width,
        height: command.metadata.image.height,
        byteSize: command.metadata.image.byteSize,
      },
      releaseId: release.releaseId,
      previewUrl: previewRoot(this.previewHost, release.releaseId),
      sitemapEligible: true,
      approvedAt: current?.template.approvedAt ?? command.approvedAt,
      updatedAt: command.approvedAt,
    })
    const record = Object.freeze(strictTemplateValue(StoredPublicTemplateReleaseSchema, {
      template,
      releaseAuthority: command.releaseAuthority,
      manifestHashSha256: release.manifestHashSha256,
      state: 'approved',
      version,
      withdrawnAt: null,
    }, 'Stored template approval'))
    if (!await this.repository.save(record, command.expectedVersion)) {
      throw new TemplateCatalogError('conflict', 'Template approval authority changed concurrently.')
    }
    return record
  }

  async withdraw(input: WithdrawTemplateCommand): Promise<StoredPublicTemplateRelease> {
    const command = strictTemplateValue(WithdrawTemplateCommandSchema, input, 'Template withdrawal')
    canonicalTimestamp(command.withdrawnAt, 'withdrawnAt')
    const current = await this.repository.get(command.templateId)
    if (!current) throw new TemplateCatalogError('not-found', 'Template approval was not found.')
    if (current.version !== command.expectedVersion || current.state !== 'approved') {
      throw new TemplateCatalogError('conflict', 'Template withdrawal authority changed concurrently.')
    }
    const record = Object.freeze(strictTemplateValue(StoredPublicTemplateReleaseSchema, {
      ...current,
      state: 'withdrawn',
      version: current.version + 1,
      withdrawnAt: command.withdrawnAt,
      template: { ...current.template, updatedAt: command.withdrawnAt },
    }, 'Stored template withdrawal'))
    if (!await this.repository.save(record, command.expectedVersion)) {
      throw new TemplateCatalogError('conflict', 'Template withdrawal authority changed concurrently.')
    }
    return record
  }

  async discover(filter: TemplateDiscoveryFilter = {}): Promise<TemplateDiscovery> {
    const records = await this.repository.list()
    const current = await currentApprovedRecords(records, this.releases)
    const approved = current
      .filter((record) => matches(record.template, filter))
      .map((record) => record.template)
      .toSorted((left, right) => left.id.localeCompare(right.id))
    const tombstones = filter.slug === undefined ? [] : records
      .filter((record) => record.state === 'withdrawn' && record.withdrawnAt !== null && record.template.slug === filter.slug)
      .map(templateTombstone)
    return Object.freeze({ items: Object.freeze(approved), tombstones: Object.freeze(tombstones) })
  }

  async versionMaterial(): Promise<TemplateDiscovery> {
    const records = await this.repository.list()
    const current = await currentApprovedRecords(records, this.releases)
    return Object.freeze({
      items: Object.freeze(current
        .map((record) => record.template)
        .toSorted((left, right) => left.id.localeCompare(right.id))),
      tombstones: Object.freeze(records
        .filter((record) => record.state === 'withdrawn' && record.withdrawnAt !== null)
        .map(templateTombstone)
        .toSorted((left, right) => left.id.localeCompare(right.id))),
    })
  }

  async projectionSnapshot(filter: TemplateDiscoveryFilter = {}): Promise<Readonly<{
    material: TemplateDiscovery
    discovery: TemplateDiscovery
  }>> {
    const records = await this.repository.list()
    const current = await currentApprovedRecords(records, this.releases)
    const allTombstones = records
      .filter((record) => record.state === 'withdrawn' && record.withdrawnAt !== null)
      .map(templateTombstone)
      .toSorted((left, right) => left.id.localeCompare(right.id))
    return Object.freeze({
      material: Object.freeze({
        items: Object.freeze(current.map((record) => record.template).toSorted((left, right) => left.id.localeCompare(right.id))),
        tombstones: Object.freeze(allTombstones),
      }),
      discovery: Object.freeze({
        items: Object.freeze(current.filter((record) => matches(record.template, filter)).map((record) => record.template).toSorted((left, right) => left.id.localeCompare(right.id))),
        tombstones: Object.freeze(filter.slug === undefined ? [] : allTombstones.filter((record) => record.slug === filter.slug)),
      }),
    })
  }

  async authorizePreview(releaseId: string): Promise<StoredPublicTemplateRelease> {
    const records = await this.repository.list()
    const record = records.find((candidate) => candidate.template.releaseId === releaseId && candidate.state === 'approved' && candidate.withdrawnAt === null)
    if (!record) throw new TemplateCatalogError('withdrawn', 'Template preview is unavailable.')
    const release = await this.releases.inspect(record.releaseAuthority)
    if (!release || release.manifestHashSha256 !== record.manifestHashSha256 || !release.retained) {
      throw new TemplateCatalogError('release-stale', 'Template preview release authority is stale.')
    }
    return record
  }

  /** Product-only revalidation. The result is coordinates, never copied artifact bytes. */
  async resolveInstallIntent(templateId: string): Promise<TemplateInstallResolution> {
    const record = await this.repository.get(templateId)
    if (!record || record.state !== 'approved' || record.withdrawnAt !== null) {
      throw new TemplateCatalogError('withdrawn', 'Template is no longer approved for installation.')
    }
    const release = await this.releases.inspect(record.releaseAuthority)
    if (!release || !release.retained || release.manifestHashSha256 !== record.manifestHashSha256) {
      throw new TemplateCatalogError('release-stale', 'Approved template release is no longer authoritative.')
    }
    return Object.freeze(strictTemplateValue(TemplateInstallResolutionSchema, {
      templateId: record.template.id,
      releaseAuthority: record.releaseAuthority,
      manifestHashSha256: record.manifestHashSha256,
      profiles: record.template.profiles,
      authorityVersion: record.version,
    }, 'Template install resolution'))
  }
}
