import { describe, expect, it } from 'bun:test'
import { pgMigrations } from '../../../server/db/migrations-pg'
import { SYSTEM_ROLES } from '../../../server/auth/capabilities'

const sql = pgMigrations.map((migration) => migration.sql).join('\n')

describe('CMS PostgreSQL migrations', () => {
  it('creates the required unified CMS tables', () => {
    for (const table of [
      'site', 'users', 'roles', 'sessions', 'audit_events', 'data_tables',
      'data_rows', 'data_row_versions', 'media_assets', 'published_runtime_assets',
    ]) expect(sql).toContain(`create table if not exists ${table}`)
    expect(sql).not.toContain('create table if not exists pages ')
    expect(sql).not.toContain('create table if not exists page_versions')
  })

  it('uses native jsonb for content and field definitions', () => {
    expect(sql).toContain('cells_json jsonb not null')
    expect(sql).toContain('fields_json jsonb not null')
  })

  it('stores ownership metadata and expected system roles', () => {
    for (const column of [
      'created_by_user_id', 'updated_by_user_id', 'author_user_id',
      'published_by_user_id', 'uploaded_by_user_id',
    ]) expect(sql).toContain(`${column} text references users(id) on delete set null`)
    for (const role of SYSTEM_ROLES) {
      expect(sql).toContain(`'${role.slug}'`)
      for (const capability of role.capabilities) expect(sql).toContain(capability)
    }
  })

  it('keeps media ordering and removes retired single-admin names', () => {
    expect(sql).toContain('sort_order integer not null default 0')
    expect(sql).not.toContain('admin_users')
    expect(sql).not.toContain('admin_user_id')
    expect(sql).not.toContain('site_singleton')
  })
})
