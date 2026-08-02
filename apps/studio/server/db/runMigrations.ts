import type { DbClient } from './client'

export interface Migration {
  id: string
  sql: string
}

/** Apply pending canonical PostgreSQL migrations transactionally. */
export async function runMigrations(db: DbClient, migrations: Migration[]): Promise<void> {
  await db.unsafe(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null default current_timestamp
    )
  `)

  for (const migration of migrations) {
    const { rows } = await db<{ id: string }>`
      select id from schema_migrations where id = ${migration.id}
    `
    if (rows.length > 0) continue

    await db.transaction(async (tx) => {
      await tx.unsafe(migration.sql)
      await tx`insert into schema_migrations (id) values (${migration.id})`
    })
  }
}
