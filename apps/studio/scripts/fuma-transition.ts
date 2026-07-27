#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LegacyTransitionArtifactSchema, validateLegacyTransitionArtifact } from '../server/fuma/transition/artifact'
import { exportLegacySqlite, summarizeLegacyExport } from '../server/fuma/transition/exportLegacySqlite'
import { importLegacySqliteToPostgres, planLegacyImport } from '../server/fuma/transition/importLegacyPostgres'
import { runHostedMigrations } from '../server/fuma/db/hostedMigrationRunner'
import { createDbClient, parseSqlitePath } from '../server/db'
import { createSqliteClient } from '../server/db/sqlite'
import { safeParseJson } from '@core/utils/jsonValidate'

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

const sourcePath = flagValue('source')
const importPath = flagValue('import')
const exportPath = flagValue('export')
const targetUrl = flagValue('target') ?? process.env.DATABASE_URL
const dryRun = process.argv.includes('--dry-run')

if (!sourcePath && !importPath) {
  throw new Error('Provide --source=<legacy.db> or --import=<artifact.json>.')
}

const artifact = sourcePath
  ? await exportLegacySqlite(createSqliteClient(parseSqlitePath(sourcePath)))
  : await (async () => {
    const text = await Bun.file(resolve(importPath!)).text()
    const parsed = safeParseJson(text, LegacyTransitionArtifactSchema)
    if (!parsed.ok) throw new Error('Transition artifact JSON failed TypeBox validation.')
    return validateLegacyTransitionArtifact(parsed.value)
  })()

if (exportPath) {
  await writeFile(resolve(exportPath), `${JSON.stringify(artifact)}\n`, { mode: 0o600 })
}

if (!targetUrl) {
  process.stdout.write(`${JSON.stringify({ mode: 'export', ...summarizeLegacyExport(artifact) })}\n`)
} else {
  const target = createDbClient(targetUrl)
  if (target.db.dialect !== 'postgres') throw new Error('Fuma transition target must be PostgreSQL.')
  await (dryRun
    ? runHostedMigrations(target.db, { dryRun: true })
    : (async () => {
        await (await import('../server/db/runMigrations')).runMigrations(target.db, target.migrations)
        await runHostedMigrations(target.db)
      })())
  const result = dryRun ? planLegacyImport(artifact) : await importLegacySqliteToPostgres(target.db, artifact)
  process.stdout.write(`${JSON.stringify({ mode: dryRun ? 'dry-run' : 'import', ...result })}\n`)
}
