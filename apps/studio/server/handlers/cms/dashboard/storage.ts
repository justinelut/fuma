/**
 * Storage widget reader — per-category byte counts (image / video /
 * document media + plugins-on-disk + PostgreSQL) plus the database label shown
 * in the widget caption.
 *
 * Media is split into three sub-categories with a single SQL pass that
 * sums conditionally per mime-type bucket. Anything that isn't
 * `image/*` or `video/*` (audio, application/*, text/*, fonts, rows
 * with NULL mime_type) lands in `documentBytes` so the three counters
 * are guaranteed to sum back to the original media total.
 *
 * PostgreSQL computes all media buckets in one pass with conditional sums.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DbClient } from '../../../db/client'
import type { CmsHandlerOptions } from '../shared'
import { coerceBytes } from './shared'
import { hostedStorageAllowanceBytes } from '../../../fuma/entitlements/storageAllowanceBridge'
import type { DashboardRequestContext, StorageStats } from './types'

export async function readStorageStats(
  db: DbClient,
  options: CmsHandlerOptions,
  ctx: DashboardRequestContext,
): Promise<StorageStats> {
  const [mediaResult, pluginBytes, databaseBytes] = await Promise.all([
    db<{
      image_bytes: number | string | null
      video_bytes: number | string | null
      document_bytes: number | string | null
    }>`
      select
        coalesce(sum(case when mime_type like 'image/%' then size_bytes else 0 end), 0) as image_bytes,
        coalesce(sum(case when mime_type like 'video/%' then size_bytes else 0 end), 0) as video_bytes,
        coalesce(sum(case when mime_type not like 'image/%' and mime_type not like 'video/%' then size_bytes
                          when mime_type is null then size_bytes
                          else 0 end), 0) as document_bytes
      from media_assets
      where deleted_at is null
    `,
    options.uploadsDir
      ? sumDirectoryBytes(join(options.uploadsDir, 'plugins'))
      : Promise.resolve(0),
    readDatabaseBytes(db),
  ])

  // Resolved through the hosted bridge, which is null by default - so a self-hosted install
  // reports no limit, which is the truth rather than a placeholder.
  const allowanceBytes = await hostedStorageAllowanceBytes(ctx.request)

  const totals = mediaResult.rows[0]
  const imageBytes = coerceBytes(totals?.image_bytes)
  const videoBytes = coerceBytes(totals?.video_bytes)
  const documentBytes = coerceBytes(totals?.document_bytes)

  return {
    // Resolved through the hosted bridge, which is null by default - so a self-hosted install
    // reports no limit, which is the truth rather than a placeholder.
    limitBytes: allowanceBytes,
    imageBytes,
    videoBytes,
    documentBytes,
    pluginBytes,
    databaseBytes,
    totalBytes: imageBytes + videoBytes + documentBytes + pluginBytes + databaseBytes,
    dialect: db.dialect,
  }
}

/**
 * Recursively sum the byte sizes of every regular file under `dir`.
 *
 * Returns `0` when the directory does not exist (e.g. a fresh install
 * with no plugins installed yet). Symlinks are resolved via the default
 * `stat` behaviour — that's fine for the plugin asset tree which is
 * always a regular directory tree the server writes itself. Any per-
 * entry error (a file vanishing between `readdir` and `stat`, a
 * permission gap) is swallowed for that entry and counted as zero; the
 * dashboard widget is a usage estimate, not a forensic audit.
 */
async function sumDirectoryBytes(dir: string): Promise<number> {
  let entries: { name: string; isDirectory: boolean; isFile: boolean }[]
  try {
    const list = await readdir(dir, { withFileTypes: true })
    entries = list.map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
    }))
  } catch (err) {
    if (isFsNotFound(err)) return 0
    console.error('[dashboard:storage] readdir failed for', dir, err)
    return 0
  }

  let total = 0
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory) {
      total += await sumDirectoryBytes(full)
    } else if (entry.isFile) {
      try {
        const s = await stat(full)
        total += s.size
      } catch (err) {
        if (!isFsNotFound(err)) {
          console.error('[dashboard:storage] stat failed for', full, err)
        }
      }
    }
  }
  return total
}

/** True for Node-style filesystem "no such file or directory" errors. */
function isFsNotFound(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT'
}

/**
 * Compute database bytes with PostgreSQL's canonical database-size function.
 * Returns zero when the database cannot be measured so the dashboard remains
 * available while reporting the failure to server logs.
 */
async function readDatabaseBytes(db: DbClient): Promise<number> {
  try {
    const { rows } = await db<{ size: number | string | null }>`
      select pg_database_size(current_database()) as size
    `
    return coerceBytes(rows[0]?.size)
  } catch (error) {
    console.error('[dashboard:storage] pg_database_size failed:', error)
    return 0
  }
}
