import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const command = process.argv[2]
if (command !== 'backup' && command !== 'restore-verify') throw new Error('Expected backup or restore-verify command.')

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function run(args: readonly string[], env: Record<string, string | undefined> = {}): Promise<void> {
  const processHandle = Bun.spawn(args, { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } })
  const status = await processHandle.exited
  if (status !== 0) throw new Error(`${args[0]} failed with exit ${status}.`)
}

async function files(path: string): Promise<string[]> {
  const names = await readdir(path)
  return (await Promise.all(names.map(async (name) => {
    const child = join(path, name)
    return (await stat(child)).isDirectory() ? files(child) : [child]
  }))).flat()
}

async function digest(path: string): Promise<string> { return new Bun.CryptoHasher('sha256').update(await readFile(path)).digest('hex') }

async function backup(): Promise<void> {
  const databaseUrl = required('DATABASE_URL')
  const ageRecipient = required('FUMA_BACKUP_AGE_RECIPIENT')
  required('MC_HOST_minio')
  required('MC_HOST_config')
  required('MC_HOST_backup')
  const releaseSha = required('FUMA_RELEASE_SOURCE_SHA')
  const work = `/tmp/fuma-backup-${crypto.randomUUID()}`
  await mkdir(join(work, 'objects'), { recursive: true })
  await mkdir(join(work, 'config'), { recursive: true })
  await run(['pg_dump', '--dbname', databaseUrl, '--format=custom', '--no-owner', '--no-privileges', '--file', join(work, 'postgres.dump')])
  await run(['mc', 'mirror', '--json', '--preserve', 'minio/fuma', join(work, 'objects')])
  await run(['mc', 'mirror', '--json', '--preserve', required('FUMA_CONFIG_SOURCE'), join(work, 'config')])
  const inventory = await Promise.all((await files(work)).sort().map(async (path) => ({ path: relative(work, path), bytes: (await stat(path)).size, sha256: await digest(path) })))
  const manifest = { schemaVersion: 1, releaseSha, createdAt: new Date().toISOString(), inventory, encryption: 'age-x25519', source: 'fuma-production', retentionClass: required('FUMA_BACKUP_RETENTION_CLASS') }
  await writeFile(join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  await run(['tar', '--create', '--file', join(work, 'backup.tar'), '--directory', work, 'postgres.dump', 'objects', 'config', 'manifest.json'])
  const encrypted = join(work, `${manifest.createdAt.replaceAll(':', '-')}-${releaseSha}.tar.age`)
  await run(['age', '--recipient', ageRecipient, '--output', encrypted, join(work, 'backup.tar')])
  await run(['mc', 'cp', '--json', encrypted, `backup/${required('FUMA_BACKUP_BUCKET')}/${encrypted.split('/').pop()}`])
  console.log(JSON.stringify({ operation: 'backup', state: 'completed', releaseSha, manifestSha256: await digest(join(work, 'manifest.json')) }))
}

async function restoreVerify(): Promise<void> {
  if (process.env.FUMA_EPHEMERAL_RESTORE !== 'true' || !required('FUMA_RESTORE_NAMESPACE').endsWith('-restore-verification')) throw new Error('Restore is permitted only in an explicitly ephemeral restore-verification namespace.')
  const databaseUrl = required('DATABASE_URL')
  if (!databaseUrl.includes('restore-verification')) throw new Error('Restore DATABASE_URL does not identify the verification environment.')
  required('MC_HOST_restore')
  required('MC_HOST_backup')
  const work = `/tmp/fuma-restore-${crypto.randomUUID()}`
  await mkdir(work, { recursive: true })
  const encrypted = join(work, 'backup.tar.age')
  await run(['mc', 'cp', '--json', required('FUMA_BACKUP_OBJECT'), encrypted])
  await run(['age', '--decrypt', '--identity', required('FUMA_BACKUP_AGE_IDENTITY_FILE'), '--output', join(work, 'backup.tar'), encrypted])
  await run(['tar', '--extract', '--file', join(work, 'backup.tar'), '--directory', work])
  await run(['pg_restore', '--dbname', databaseUrl, '--no-owner', '--no-privileges', '--exit-on-error', join(work, 'postgres.dump')])
  await run(['mc', 'mirror', '--json', '--preserve', join(work, 'objects'), `restore/${required('FUMA_RESTORE_BUCKET')}/objects`])
  await run(['mc', 'mirror', '--json', '--preserve', join(work, 'config'), `restore/${required('FUMA_RESTORE_BUCKET')}/config`])
  const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')) as { releaseSha: string; inventory: readonly { path: string; bytes: number; sha256: string }[] }
  const restored = await Promise.all((await files(work)).filter((path) => !path.endsWith('.age') && !path.endsWith('backup.tar')).sort().map(async (path) => ({ path: relative(work, path), bytes: (await stat(path)).size, sha256: await digest(path) })))
  const expected = manifest.inventory.filter(({ path }) => path !== 'manifest.json')
  const actual = restored.filter(({ path }) => path !== 'manifest.json')
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Restored file inventory differs from the signed backup manifest.')
  console.log(JSON.stringify({ operation: 'restore-verify', state: 'restored', releaseSha: manifest.releaseSha, inventoryHashSha256: new Bun.CryptoHasher('sha256').update(JSON.stringify(actual)).digest('hex') }))
}

await (command === 'backup' ? backup() : restoreVerify())
