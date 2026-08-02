#!/usr/bin/env bun
import { link, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  createPairedReleaseManifest,
  hashPairedReleaseFile,
  verifyPairedRelease,
} from '../src'
import {
  validatedEvidenceHash,
  validatedPublicationPlanHash,
} from './releaseEvidence'

const SourceRevisionSchema = Type.String({ pattern: '^[a-f0-9]{40}(?:[a-f0-9]{24})?$' })
const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const MigrationHighWaterSchema = Type.String({ pattern: '^000[0-9]{3}_[a-z0-9_]+$' })
const PlatformSchema = Type.Literal('linux/arm64')
const ImmutableRuntimeImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-runtime@sha256:[a-f0-9]{64}$' })
const ImmutableWebImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-web@sha256:[a-f0-9]{64}$' })
const ImmutableSiteRuntimeImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-site-runtime@sha256:[a-f0-9]{64}$' })
const HttpResponseSchema = Type.Object({
  status: Type.Integer({ minimum: 100, maximum: 599 }),
  bytes: Type.Integer({ minimum: 1 }),
  bodySha256: Sha256Schema,
}, { additionalProperties: false })

export const RuntimeSmokeSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  sourceSha: SourceRevisionSchema,
  lockHashSha256: Sha256Schema,
  migrationHighWaterMark: MigrationHighWaterSchema,
  platform: PlatformSchema,
  image: ImmutableRuntimeImageSchema,
  nonRoot: Type.Literal(true),
  roles: Type.Array(Type.Object({
    role: Type.Union([Type.Literal('web'), Type.Literal('worker'), Type.Literal('scheduler')]),
    health: Type.Object({
      service: Type.Literal('fuma'),
      topology: Type.Literal('pooled'),
      role: Type.Union([Type.Literal('web'), Type.Literal('worker'), Type.Literal('scheduler')]),
      state: Type.Literal('ready'),
      ownedComponents: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
      inFlight: Type.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
    logsSha256: Sha256Schema,
  }, { additionalProperties: false }), { minItems: 3, maxItems: 3 }),
  migrationCommand: Type.String({ pattern: '^000[0-9]{3}_release_smoke$' }),
  emailRenderer: Type.Object({
    passed: Type.Literal(true),
    platform: Type.Literal('linux'),
    arch: Type.Literal('arm64'),
    bun: Type.String({ minLength: 1 }),
    versions: Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 })),
    htmlSha256: Sha256Schema,
    textSha256: Sha256Schema,
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export const WebSmokeSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  sourceSha: SourceRevisionSchema,
  lockHashSha256: Sha256Schema,
  migrationHighWaterMark: MigrationHighWaterSchema,
  platform: PlatformSchema,
  image: ImmutableWebImageSchema,
  nonRoot: Type.Literal(true),
  response: Type.Intersect([HttpResponseSchema, Type.Object({ status: Type.Literal(200) })]),
  logsSha256: Sha256Schema,
  acceptanceScope: Type.Literal('container-http-liveness-not-browser-or-public-host'),
}, { additionalProperties: false })

export const SiteRuntimeSmokeSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  sourceSha: SourceRevisionSchema,
  lockHashSha256: Sha256Schema,
  migrationHighWaterMark: MigrationHighWaterSchema,
  platform: PlatformSchema,
  image: ImmutableSiteRuntimeImageSchema,
  nonRoot: Type.Literal(true),
  response: Type.Intersect([HttpResponseSchema, Type.Object({ status: Type.Literal(404) })]),
  logsSha256: Sha256Schema,
  directOriginDenied: Type.Literal(true),
  acceptanceScope: Type.Literal('container-http-liveness-and-direct-origin-denial-not-browser-or-public-host'),
}, { additionalProperties: false })

const COMPONENTS = ['runtime', 'web', 'site-runtime'] as const
const EVIDENCE_SUFFIXES = ['index', 'scan', 'sbom', 'provenance', 'signature-verification', 'smoke-dir'] as const
const EVIDENCE_OPTIONS = [
  ...COMPONENTS.flatMap((component) => EVIDENCE_SUFFIXES.map((suffix) => `${component}-${suffix}`)),
  'publication-plan',
] as const
const CREATE_OPTIONS = new Set([
  'source-sha', 'lock-file', 'migration-high-water',
  ...COMPONENTS.flatMap((component) => [`${component}-digest-file`, `${component}-source-sha-file`]),
  ...EVIDENCE_OPTIONS,
  'output',
])
const VERIFY_OPTIONS = new Set(['verify', 'digest', 'evidence', ...EVIDENCE_OPTIONS])

type SmokeSchema = typeof RuntimeSmokeSchema | typeof WebSmokeSchema | typeof SiteRuntimeSmokeSchema
type RuntimeSmoke = Static<typeof RuntimeSmokeSchema>

function options(argv = process.argv.slice(2)): ReadonlyMap<string, string> {
  const entries = new Map<string, string>()
  for (const argument of argv) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(argument)
    if (!match) throw new Error(`Malformed option: ${argument}`)
    const [, name, value] = match
    if (entries.has(name!)) throw new Error(`Duplicate --${name}=...`)
    entries.set(name!, value!)
  }
  const allowed = entries.has('verify') ? VERIFY_OPTIONS : CREATE_OPTIONS
  for (const name of entries.keys()) {
    if (!allowed.has(name)) throw new Error(`Unsupported --${name}=... in ${entries.has('verify') ? 'verify' : 'create'} mode`)
  }
  if (entries.has('digest') && !entries.has('verify')) throw new Error('--digest requires --verify')
  return entries
}

function required(input: ReadonlyMap<string, string>, name: string): string {
  const value = input.get(name)
  if (!value) throw new Error(`Missing --${name}=...`)
  return value
}

async function text(path: string): Promise<string> {
  return (await readFile(resolve(path), 'utf8')).trim()
}

async function fileHash(path: string): Promise<string> {
  return hashPairedReleaseFile(await readFile(resolve(path)))
}

function assertRuntimeSmokeSemantics(value: RuntimeSmoke): void {
  const roles = value.roles.map(({ role }) => role).sort()
  if (roles.join(',') !== 'scheduler,web,worker') throw new Error('Runtime smoke must contain each role exactly once')
  for (const result of value.roles) {
    if (result.health.role !== result.role) throw new Error(`Runtime health role mismatch for ${result.role}`)
    if (!result.health.ownedComponents.includes(`${result.role}-runtime`)) {
      throw new Error(`Runtime health is missing ${result.role}-runtime ownership`)
    }
  }
}

export async function evidenceDirectoryHash(
  path: string,
  schema: SmokeSchema,
  sourceSha: string,
  lockHashSha256: string,
  migrationHighWaterMark: string,
  expectedImage: string,
): Promise<string> {
  const directory = resolve(path)
  const entries = await readdir(directory, { withFileTypes: true })
  const expectedNames = ['arm64.json']
  const names = entries.map(({ name }) => name).sort()
  if (names.join(',') !== expectedNames.join(',')) throw new Error(`${basename(directory)} must contain only arm64.json`)
  if (entries.some((entry) => !entry.isFile())) throw new Error(`${basename(directory)} smoke records must be regular files`)

  const name = expectedNames[0]!
  const bytes = await readFile(join(directory, name))
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`Invalid smoke evidence ${name}: JSON parse failed`)
  }
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value).First()
    throw new Error(`Invalid smoke evidence ${name}: ${detail?.path || '/'} ${detail?.message || 'invalid'}`)
  }
  const smoke = value as Static<SmokeSchema>
  if (smoke.sourceSha !== sourceSha) throw new Error(`Mixed source SHA in ${name}`)
  if (smoke.lockHashSha256 !== lockHashSha256) throw new Error(`Lock hash mismatch in ${name}`)
  if (smoke.migrationHighWaterMark !== migrationHighWaterMark) throw new Error(`Migration high-water mismatch in ${name}`)
  if (smoke.platform !== 'linux/arm64') throw new Error(`Platform mismatch in ${name}`)
  if (smoke.image !== expectedImage) throw new Error(`Smoke image mismatch in ${name}`)
  if (schema === RuntimeSmokeSchema) assertRuntimeSmokeSemantics(value as RuntimeSmoke)
  return hashPairedReleaseFile(Buffer.concat([Buffer.from(`${name}\0`), bytes]))
}

async function verifyMode(input: ReadonlyMap<string, string>): Promise<void> {
  const manifestPath = resolve(required(input, 'verify'))
  const bytes = await readFile(manifestPath)
  const manifest = verifyPairedRelease(JSON.parse(bytes.toString('utf8')))
  const sidecarPath = resolve(input.get('digest') ?? `${manifestPath}.sha256`)
  const sidecar = await text(sidecarPath)
  const match = /^([a-f0-9]{64}) {2}([^/]+)$/.exec(sidecar)
  if (!match || match[1] !== hashPairedReleaseFile(bytes) || match[2] !== basename(manifestPath)) throw new Error('Paired release file digest mismatch')

  const evidenceMode = input.get('evidence')
  const suppliedEvidence = EVIDENCE_OPTIONS.filter((name) => input.has(name))
  if (evidenceMode === undefined && suppliedEvidence.length > 0) throw new Error('Evidence paths require --evidence=full')
  if (evidenceMode !== undefined && evidenceMode !== 'full') throw new Error('--evidence must be full')
  let evidenceVerified = false
  if (evidenceMode === 'full') {
    const runtimeIndex = required(input, 'runtime-index')
    const webIndex = required(input, 'web-index')
    const siteRuntimeIndex = required(input, 'site-runtime-index')
    const checks = await Promise.all([
      validatedEvidenceHash(runtimeIndex, 'oci-index', manifest.runtimeImage, manifest.sourceSha),
      validatedEvidenceHash(webIndex, 'oci-index', manifest.webImage, manifest.sourceSha),
      validatedEvidenceHash(siteRuntimeIndex, 'oci-index', manifest.siteRuntimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'runtime-scan'), 'scan', manifest.runtimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'web-scan'), 'scan', manifest.webImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'site-runtime-scan'), 'scan', manifest.siteRuntimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'runtime-sbom'), 'sbom', manifest.runtimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'web-sbom'), 'sbom', manifest.webImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'site-runtime-sbom'), 'sbom', manifest.siteRuntimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'runtime-provenance'), 'provenance', manifest.runtimeImage, manifest.sourceSha, runtimeIndex),
      validatedEvidenceHash(required(input, 'web-provenance'), 'provenance', manifest.webImage, manifest.sourceSha, webIndex),
      validatedEvidenceHash(required(input, 'site-runtime-provenance'), 'provenance', manifest.siteRuntimeImage, manifest.sourceSha, siteRuntimeIndex),
      validatedEvidenceHash(required(input, 'runtime-signature-verification'), 'signature', manifest.runtimeImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'web-signature-verification'), 'signature', manifest.webImage, manifest.sourceSha),
      validatedEvidenceHash(required(input, 'site-runtime-signature-verification'), 'signature', manifest.siteRuntimeImage, manifest.sourceSha),
      evidenceDirectoryHash(required(input, 'runtime-smoke-dir'), RuntimeSmokeSchema, manifest.sourceSha, manifest.lockHashSha256, manifest.migrationHighWaterMark, manifest.runtimeImage),
      evidenceDirectoryHash(required(input, 'web-smoke-dir'), WebSmokeSchema, manifest.sourceSha, manifest.lockHashSha256, manifest.migrationHighWaterMark, manifest.webImage),
      evidenceDirectoryHash(required(input, 'site-runtime-smoke-dir'), SiteRuntimeSmokeSchema, manifest.sourceSha, manifest.lockHashSha256, manifest.migrationHighWaterMark, manifest.siteRuntimeImage),
      validatedPublicationPlanHash(required(input, 'publication-plan'), manifest.sourceSha, manifest.runtimeImage, manifest.webImage, manifest.siteRuntimeImage),
    ])
    const expected = [
      manifest.runtimeIndexHashSha256, manifest.webIndexHashSha256, manifest.siteRuntimeIndexHashSha256,
      manifest.runtimeScanReportHashSha256, manifest.webScanReportHashSha256, manifest.siteRuntimeScanReportHashSha256,
      manifest.runtimeSbomHashSha256, manifest.webSbomHashSha256, manifest.siteRuntimeSbomHashSha256,
      manifest.runtimeProvenanceHashSha256, manifest.webProvenanceHashSha256, manifest.siteRuntimeProvenanceHashSha256,
      manifest.runtimeSignatureVerificationHashSha256, manifest.webSignatureVerificationHashSha256, manifest.siteRuntimeSignatureVerificationHashSha256,
      manifest.runtimeSmokeEvidenceHashSha256, manifest.webSmokeEvidenceHashSha256, manifest.siteRuntimeSmokeEvidenceHashSha256,
      manifest.publicationPlanHashSha256,
    ]
    if (checks.some((hash, index) => hash !== expected[index])) throw new Error('Retained release evidence hash mismatch')
    evidenceVerified = true
  }
  process.stdout.write(`${JSON.stringify({ verified: true, evidenceVerified, manifest: manifestPath, digest: match[1] })}\n`)
}

async function publishExclusiveFile(path: string, bytes: Uint8Array | string): Promise<void> {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, '.paired-release-'))
  const staged = join(staging, basename(path))
  try {
    await writeFile(staged, bytes, { flag: 'wx', mode: 0o644 })
    const handle = await open(staged, 'r')
    try { await handle.sync() } finally { await handle.close() }
    await link(staged, path)
    const directoryHandle = await open(parent, 'r')
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function createMode(input: ReadonlyMap<string, string>): Promise<void> {
  const sourceSha = required(input, 'source-sha')
  if (!Value.Check(SourceRevisionSchema, sourceSha)) throw new Error('Source SHA must be 40 or 64 lowercase hex characters')
  const lockFile = resolve(required(input, 'lock-file'))
  const repositoryRoot = resolve(import.meta.dir, '../../..')
  if (lockFile !== join(repositoryRoot, 'bun.lock')) throw new Error('--lock-file must reference the exact root bun.lock')
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as { packageManager?: unknown; workspaces?: unknown }
  if (rootPackage.packageManager !== 'bun@1.3.14' || JSON.stringify(rootPackage.workspaces) !== JSON.stringify(['apps/*', 'packages/*'])) {
    throw new Error('Root Bun/workspace contract mismatch')
  }
  const lockHashSha256 = await fileHash(lockFile)
  const migrationHighWaterMark = required(input, 'migration-high-water')
  if (!Value.Check(MigrationHighWaterSchema, migrationHighWaterMark)) throw new Error('Invalid migration high-water mark')

  const runtimeSourceSha = await text(required(input, 'runtime-source-sha-file'))
  const webSourceSha = await text(required(input, 'web-source-sha-file'))
  const siteRuntimeSourceSha = await text(required(input, 'site-runtime-source-sha-file'))
  const runtimeImage = await text(required(input, 'runtime-digest-file'))
  const webImage = await text(required(input, 'web-digest-file'))
  const siteRuntimeImage = await text(required(input, 'site-runtime-digest-file'))
  const runtimeIndex = required(input, 'runtime-index')
  const webIndex = required(input, 'web-index')
  const siteRuntimeIndex = required(input, 'site-runtime-index')
  const manifest = createPairedReleaseManifest({
    schemaVersion: 4,
    sourceSha,
    lockHashSha256,
    migrationHighWaterMark,
    runtimeImage,
    runtimeImageSourceSha: runtimeSourceSha,
    webImage,
    webImageSourceSha: webSourceSha,
    siteRuntimeImage,
    siteRuntimeImageSourceSha: siteRuntimeSourceSha,
    architectures: ['linux/arm64'],
    runtimeIndexHashSha256: await validatedEvidenceHash(runtimeIndex, 'oci-index', runtimeImage, sourceSha),
    webIndexHashSha256: await validatedEvidenceHash(webIndex, 'oci-index', webImage, sourceSha),
    siteRuntimeIndexHashSha256: await validatedEvidenceHash(siteRuntimeIndex, 'oci-index', siteRuntimeImage, sourceSha),
    runtimeScanReportHashSha256: await validatedEvidenceHash(required(input, 'runtime-scan'), 'scan', runtimeImage, sourceSha),
    webScanReportHashSha256: await validatedEvidenceHash(required(input, 'web-scan'), 'scan', webImage, sourceSha),
    siteRuntimeScanReportHashSha256: await validatedEvidenceHash(required(input, 'site-runtime-scan'), 'scan', siteRuntimeImage, sourceSha),
    runtimeSbomHashSha256: await validatedEvidenceHash(required(input, 'runtime-sbom'), 'sbom', runtimeImage, sourceSha),
    webSbomHashSha256: await validatedEvidenceHash(required(input, 'web-sbom'), 'sbom', webImage, sourceSha),
    siteRuntimeSbomHashSha256: await validatedEvidenceHash(required(input, 'site-runtime-sbom'), 'sbom', siteRuntimeImage, sourceSha),
    runtimeProvenanceHashSha256: await validatedEvidenceHash(required(input, 'runtime-provenance'), 'provenance', runtimeImage, sourceSha, runtimeIndex),
    webProvenanceHashSha256: await validatedEvidenceHash(required(input, 'web-provenance'), 'provenance', webImage, sourceSha, webIndex),
    siteRuntimeProvenanceHashSha256: await validatedEvidenceHash(required(input, 'site-runtime-provenance'), 'provenance', siteRuntimeImage, sourceSha, siteRuntimeIndex),
    runtimeSignatureVerificationHashSha256: await validatedEvidenceHash(required(input, 'runtime-signature-verification'), 'signature', runtimeImage, sourceSha),
    webSignatureVerificationHashSha256: await validatedEvidenceHash(required(input, 'web-signature-verification'), 'signature', webImage, sourceSha),
    siteRuntimeSignatureVerificationHashSha256: await validatedEvidenceHash(required(input, 'site-runtime-signature-verification'), 'signature', siteRuntimeImage, sourceSha),
    runtimeSmokeEvidenceHashSha256: await evidenceDirectoryHash(required(input, 'runtime-smoke-dir'), RuntimeSmokeSchema, sourceSha, lockHashSha256, migrationHighWaterMark, runtimeImage),
    webSmokeEvidenceHashSha256: await evidenceDirectoryHash(required(input, 'web-smoke-dir'), WebSmokeSchema, sourceSha, lockHashSha256, migrationHighWaterMark, webImage),
    siteRuntimeSmokeEvidenceHashSha256: await evidenceDirectoryHash(required(input, 'site-runtime-smoke-dir'), SiteRuntimeSmokeSchema, sourceSha, lockHashSha256, migrationHighWaterMark, siteRuntimeImage),
    publicationPlanHashSha256: await validatedPublicationPlanHash(required(input, 'publication-plan'), sourceSha, runtimeImage, webImage, siteRuntimeImage),
  })
  verifyPairedRelease(manifest)
  const output = resolve(required(input, 'output'))
  const sidecar = `${output}.sha256`
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const digest = hashPairedReleaseFile(bytes)
  await mkdir(dirname(output), { recursive: true })
  let outputCreated = false
  try {
    await publishExclusiveFile(output, bytes)
    outputCreated = true
    await publishExclusiveFile(sidecar, `${digest}  ${basename(output)}\n`)
  } catch (error) {
    if (outputCreated) await rm(output, { force: true })
    throw error
  }
  process.stdout.write(`${JSON.stringify({ created: true, manifest: output, digest })}\n`)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const input = options(argv)
  if (input.has('verify')) await verifyMode(input)
  else await createMode(input)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Paired release tooling failed')
    process.exitCode = 1
  }
}
