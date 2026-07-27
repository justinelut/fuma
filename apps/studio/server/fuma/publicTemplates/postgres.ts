import type { DbClient } from '../../db/client'
import { sha256Hex, type TenantObjectStorage } from '../objectStorage'
import { assertReleaseManifest, type ReleaseArtifact, type ReleaseManifest } from '../releases'
import {
  ApprovableTemplateReleaseSchema,
  StoredPublicTemplateReleaseSchema,
  TemplateCatalogError,
  strictTemplateValue,
  type ApprovableTemplateRelease,
  type StoredPublicTemplateRelease,
  type TemplateReleaseAuthority as TemplateReleaseCoordinates,
} from './contracts'
import type { PublicTemplateCatalogRepository, TemplateReleaseInspector } from './service'

interface TemplateRow {
  template_id: string
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  release_id: string
  public_json: unknown
  manifest_hash: string
  state: string
  version: string | number | bigint
  withdrawn_at: string | Date | null
}

interface ReleaseRow {
  organization_id: string
  workspace_id: string
  site_id: string
  release_id: string
  status: string
  manifest_hash: string | null
  manifest_json: unknown
  retained: boolean
}

function positiveVersion(value: string | number | bigint): number {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new TemplateCatalogError('invalid-contract', 'Stored template version is invalid.')
  return numeric
}

function timestamp(value: string | Date | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TemplateCatalogError('invalid-contract', 'Stored template timestamp is invalid.')
  return date.toISOString()
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { throw new TemplateCatalogError('invalid-contract', 'Stored template JSON is invalid.') }
}

function stored(row: TemplateRow): StoredPublicTemplateRelease {
  return Object.freeze(strictTemplateValue(StoredPublicTemplateReleaseSchema, {
    template: decoded(row.public_json),
    releaseAuthority: {
      platformId: row.platform_id,
      ownerKey: row.owner_key,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      releaseId: row.release_id,
    },
    manifestHashSha256: row.manifest_hash,
    state: row.state,
    version: positiveVersion(row.version),
    withdrawnAt: timestamp(row.withdrawn_at),
  }, 'Stored public template'))
}

function manifest(row: ReleaseRow): ReleaseManifest {
  const value = decoded(row.manifest_json)
  try {
    assertReleaseManifest(value)
    return value
  } catch {
    throw new TemplateCatalogError('release-unavailable', 'Stored template release manifest failed validation.')
  }
}

export class PostgresPublicTemplateCatalogRepository implements PublicTemplateCatalogRepository {
  private readonly db: DbClient
  constructor(db: DbClient) {
    this.db = db
    if (db.dialect !== 'postgres') throw new TemplateCatalogError('release-unavailable', 'Public template authority requires PostgreSQL.')
  }

  async list(): Promise<readonly StoredPublicTemplateRelease[]> {
    const { rows } = await this.db<TemplateRow>`
      select template_id, platform_id, owner_key, organization_id, workspace_id,
        site_id, release_id, public_json, manifest_hash, state, version, withdrawn_at
      from fuma_public_template_releases
      order by template_id
      limit 10000
    `
    return Object.freeze(rows.map(stored))
  }

  async get(templateId: string): Promise<StoredPublicTemplateRelease | null> {
    const { rows } = await this.db<TemplateRow>`
      select template_id, platform_id, owner_key, organization_id, workspace_id,
        site_id, release_id, public_json, manifest_hash, state, version, withdrawn_at
      from fuma_public_template_releases
      where template_id = ${templateId}
      limit 2
    `
    if (rows.length > 1) throw new TemplateCatalogError('conflict', 'Public template identity is ambiguous.')
    return rows[0] ? stored(rows[0]) : null
  }

  async save(record: StoredPublicTemplateRelease, expectedVersion: number | null): Promise<boolean> {
    strictTemplateValue(StoredPublicTemplateReleaseSchema, record, 'Stored public template')
    if (expectedVersion === null) {
      const result = await this.db`
        insert into fuma_public_template_releases (
          template_id, slug, platform_id, owner_key, organization_id, workspace_id,
          site_id, release_id, public_json, manifest_hash, state,
          version, approved_at, withdrawn_at, updated_at
        ) values (
          ${record.template.id}, ${record.template.slug},
          ${record.releaseAuthority.platformId}, ${record.releaseAuthority.ownerKey},
          ${record.releaseAuthority.organizationId}, ${record.releaseAuthority.workspaceId},
          ${record.releaseAuthority.siteId}, ${record.releaseAuthority.releaseId},
          ${JSON.stringify(record.template)}::text::jsonb, ${record.manifestHashSha256},
          ${record.state}, ${record.version}, ${record.template.approvedAt},
          ${record.withdrawnAt}, ${record.template.updatedAt}
        ) on conflict do nothing
      `
      return result.rowCount === 1
    }
    const result = await this.db`
      update fuma_public_template_releases set
        platform_id = ${record.releaseAuthority.platformId},
        owner_key = ${record.releaseAuthority.ownerKey},
        organization_id = ${record.releaseAuthority.organizationId},
        workspace_id = ${record.releaseAuthority.workspaceId},
        site_id = ${record.releaseAuthority.siteId},
        release_id = ${record.releaseAuthority.releaseId},
        public_json = ${JSON.stringify(record.template)}::text::jsonb,
        manifest_hash = ${record.manifestHashSha256},
        state = ${record.state},
        version = ${record.version},
        withdrawn_at = ${record.withdrawnAt},
        updated_at = ${record.template.updatedAt}
      where template_id = ${record.template.id}
        and slug = ${record.template.slug}
        and version = ${expectedVersion}
    `
    return result.rowCount === 1
  }
}

export class PostgresTemplateReleaseAuthority implements TemplateReleaseInspector {
  protected readonly db: DbClient
  constructor(db: DbClient) {
    this.db = db
    if (db.dialect !== 'postgres') throw new TemplateCatalogError('release-unavailable', 'Template release authority requires PostgreSQL.')
  }

  protected async row(authority: TemplateReleaseCoordinates): Promise<ReleaseRow | null> {
    const { rows } = await this.db<ReleaseRow>`
      select release.organization_id, release.workspace_id, release.site_id,
        release.release_id, release.status, release.manifest_hash, release.manifest_json,
        exists (
          select 1 from fuma_release_retention_roots root
          where root.platform_id = release.platform_id
            and root.owner_key = release.owner_key
            and root.release_id = release.release_id
        ) as retained
      from fuma_releases release
      join fuma_tenant_owner_keys owner
        on owner.platform_id = release.platform_id
       and owner.owner_key = release.owner_key
       and owner.organization_id = release.organization_id
       and owner.workspace_id = release.workspace_id
       and owner.site_id = release.site_id
      where release.platform_id = ${authority.platformId}
        and release.owner_key = ${authority.ownerKey}
        and release.organization_id = ${authority.organizationId}
        and release.workspace_id = ${authority.workspaceId}
        and release.site_id = ${authority.siteId}
        and release.release_id = ${authority.releaseId}
        and release.status in ('ready', 'active')
        and release.manifest_json is not null
        and release.manifest_hash is not null
        and owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
      limit 2
    `
    if (rows.length > 1) throw new TemplateCatalogError('release-unavailable', 'Template release identity is ambiguous.')
    return rows[0] ?? null
  }

  async inspect(authority: TemplateReleaseCoordinates): Promise<ApprovableTemplateRelease | null> {
    const row = await this.row(authority)
    if (!row || !row.retained || row.manifest_hash === null) return null
    const releaseManifest = manifest(row)
    return strictTemplateValue(ApprovableTemplateReleaseSchema, {
      releaseId: row.release_id,
      manifestHashSha256: row.manifest_hash,
      status: row.status,
      retained: true,
      artifacts: releaseManifest.artifacts.map((artifact) => ({
        logicalPath: artifact.logicalPath,
        contentHashSha256: artifact.contentHashSha256,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
      })),
    }, 'Approvable template release')
  }
}

export type TemplatePreviewArtifact = Readonly<{
  bytes: Uint8Array
  hashSha256: string
  mimeType: string
}>

function artifactFor(releaseManifest: ReleaseManifest, path: string): ReleaseArtifact | null {
  const candidates = path === '/'
    ? ['/index.html']
    : path.endsWith('/')
      ? [`${path}index.html`]
      : path.includes('.') ? [path] : [path, `${path}.html`]
  return releaseManifest.artifacts.find((artifact) => candidates.includes(artifact.logicalPath)) ?? null
}

export class PostgresTemplatePreviewReader extends PostgresTemplateReleaseAuthority {
  private readonly storage: TenantObjectStorage
  constructor(db: DbClient, storage: TenantObjectStorage) {
    super(db)
    this.storage = storage
  }

  async readExact(authority: TemplateReleaseCoordinates, path: string): Promise<TemplatePreviewArtifact | null> {
    const row = await this.row(authority)
    if (!row || !row.retained) return null
    const artifact = artifactFor(manifest(row), path)
    if (!artifact) return null
    const bytes = await this.storage.get({
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
    }, artifact.objectKey)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) {
      throw new TemplateCatalogError('release-stale', 'Immutable template preview artifact failed integrity verification.')
    }
    return Object.freeze({ bytes: bytes.slice(), hashSha256: artifact.contentHashSha256, mimeType: artifact.mimeType })
  }
}
