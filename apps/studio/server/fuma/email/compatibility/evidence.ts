import { createHash } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  FUMA_EMAIL_ARCHITECTURE_MATRIX,
  FUMA_EMAIL_CLI_COMMANDS,
  FUMA_EMAIL_COMPATIBILITY_PACKAGES,
  FUMA_EMAIL_EXPECTED_OUTPUT_SHA256,
  FUMA_EMAIL_PROVEN_RUNTIME,
  FUMA_EMAIL_REJECTED_PACKAGES,
} from './versions'

const STUDIO_ROOT = resolve(import.meta.dir, '../../../..')
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, '../..')

export const FUMA_EMAIL_EVIDENCE_SOURCE_FILES = Object.freeze([
  'package.json',
  'bun.lock',
  '.github/workflows/fuma-email-compatibility.yml',
  'apps/studio/package.json',
  'apps/studio/scripts/fuma-email-compatibility-matrix.ts',
  'apps/studio/scripts/fuma-email-compatibility-target.ts',
  'apps/studio/server/fuma/email/compatibility/DECISION.md',
  'apps/studio/server/fuma/email/compatibility/architectureProbe.ts',
  'apps/studio/server/fuma/email/compatibility/compatibility.test.ts',
  'apps/studio/server/fuma/email/compatibility/evidence.ts',
  'apps/studio/server/fuma/email/compatibility/renderFixture.ts',
  'apps/studio/server/fuma/email/compatibility/versions.ts',
  'apps/studio/server/fuma/email/compatibility/emails/systemNotice.tsx',
  'apps/studio/server/fuma/email/compatibility/snapshots/systemNotice.html',
  'apps/studio/server/fuma/email/compatibility/snapshots/systemNotice.txt',
  'apps/studio/server/fuma/email/index.ts',
  'apps/studio/server/fuma/email/tenantDocumentRenderer.ts',
  'apps/studio/server/fuma/email/trustedSystemTemplateRenderer.tsx',
  'apps/studio/src/__tests__/architecture/fuma-email-boundaries.test.ts',
  'apps/studio/src/__tests__/fuma/emailDocumentRenderer.test.ts',
  'apps/studio/src/core/fuma/email/document.ts',
  'apps/studio/src/core/fuma/email/index.ts',
] as const)

const ArchitectureSchema = Type.Union([Type.Literal('arm64'), Type.Literal('x64')])
const PlatformSchema = Type.Literal('linux')
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const VersionsSchema = Type.Object({
  reactEmail: Type.Literal('6.9.1'),
  reactEmailUi: Type.Literal('6.9.1'),
  react: Type.Literal('19.2.5'),
  reactDom: Type.Literal('19.2.5'),
}, { additionalProperties: false })
const TestCountsSchema = Type.Object({
  passed: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  failed: Type.Literal(0),
}, { additionalProperties: false })
const SourceFilesSchema = Type.Record(Type.String(), HashSchema)

export const FumaEmailArchitectureEvidenceSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  tickets: Type.Tuple([Type.Literal('FUMA-041'), Type.Literal('FUMA-042')]),
  passed: Type.Literal(true),
  execution: Type.Literal('native'),
  target: Type.Object({ platform: PlatformSchema, arch: ArchitectureSchema }, { additionalProperties: false }),
  host: Type.Object({ platform: PlatformSchema, arch: ArchitectureSchema }, { additionalProperties: false }),
  bun: Type.Literal('1.3.14'),
  versions: VersionsSchema,
  rootLockSha256: HashSchema,
  sourceSha256: HashSchema,
  sourceFiles: SourceFilesSchema,
  api: Type.Object({
    render: Type.Literal('function'),
    components: Type.Tuple([
      Type.Literal('Body'),
      Type.Literal('Button'),
      Type.Literal('Column'),
      Type.Literal('Container'),
      Type.Literal('Head'),
      Type.Literal('Heading'),
      Type.Literal('Hr'),
      Type.Literal('Html'),
      Type.Literal('Img'),
      Type.Literal('Link'),
      Type.Literal('Preview'),
      Type.Literal('Row'),
      Type.Literal('Section'),
      Type.Literal('Text'),
    ]),
    cliBin: Type.Literal('./dist/cli/index.mjs'),
  }, { additionalProperties: false }),
  htmlSha256: Type.Literal(FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.html),
  textSha256: Type.Literal(FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.text),
}, { additionalProperties: false })

export type FumaEmailArchitectureEvidence = Static<typeof FumaEmailArchitectureEvidenceSchema>

export const FumaEmailNativeReceiptSchema = Type.Composite([
  FumaEmailArchitectureEvidenceSchema,
  Type.Object({
    receiptKind: Type.Literal('fuma-email-native-compatibility'),
    compatibilityTests: TestCountsSchema,
    rendererArchitectureTests: TestCountsSchema,
    cli: Type.Object({
      preview: Type.Literal(FUMA_EMAIL_CLI_COMMANDS.preview),
      build: Type.Literal(FUMA_EMAIL_CLI_COMMANDS.build),
      serve: Type.Literal(FUMA_EMAIL_CLI_COMMANDS.serve),
      exportHtml: Type.Literal(FUMA_EMAIL_CLI_COMMANDS.exportHtml),
      exportText: Type.Literal(FUMA_EMAIL_CLI_COMMANDS.exportText),
    }, { additionalProperties: false }),
  }),
], { additionalProperties: false })

export type FumaEmailNativeReceipt = Static<typeof FumaEmailNativeReceiptSchema>

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`FUMA-041 invalid ${label}`)
  }
  return value as JsonRecord
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableSourceDigest(sourceFiles: Readonly<Record<string, string>>): string {
  return sha256(Object.entries(sourceFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}\0${hash}\n`)
    .join(''))
}

export async function collectEmailCompatibilitySourceEvidence(): Promise<Readonly<{
  rootLockSha256: string
  sourceSha256: string
  sourceFiles: Readonly<Record<string, string>>
}>> {
  const entries = await Promise.all(FUMA_EMAIL_EVIDENCE_SOURCE_FILES.map(async (path) => {
    const bytes = new Uint8Array(await Bun.file(join(WORKSPACE_ROOT, path)).arrayBuffer())
    return [path, sha256(bytes)] as const
  }))
  const sourceFiles = Object.fromEntries(entries)
  return {
    rootLockSha256: sourceFiles['bun.lock']!,
    sourceSha256: stableSourceDigest(sourceFiles),
    sourceFiles,
  }
}

function exactLineCount(text: string, line: string): number {
  return text.split('\n').filter((candidate) => candidate.trim() === line).length
}

function assertExactLockPackage(
  lock: string,
  name: keyof typeof FUMA_EMAIL_COMPATIBILITY_PACKAGES,
): void {
  const evidence = FUMA_EMAIL_COMPATIBILITY_PACKAGES[name]
  const prefix = `"${name}": ["${name}@${evidence.version}", `
  const matches = lock.split('\n').filter((line) => line.trim().startsWith(prefix))
  if (matches.length !== 1 || !matches[0]!.includes(`"${evidence.integrity}"]`)) {
    throw new Error(`FUMA-041 lock entry mismatch for ${name}`)
  }
}

export async function assertExactEmailPackageAuthority(): Promise<void> {
  const packageJson = asRecord(await Bun.file(join(STUDIO_ROOT, 'package.json')).json(), 'Studio package manifest')
  const dependencies = asRecord(packageJson.dependencies, 'Studio dependencies')
  const devDependencies = asRecord(packageJson.devDependencies, 'Studio devDependencies')
  const scripts = asRecord(packageJson.scripts, 'Studio scripts')
  const lock = await Bun.file(join(WORKSPACE_ROOT, 'bun.lock')).text()
  const workspaceStart = lock.indexOf('"apps/studio": {')
  const workspaceEnd = lock.indexOf('\n    "apps/web": {', workspaceStart)
  if (workspaceStart < 0 || workspaceEnd < 0) throw new Error('FUMA-041 Studio lock workspace missing')
  const studioLock = lock.slice(workspaceStart, workspaceEnd)

  if (dependencies['react-email'] !== FUMA_EMAIL_COMPATIBILITY_PACKAGES['react-email'].version) {
    throw new Error('FUMA-041 react-email direct pin mismatch')
  }
  if (devDependencies['@react-email/ui'] !== FUMA_EMAIL_COMPATIBILITY_PACKAGES['@react-email/ui'].version) {
    throw new Error('FUMA-041 @react-email/ui direct pin mismatch')
  }
  for (const rejected of Object.keys(FUMA_EMAIL_REJECTED_PACKAGES)) {
    if (dependencies[rejected] !== undefined || devDependencies[rejected] !== undefined) {
      throw new Error(`FUMA-041 rejected direct package ${rejected}`)
    }
  }
  if (exactLineCount(studioLock, '"react-email": "6.9.1",') !== 1
    || exactLineCount(studioLock, '"@react-email/ui": "6.9.1",') !== 1) {
    throw new Error('FUMA-041 lock workspace pins are not exact')
  }
  assertExactLockPackage(lock, 'react-email')
  assertExactLockPackage(lock, '@react-email/ui')
  if (!lock.split('\n').some((line) => line.trim().startsWith('"react": ["react@19.2.5", '))
    || !lock.split('\n').some((line) => line.trim().startsWith('"react-dom": ["react-dom@19.2.5", '))) {
    throw new Error('FUMA-041 exact React lock tuple missing')
  }
  if (scripts['fuma:email:preview'] !== FUMA_EMAIL_CLI_COMMANDS.preview
    || scripts['fuma:email:build'] !== FUMA_EMAIL_CLI_COMMANDS.build
    || scripts['fuma:email:serve'] !== FUMA_EMAIL_CLI_COMMANDS.serve) {
    throw new Error('FUMA-041 declared CLI scripts mismatch')
  }
}

export async function readAndAssertEmailPackageMetadata(): Promise<Readonly<{
  reactEmail: string
  reactEmailUi: string
  react: string
  reactDom: string
}>> {
  const read = async (specifier: string): Promise<JsonRecord> =>
    asRecord(await Bun.file(new URL(import.meta.resolve(specifier))).json(), specifier)
  const [reactEmail, reactEmailUi, react, reactDom] = await Promise.all([
    read('react-email/package.json'),
    read('@react-email/ui/package.json'),
    read('react/package.json'),
    read('react-dom/package.json'),
  ])
  const repository = asRecord(reactEmail.repository, 'react-email repository')
  const uiRepository = asRecord(reactEmailUi.repository, '@react-email/ui repository')
  const engines = asRecord(reactEmail.engines, 'react-email engines')
  const peers = asRecord(reactEmail.peerDependencies, 'react-email peerDependencies')
  const bin = asRecord(reactEmail.bin, 'react-email bin')
  const exports = asRecord(reactEmail.exports, 'react-email exports')
  const importExport = asRecord(exports.import, 'react-email import export')
  if (reactEmail.version !== '6.9.1'
    || repository.url !== 'https://github.com/resend/react-email.git'
    || repository.directory !== 'packages/react-email'
    || engines.node !== '>=20.0.0'
    || peers.react !== '^18.0 || ^19.0 || ^19.0.0-rc'
    || peers['react-dom'] !== '^18.0 || ^19.0 || ^19.0.0-rc'
    || bin.email !== './dist/cli/index.mjs'
    || importExport.types !== './dist/index.d.mts'
    || importExport.default !== './dist/index.mjs') {
    throw new Error('FUMA-041 react-email package metadata mismatch')
  }
  if (reactEmailUi.version !== '6.9.1'
    || uiRepository.url !== 'https://github.com/resend/react-email.git'
    || uiRepository.directory !== 'packages/ui') {
    throw new Error('FUMA-041 @react-email/ui package metadata mismatch')
  }
  const versions = {
    reactEmail: String(reactEmail.version),
    reactEmailUi: String(reactEmailUi.version),
    react: String(react.version),
    reactDom: String(reactDom.version),
  }
  if (versions.react !== FUMA_EMAIL_PROVEN_RUNTIME.react
    || versions.reactDom !== FUMA_EMAIL_PROVEN_RUNTIME.reactDom) {
    throw new Error('FUMA-041 React package metadata mismatch')
  }
  return versions
}

export async function assertOfficialEmailApi(): Promise<FumaEmailArchitectureEvidence['api']> {
  const reactEmail = await import('react-email')
  const components = [
    'Body', 'Button', 'Column', 'Container', 'Head', 'Heading', 'Hr', 'Html', 'Img', 'Link',
    'Preview', 'Row', 'Section', 'Text',
  ] as const
  const isOfficialComponent = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const component = value as { $$typeof?: unknown; render?: unknown }
    return typeof component.$$typeof === 'symbol'
      && String(component.$$typeof) === 'Symbol(react.forward_ref)'
      && typeof component.render === 'function'
  }
  if (typeof reactEmail.render !== 'function'
    || components.some((component) => !isOfficialComponent(reactEmail[component]))) {
    throw new Error('FUMA-041 official unified API surface mismatch')
  }
  return { render: 'function', components: [...components], cliBin: './dist/cli/index.mjs' }
}

export function parseArchitectureEvidence(value: unknown): FumaEmailArchitectureEvidence {
  return Value.Parse(FumaEmailArchitectureEvidenceSchema, value)
}

export async function parseAndVerifyNativeReceipt(
  value: unknown,
  options: Readonly<{ verifyCurrentSource?: boolean }> = {},
): Promise<FumaEmailNativeReceipt> {
  const receipt = Value.Parse(FumaEmailNativeReceiptSchema, value)
  if (receipt.target.platform !== receipt.host.platform || receipt.target.arch !== receipt.host.arch) {
    throw new Error('FUMA-041 receipt target is not bound to its native host')
  }
  const matrixTarget = FUMA_EMAIL_ARCHITECTURE_MATRIX.find(
    ({ platform, arch }) => platform === receipt.target.platform && arch === receipt.target.arch,
  )
  if (matrixTarget === undefined) throw new Error('FUMA-041 receipt target is outside the matrix')
  if (receipt.compatibilityTests.passed !== 9 || receipt.compatibilityTests.skipped !== 1
    || receipt.rendererArchitectureTests.passed !== 12 || receipt.rendererArchitectureTests.skipped !== 0) {
    throw new Error('FUMA-041 receipt focused test counts mismatch')
  }
  if (options.verifyCurrentSource !== false) {
    const current = await collectEmailCompatibilitySourceEvidence()
    if (receipt.rootLockSha256 !== current.rootLockSha256
      || receipt.sourceSha256 !== current.sourceSha256
      || stableSourceDigest(receipt.sourceFiles) !== current.sourceSha256
      || JSON.stringify(receipt.sourceFiles) !== JSON.stringify(current.sourceFiles)) {
      throw new Error('FUMA-041 receipt does not bind to the current exact source')
    }
  }
  return receipt
}

export async function writeNativeReceipt(path: string, receipt: FumaEmailNativeReceipt): Promise<void> {
  await parseAndVerifyNativeReceipt(receipt)
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`
  await Bun.write(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { createPath: true })
  await rename(temporaryPath, absolutePath)
  const persisted = await Bun.file(absolutePath).json()
  await parseAndVerifyNativeReceipt(persisted)
}
