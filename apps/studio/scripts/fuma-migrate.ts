#!/usr/bin/env bun
import { createPostgresClient } from '../server/db/postgres'
import { pgMigrations } from '../server/db/migrations-pg'
import { runMigrations } from '../server/db/runMigrations'
import { hostedMigrations } from '../server/fuma/db/migrations'
import { nextHostedMigrationId } from '../server/fuma/db/migrationPolicy'
import { runHostedMigrations } from '../server/fuma/db/hostedMigrationRunner'

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

const nextDescription = flagValue('next')
if (nextDescription) {
  process.stdout.write(`${nextHostedMigrationId(hostedMigrations, nextDescription)}\n`)
} else {
  const databaseUrl = flagValue('database-url') ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL or --database-url is required.')
  const db = createPostgresClient(databaseUrl)
  const dryRun = process.argv.includes('--dry-run')
  try {
    if (!dryRun) await runMigrations(db, pgMigrations)
    const report = await runHostedMigrations(db, { dryRun })
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } finally {
    await db.close?.()
  }
}
