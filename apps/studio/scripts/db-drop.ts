/** Development-only PostgreSQL schema and uploads reset. */
import { SQL } from 'bun'
import { readdir, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readServerConfig } from '../server/config'

function log(message: string): void { console.error(`[db:drop] ${message}`) }
function fail(message: string): never { log(message); process.exit(1) }

const skipPrompt = process.argv.slice(2).some((argument) => ['-y', '--yes', '--force'].includes(argument))
const { databaseUrl, uploadsDir } = readServerConfig()
const url = new URL(databaseUrl)
if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
  fail('DATABASE_URL must use postgres:// or postgresql://.')
}

if (!skipPrompt) {
  log('This will PERMANENTLY delete:')
  log(`  • PostgreSQL schema: ${url.hostname}/${url.pathname.slice(1)}`)
  log(`  • uploads: ${resolve(uploadsDir)}`)
  if (prompt('[db:drop] Type "y" to continue:')?.trim().toLowerCase() !== 'y') fail('Aborted — nothing was deleted.')
}

const sql = new SQL(databaseUrl)
try {
  await sql.unsafe('drop schema if exists public cascade')
  await sql.unsafe('create schema public')
  log('Dropped and recreated the PostgreSQL public schema.')
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  fail(`Could not reset PostgreSQL at ${url.hostname}: ${message}`)
} finally {
  await sql.close()
}

async function clearUploads(): Promise<void> {
  const directory = resolve(uploadsDir)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(directory, { recursive: true })
      log(`Created empty uploads directory ${directory}.`)
      return
    }
    throw error
  }
  for (const entry of entries) await rm(join(directory, entry), { recursive: true, force: true })
  log(entries.length === 0 ? `Uploads directory already empty (${directory}).` : `Cleared ${entries.length} upload entries.`)
}

await clearUploads()
log('Done. Run `bun run dev` to recreate the PostgreSQL schema from migrations.')
