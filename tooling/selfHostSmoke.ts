import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const DialectSchema = Type.Union([Type.Literal('sqlite'), Type.Literal('postgres')])
type Dialect = Static<typeof DialectSchema>

const CliOptionsSchema = Type.Object({
  dryRun: Type.Boolean(),
  image: Type.String({ minLength: 1 }),
  replacementImage: Type.String({ minLength: 1 }),
  releaseBundle: Type.String({ minLength: 1 }),
  runId: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,31}$' }),
  timeoutMs: Type.Integer({ minimum: 1_000, maximum: 300_000 }),
}, { additionalProperties: false })
export type SelfHostSmokeOptions = Static<typeof CliOptionsSchema>

const PlanStepSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  dialect: Type.Optional(DialectSchema),
  command: Type.Array(Type.String(), { minItems: 1 }),
  environment: Type.Optional(Type.Record(Type.String(), Type.String())),
}, { additionalProperties: false })

export const SelfHostSmokePlanSchema = Type.Object({
  version: Type.Literal(1),
  projectPrefix: Type.String({ minLength: 1 }),
  resources: Type.Array(Type.String({ minLength: 1 })),
  steps: Type.Array(PlanStepSchema, { minItems: 1 }),
  checks: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}, { additionalProperties: false })
export type SelfHostSmokePlan = Static<typeof SelfHostSmokePlanSchema>
type PlanStep = Static<typeof PlanStepSchema>

const HealthSchema = Type.Object({
  status: Type.Literal('ok'),
  ts: Type.Number(),
}, { additionalProperties: false })

const ImageInspectSchema = Type.Array(Type.Object({
  Config: Type.Object({
    Cmd: Type.Array(Type.String()),
    Env: Type.Array(Type.String()),
    WorkingDir: Type.String(),
  }),
}), { minItems: 1, maxItems: 1 })

const PersistenceStateSchema = Type.Object({
  dialect: DialectSchema,
  migrationIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  databaseMarker: Type.Union([Type.Literal('fuma-web-003-persistent-marker'), Type.Null()]),
  uploadMarker: Type.Union([Type.Literal('fuma-web-003-upload-marker'), Type.Null()]),
  publishedMarker: Type.Union([Type.Literal('fuma-web-003-published-marker'), Type.Null()]),
}, { additionalProperties: false })
type PersistenceState = Static<typeof PersistenceStateSchema>

const BundleEntriesSchema = Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
const DockerResourceIdsSchema = Type.Array(Type.String({ minLength: 1 }))
const PortOutputSchema = Type.String({ pattern: '^(127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::\\]):[0-9]+$' })
const PortSchema = Type.Integer({ minimum: 1, maximum: 65_535 })

const DIALECTS: readonly Dialect[] = ['sqlite', 'postgres']
const DEFAULT_IMAGE = 'instatic:fuma-web-003'
const SMOKE_PASSWORD = 'fuma-web-003-disposable-only'
const BUNDLE_ROOT = '<temporary-release-bundle-root>'
const OVERRIDE_PATH = '<temporary-smoke-override.yml>'

const REQUIRED_BUNDLE_PATHS = [
  'Caddyfile',
  'INSTALL.md',
  'compose.prod.yml',
  'compose.sqlite.yml',
  'docs/deployment/README.md',
  'docs/deployment/docker-image.md',
] as const

const PERSISTENCE_PROBE = String.raw`
const { mkdir } = await import('node:fs/promises')
const { createDbClient } = await import('./server/db/index.ts')
const { db } = createDbClient(process.env.DATABASE_URL)
const seed = process.env.FUMA_WEB_003_SEED === 'true'
await db.unsafe('create table if not exists fuma_web_003_smoke (id text primary key, marker text not null)')
let markerRows = await db.unsafe("select marker from fuma_web_003_smoke where id = 'persistent'")
if (seed && markerRows.rows.length === 0) {
  await db.unsafe("insert into fuma_web_003_smoke (id, marker) values ('persistent', 'fuma-web-003-persistent-marker')")
  markerRows = await db.unsafe("select marker from fuma_web_003_smoke where id = 'persistent'")
  await mkdir('/app/uploads/fuma-web-003', { recursive: true })
  await mkdir('/app/uploads/published/fuma-web-003', { recursive: true })
  await Bun.write('/app/uploads/fuma-web-003/proof.txt', 'fuma-web-003-upload-marker')
  await Bun.write('/app/uploads/published/fuma-web-003/proof.txt', 'fuma-web-003-published-marker')
}
const migrations = await db.unsafe('select id from schema_migrations order by id')
const upload = Bun.file('/app/uploads/fuma-web-003/proof.txt')
const published = Bun.file('/app/uploads/published/fuma-web-003/proof.txt')
console.log(JSON.stringify({
  dialect: db.dialect,
  migrationIds: migrations.rows.map((row) => row.id),
  databaseMarker: markerRows.rows[0]?.marker ?? null,
  uploadMarker: await upload.exists() ? await upload.text() : null,
  publishedMarker: await published.exists() ? await published.text() : null,
}))
process.exit(0)
`

function optionValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

export function parseSelfHostSmokeArgs(args: readonly string[]): SelfHostSmokeOptions {
  const values: Record<string, unknown> = {
    dryRun: false,
    image: DEFAULT_IMAGE,
    replacementImage: DEFAULT_IMAGE,
    releaseBundle: '<release-bundle.tar.gz>',
    runId: `run-${crypto.randomUUID().slice(0, 8)}`,
    timeoutMs: 90_000,
  }
  let replacementExplicit = false

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--dry-run') {
      values.dryRun = true
      continue
    }
    if (flag === '--image') {
      values.image = optionValue(args, index, flag)
      index += 1
      continue
    }
    if (flag === '--replacement-image') {
      values.replacementImage = optionValue(args, index, flag)
      replacementExplicit = true
      index += 1
      continue
    }
    if (flag === '--release-bundle') {
      values.releaseBundle = optionValue(args, index, flag)
      index += 1
      continue
    }
    if (flag === '--run-id') {
      values.runId = optionValue(args, index, flag)
      index += 1
      continue
    }
    if (flag === '--timeout-ms') {
      values.timeoutMs = Number(optionValue(args, index, flag))
      index += 1
      continue
    }
    throw new Error(`Unknown self-host smoke option: ${flag}`)
  }

  if (!replacementExplicit) values.replacementImage = values.image
  const options = Value.Decode(CliOptionsSchema, values)
  if (!options.dryRun && options.releaseBundle === '<release-bundle.tar.gz>') {
    throw new Error('--release-bundle is required unless --dry-run is used')
  }
  return options
}

function projectName(runId: string, dialect: Dialect): string {
  return `instatic-fuma-web-003-${runId}-${dialect}`
}

function composeFiles(dialect: Dialect, bundleRoot: string, overridePath: string): string[] {
  const files = ['-f', join(bundleRoot, 'compose.prod.yml')]
  if (dialect === 'sqlite') files.push('-f', join(bundleRoot, 'compose.sqlite.yml'))
  files.push('-f', overridePath)
  return files
}

function composeStep(
  id: string,
  dialect: Dialect,
  options: SelfHostSmokeOptions,
  composeArgs: readonly string[],
  image = options.image,
): PlanStep {
  return {
    id,
    dialect,
    command: [
      'docker', 'compose', '-p', projectName(options.runId, dialect),
      ...composeFiles(dialect, BUNDLE_ROOT, OVERRIDE_PATH),
      ...composeArgs,
    ],
    environment: {
      INSTATIC_IMAGE: image,
      POSTGRES_PASSWORD: SMOKE_PASSWORD,
    },
  }
}

export function buildSelfHostSmokePlan(options: SelfHostSmokeOptions): SelfHostSmokePlan {
  const steps: PlanStep[] = [
    { id: 'release-bundle-list', command: ['tar', '-tzf', options.releaseBundle] },
    { id: 'initial-image-inspect', command: ['docker', 'image', 'inspect', options.image] },
    { id: 'replacement-image-inspect', command: ['docker', 'image', 'inspect', options.replacementImage] },
  ]
  const resources: string[] = []

  for (const dialect of DIALECTS) {
    const project = projectName(options.runId, dialect)
    resources.push(
      project,
      `${project}_uploads`,
      dialect === 'sqlite' ? `${project}_data` : `${project}_postgres_data`,
    )
    const projectLabel = `label=com.docker.compose.project=${project}`
    steps.push(
      {
        id: `${dialect}-preflight-containers`,
        dialect,
        command: ['docker', 'ps', '-aq', '--filter', projectLabel],
      },
      {
        id: `${dialect}-preflight-volumes`,
        dialect,
        command: ['docker', 'volume', 'ls', '-q', '--filter', projectLabel],
      },
      {
        id: `${dialect}-preflight-networks`,
        dialect,
        command: ['docker', 'network', 'ls', '-q', '--filter', projectLabel],
      },
      composeStep(`${dialect}-start`, dialect, options, ['up', '-d', '--wait']),
      composeStep(`${dialect}-restart`, dialect, options, ['restart', 'app']),
      composeStep(
        `${dialect}-replace`,
        dialect,
        options,
        ['up', '-d', '--no-deps', '--force-recreate', 'app'],
        options.replacementImage,
      ),
      composeStep(`${dialect}-cleanup`, dialect, options, ['down', '--volumes', '--remove-orphans']),
    )
  }

  return Value.Decode(SelfHostSmokePlanSchema, {
    version: 1,
    projectPrefix: `instatic-fuma-web-003-${options.runId}`,
    resources,
    steps,
    checks: [
      'release bundle has one safe root and all required Compose/install files',
      'image workdir is /app/apps/studio and command is bun run server/index.ts',
      'SQLite and PostgreSQL containers become healthy on an ephemeral loopback port',
      'admin HTML and favicon are served from /app/dist',
      'database, upload, and published-path markers survive restart and image replacement',
      'schema_migrations is non-empty, unique, additive across replacement, and equal across dialects',
      'every project and named volume is removed in finally on success or failure',
    ],
  })
}

interface CommandResult {
  stdout: string
  stderr: string
}

async function runCommand(
  command: readonly string[],
  options: { cwd?: string; environment?: Record<string, string>; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  const process = Bun.spawn([...command], {
    cwd: options.cwd,
    env: { ...globalThis.process.env, ...options.environment },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`Command failed (${exitCode}): ${command.join(' ')}\n${stderr.trim()}`)
  }
  return { stdout, stderr }
}

function decodeJson<T extends TSchema>(schema: T, raw: string, label: string): Static<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error })
  }
  return Value.Decode(schema, parsed)
}

async function inspectImage(image: string): Promise<void> {
  const result = await runCommand(['docker', 'image', 'inspect', image])
  const [inspect] = decodeJson(ImageInspectSchema, result.stdout, `docker image inspect ${image}`)
  if (inspect.Config.WorkingDir !== '/app/apps/studio') {
    throw new Error(`${image} has unexpected workdir: ${inspect.Config.WorkingDir}`)
  }
  if (inspect.Config.Cmd.join(' ') !== 'bun run server/index.ts') {
    throw new Error(`${image} has unexpected startup command: ${inspect.Config.Cmd.join(' ')}`)
  }
  if (!inspect.Config.Env.includes('STATIC_DIR=/app/dist')) {
    throw new Error(`${image} does not expose the moved Studio static directory`)
  }
}

function validateArchiveEntries(raw: string): { entries: string[]; root: string } {
  const entries = Value.Decode(
    BundleEntriesSchema,
    raw.split('\n').map((entry) => entry.trim()).filter(Boolean),
  )
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('\\')) {
      throw new Error(`Unsafe release bundle path: ${entry}`)
    }
    const normalized = posix.normalize(entry)
    if (normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`Unsafe release bundle path: ${entry}`)
    }
  }
  const roots = new Set(entries.map((entry) => entry.split('/')[0]).filter(Boolean))
  if (roots.size !== 1) throw new Error('Release bundle must have exactly one top-level directory')
  const root = [...roots][0]
  for (const required of REQUIRED_BUNDLE_PATHS) {
    if (!entries.includes(`${root}/${required}`)) {
      throw new Error(`Release bundle is missing ${required}`)
    }
  }
  return { entries, root }
}

async function extractAndValidateBundle(bundlePath: string, tempRoot: string): Promise<string> {
  const listing = await runCommand(['tar', '-tzf', bundlePath])
  const { root } = validateArchiveEntries(listing.stdout)
  await runCommand([
    'tar', '-xzf', bundlePath, '-C', tempRoot,
    '--no-same-owner', '--no-same-permissions', '--keep-directory-symlink',
  ])
  const bundleRoot = resolve(tempRoot, root)
  if (!bundleRoot.startsWith(`${resolve(tempRoot)}/`)) throw new Error('Release bundle escaped temp root')

  const compose = await readFile(join(bundleRoot, 'compose.prod.yml'), 'utf8')
  if (!compose.includes('STATIC_DIR: /app/dist')) {
    throw new Error('Release bundle compose.prod.yml does not use the moved Studio static path')
  }
  const install = await readFile(join(bundleRoot, 'INSTALL.md'), 'utf8')
  if (!install.includes('-f compose.prod.yml -f compose.sqlite.yml up -d')) {
    throw new Error('Release bundle INSTALL.md is missing the SQLite startup command')
  }
  if (!install.includes('-f compose.prod.yml up -d')) {
    throw new Error('Release bundle INSTALL.md is missing the PostgreSQL startup command')
  }
  return bundleRoot
}

function actualComposeCommand(
  dialect: Dialect,
  runId: string,
  bundleRoot: string,
  overridePath: string,
  args: readonly string[],
): string[] {
  return [
    'docker', 'compose', '-p', projectName(runId, dialect),
    ...composeFiles(dialect, bundleRoot, overridePath),
    ...args,
  ]
}

function composeEnvironment(image: string): Record<string, string> {
  return { INSTATIC_IMAGE: image, POSTGRES_PASSWORD: SMOKE_PASSWORD }
}

async function resolveAppPort(commandPrefix: readonly string[], environment: Record<string, string>): Promise<number> {
  const result = await runCommand([...commandPrefix, 'port', 'app', '3001'], { environment })
  const address = Value.Decode(PortOutputSchema, result.stdout.trim())
  return Value.Decode(PortSchema, Number(address.slice(address.lastIndexOf(':') + 1)))
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = new Error('health endpoint was not attempted')
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) {
        Value.Decode(HealthSchema, await response.json())
        return
      }
      lastError = new Error(`health returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for health on port ${port}`, { cause: lastError })
}

function decodeResourceList(raw: string): string[] {
  return Value.Decode(
    DockerResourceIdsSchema,
    raw.split('\n').map((entry) => entry.trim()).filter(Boolean),
  )
}

async function assertProjectUnused(runId: string, dialect: Dialect): Promise<void> {
  const project = projectName(runId, dialect)
  const filter = `label=com.docker.compose.project=${project}`
  const commands = [
    ['docker', 'ps', '-aq', '--filter', filter],
    ['docker', 'volume', 'ls', '-q', '--filter', filter],
    ['docker', 'network', 'ls', '-q', '--filter', filter],
  ] as const
  const results = await Promise.all(commands.map((command) => runCommand(command)))
  if (results.some((result) => decodeResourceList(result.stdout).length > 0)) {
    throw new Error(`Docker project ${project} already exists; choose another --run-id`)
  }
}

async function assertHttpPaths(port: number): Promise<void> {
  const requests = await Promise.all([
    fetch(`http://127.0.0.1:${port}/admin`),
    fetch(`http://127.0.0.1:${port}/favicon.svg`),
    fetch(`http://127.0.0.1:${port}/uploads/fuma-web-003/proof.txt`),
  ])
  const [adminBody, faviconBody, uploadBody] = await Promise.all(requests.map((response) => response.text()))
  if (!requests[0].ok || !adminBody.toLowerCase().includes('<!doctype html')) {
    throw new Error('Admin static HTML was not served from the moved Studio dist')
  }
  if (!requests[1].ok || !faviconBody.includes('<svg')) {
    throw new Error('Static favicon was not served from the moved Studio dist')
  }
  if (!requests[2].ok || uploadBody !== 'fuma-web-003-upload-marker') {
    throw new Error('Persistent upload marker was not served from UPLOADS_DIR')
  }
}

async function readPersistenceState(
  commandPrefix: readonly string[],
  environment: Record<string, string>,
  seed: boolean,
): Promise<PersistenceState> {
  const result = await runCommand([
    ...commandPrefix, 'exec', '-T',
    '-e', `FUMA_WEB_003_SEED=${seed ? 'true' : 'false'}`,
    'app', 'bun', '-e', PERSISTENCE_PROBE,
  ], { environment })
  return decodeJson(PersistenceStateSchema, result.stdout.trim(), 'container persistence probe')
}

function assertPersistedState(
  state: PersistenceState,
  dialect: Dialect,
  previousMigrationIds?: readonly string[],
): void {
  if (state.dialect !== dialect) throw new Error(`Expected ${dialect}, received ${state.dialect}`)
  if (state.databaseMarker !== 'fuma-web-003-persistent-marker') {
    throw new Error(`${dialect} database marker was not preserved`)
  }
  if (state.uploadMarker !== 'fuma-web-003-upload-marker') {
    throw new Error(`${dialect} upload marker was not preserved`)
  }
  if (state.publishedMarker !== 'fuma-web-003-published-marker') {
    throw new Error(`${dialect} published-path marker was not preserved`)
  }
  if (new Set(state.migrationIds).size !== state.migrationIds.length) {
    throw new Error(`${dialect} schema_migrations contains duplicate IDs`)
  }
  for (const id of previousMigrationIds ?? []) {
    if (!state.migrationIds.includes(id)) {
      throw new Error(`${dialect} replacement image lost applied migration ${id}`)
    }
  }
}

async function runDialect(
  dialect: Dialect,
  options: SelfHostSmokeOptions,
  bundleRoot: string,
  overridePath: string,
): Promise<PersistenceState> {
  const commandPrefix = actualComposeCommand(dialect, options.runId, bundleRoot, overridePath, [])
  const initialEnvironment = composeEnvironment(options.image)
  const replacementEnvironment = composeEnvironment(options.replacementImage)

  await assertProjectUnused(options.runId, dialect)
  try {
    await runCommand([...commandPrefix, 'up', '-d', '--wait', '--wait-timeout', String(Math.ceil(options.timeoutMs / 1_000))], {
      environment: initialEnvironment,
    })
    let port = await resolveAppPort(commandPrefix, initialEnvironment)
    await waitForHealth(port, options.timeoutMs)

    const initial = await readPersistenceState(commandPrefix, initialEnvironment, false)
    const seeded = await readPersistenceState(commandPrefix, initialEnvironment, true)
    assertPersistedState(seeded, dialect, initial.migrationIds)
    await assertHttpPaths(port)

    await runCommand([...commandPrefix, 'restart', 'app'], { environment: initialEnvironment })
    port = await resolveAppPort(commandPrefix, initialEnvironment)
    await waitForHealth(port, options.timeoutMs)
    const restarted = await readPersistenceState(commandPrefix, initialEnvironment, false)
    assertPersistedState(restarted, dialect, seeded.migrationIds)
    await assertHttpPaths(port)

    await runCommand([...commandPrefix, 'up', '-d', '--no-deps', '--force-recreate', 'app'], {
      environment: replacementEnvironment,
    })
    port = await resolveAppPort(commandPrefix, replacementEnvironment)
    await waitForHealth(port, options.timeoutMs)
    const replaced = await readPersistenceState(commandPrefix, replacementEnvironment, false)
    assertPersistedState(replaced, dialect, restarted.migrationIds)
    await assertHttpPaths(port)
    return replaced
  } catch (error) {
    const logs = await runCommand([...commandPrefix, 'logs', '--no-color', 'app', 'postgres'], {
      environment: replacementEnvironment,
      allowFailure: true,
    })
    if (logs.stdout.trim() || logs.stderr.trim()) {
      console.error(`[self-host-smoke:${dialect}] Docker logs:\n${logs.stdout}${logs.stderr}`)
    }
    throw error
  } finally {
    await runCommand([...commandPrefix, 'down', '--volumes', '--remove-orphans', '--timeout', '5'], {
      environment: replacementEnvironment,
    })
  }
}

export async function runSelfHostSmoke(options: SelfHostSmokeOptions): Promise<void> {
  const plan = buildSelfHostSmokePlan(options)
  if (options.dryRun) {
    console.log(JSON.stringify(plan, null, 2))
    return
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'instatic-fuma-web-003-'))
  try {
    const bundleRoot = await extractAndValidateBundle(resolve(options.releaseBundle), tempRoot)
    const overridePath = join(tempRoot, 'smoke.override.yml')
    await writeFile(overridePath, `services:\n  app:\n    restart: "no"\n    ports: !override\n      - "127.0.0.1::3001"\n  postgres:\n    restart: "no"\n`, 'utf8')

    await inspectImage(options.image)
    if (options.replacementImage !== options.image) await inspectImage(options.replacementImage)

    const sqlite = await runDialect('sqlite', options, bundleRoot, overridePath)
    const postgres = await runDialect('postgres', options, bundleRoot, overridePath)
    if (sqlite.migrationIds.join('\n') !== postgres.migrationIds.join('\n')) {
      throw new Error('SQLite and PostgreSQL applied migration IDs differ')
    }
    console.log(`FUMA-WEB-003 self-host smoke passed (${sqlite.migrationIds.length} migrations per dialect).`)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try {
    await runSelfHostSmoke(parseSelfHostSmokeArgs(Bun.argv.slice(2)))
  } catch (error) {
    console.error('[self-host-smoke] failed:', error)
    process.exitCode = 1
  }
}
