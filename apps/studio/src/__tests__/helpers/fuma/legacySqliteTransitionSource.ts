import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbClient } from '../../../../server/db/client'
import { createSqliteClient } from '../../../../server/db/sqlite'
import { sqliteMigrations } from '../../../../server/db/migrations-sqlite'
import { runMigrations } from '../../../../server/db/runMigrations'
import { fumaFixtureId } from './fixtures'

export const LEGACY_SQLITE_TRANSITION_SOURCE_KIND = 'legacy-sqlite-transition-source' as const
const LEGACY_TIMESTAMP = '2025-06-15T09:30:00.000Z'
const legacyTransitionBrand: unique symbol = Symbol('legacyTransitionSource')

export type LegacySqliteTransitionStableIds = Readonly<{
  siteId: string
  ownerUserId: string
  pageRowId: string
  postRowId: string
  postVersionId: string
}>

export type LegacySqliteTransitionSource = Readonly<{
  kind: typeof LEGACY_SQLITE_TRANSITION_SOURCE_KIND
  dialect: 'sqlite'
  db: DbClient
  stableIds: LegacySqliteTransitionStableIds
  legacyPassword: string
  cleanup: () => Promise<void>
  readonly [legacyTransitionBrand]: true
}>

/**
 * The only acceptance boundary for this branded SQLite value. It is transition
 * input for future import tests, never a hosted database fixture.
 */
export function acceptLegacySqliteTransitionSource(
  source: LegacySqliteTransitionSource,
): LegacySqliteTransitionSource {
  if (source.kind !== LEGACY_SQLITE_TRANSITION_SOURCE_KIND || source.db.dialect !== 'sqlite') {
    throw new Error('Legacy transition source must use the inherited SQLite stream')
  }
  return source
}

export async function createLegacySqliteTransitionSource(
  seed: string,
): Promise<LegacySqliteTransitionSource> {
  const stableIds: LegacySqliteTransitionStableIds = {
    siteId: 'default',
    ownerUserId: fumaFixtureId(seed, 'legacy-user', 'owner'),
    pageRowId: fumaFixtureId(seed, 'legacy-row', 'home-page'),
    postRowId: fumaFixtureId(seed, 'legacy-row', 'launch-post'),
    postVersionId: fumaFixtureId(seed, 'legacy-version', 'launch-post-v1'),
  }

  const directory = await mkdtemp(join(tmpdir(), 'fuma-legacy-transition-'))
  const databasePath = join(directory, 'legacy-instatic.db')
  let cleaned = false

  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    await rm(directory, { recursive: true, force: true })
    cleaned = true
  }

  try {
    const legacyPassword = 'Fuma-legacy-existing-password-123!'
    const legacyPasswordHash = await Bun.password.hash(legacyPassword, { algorithm: 'argon2id' })
    const db = createSqliteClient(databasePath)
    await runMigrations(db, sqliteMigrations)
    await db.transaction(async (tx) => {
      await tx`
        insert into users
          (id, email, email_normalized, display_name, password_hash, role_id, created_at, updated_at)
        values
          (${stableIds.ownerUserId}, ${'legacy.owner@fixture.invalid'}, ${'legacy.owner@fixture.invalid'},
           ${'Legacy Owner'}, ${legacyPasswordHash}, ${'owner'},
           ${LEGACY_TIMESTAMP}, ${LEGACY_TIMESTAMP})
      `
      await tx`
        insert into site (id, name, settings_json, created_at, updated_at)
        values (
          ${stableIds.siteId},
          ${'Legacy Transition Publication'},
          ${{ shortcuts: {}, homepageSlug: 'home' }},
          ${LEGACY_TIMESTAMP},
          ${LEGACY_TIMESTAMP}
        )
      `
      await tx`
        insert into data_rows
          (id, table_id, cells_json, slug, status, author_user_id, created_by_user_id,
           updated_by_user_id, published_by_user_id, created_at, updated_at, published_at)
        values (
          ${stableIds.pageRowId},
          ${'pages'},
          ${{
            title: 'Home',
            slug: 'home',
            body: {
              rootNodeId: 'legacy-root',
              nodes: {
                'legacy-root': {
                  id: 'legacy-root',
                  moduleId: 'base.container',
                  props: {},
                  childIds: [],
                },
              },
            },
            templateEnabled: false,
          }},
          ${'home'}, ${'published'}, ${stableIds.ownerUserId}, ${stableIds.ownerUserId},
          ${stableIds.ownerUserId}, ${stableIds.ownerUserId}, ${LEGACY_TIMESTAMP},
          ${LEGACY_TIMESTAMP}, ${LEGACY_TIMESTAMP}
        )
      `
      await tx`
        insert into data_rows
          (id, table_id, cells_json, slug, status, author_user_id, created_by_user_id,
           updated_by_user_id, published_by_user_id, created_at, updated_at, published_at)
        values (
          ${stableIds.postRowId},
          ${'posts'},
          ${{
            title: 'A seeded legacy publication post',
            slug: 'seeded-legacy-post',
            body: 'This row represents durable self-hosted SQLite content.',
            seoTitle: 'Seeded legacy post',
          }},
          ${'seeded-legacy-post'}, ${'published'}, ${stableIds.ownerUserId}, ${stableIds.ownerUserId},
          ${stableIds.ownerUserId}, ${stableIds.ownerUserId}, ${LEGACY_TIMESTAMP},
          ${LEGACY_TIMESTAMP}, ${LEGACY_TIMESTAMP}
        )
      `
      await tx`
        insert into data_row_versions
          (id, row_id, version_number, cells_json, slug, published_by_user_id, published_at, created_at)
        values (
          ${stableIds.postVersionId}, ${stableIds.postRowId}, ${1},
          ${{
            title: 'A seeded legacy publication post',
            slug: 'seeded-legacy-post',
            body: 'This row represents durable self-hosted SQLite content.',
            seoTitle: 'Seeded legacy post',
          }},
          ${'seeded-legacy-post'}, ${stableIds.ownerUserId}, ${LEGACY_TIMESTAMP}, ${LEGACY_TIMESTAMP}
        )
      `
      await tx`
        update data_rows set active_version_id = ${stableIds.postVersionId}
        where id = ${stableIds.postRowId}
      `
    })

    return {
      kind: LEGACY_SQLITE_TRANSITION_SOURCE_KIND,
      dialect: 'sqlite',
      db,
      stableIds,
      legacyPassword,
      cleanup,
      [legacyTransitionBrand]: true,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}
