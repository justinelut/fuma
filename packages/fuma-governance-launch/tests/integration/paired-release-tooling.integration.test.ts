import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { hashPairedReleaseFile } from '../../src'
import { runPairedReleaseRepositoryDemo } from '../../tooling/pairedReleaseDemo'
import { RuntimeSmokeSchema, evidenceDirectoryHash, main } from '../../tooling/pairedRelease'

const ROOT = resolve(import.meta.dir, '../../../..')
const sourceSha = 'a'.repeat(40)
const migrationHighWaterMark = '000044_publication_lifecycle_metadata'
const images = {
  runtime: `ghcr.io/corebunch/fuma-runtime@sha256:${'b'.repeat(64)}`,
  web: `ghcr.io/corebunch/fuma-web@sha256:${'c'.repeat(64)}`,
  'site-runtime': `ghcr.io/corebunch/fuma-site-runtime@sha256:${'d'.repeat(64)}`,
} as const
const tempRoots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fuma-078-release-'))
  tempRoots.push(root)
  const smokeDirectories = {
    runtime: join(root, 'runtime-smoke'),
    web: join(root, 'web-smoke'),
    'site-runtime': join(root, 'site-runtime-smoke'),
  } as const
  await Promise.all(Object.values(smokeDirectories).map((path) => mkdir(path)))
  const lockHashSha256 = hashPairedReleaseFile(await readFile(join(ROOT, 'bun.lock')))
  const identity = { schemaVersion: 2, sourceSha, lockHashSha256, migrationHighWaterMark, platform: 'linux/arm64', nonRoot: true } as const
  const roles = (['web', 'worker', 'scheduler'] as const).map((role) => ({
    role,
    health: { service: 'fuma', topology: 'pooled', role, state: 'ready', ownedComponents: [`${role}-runtime`], inFlight: 0 },
    logsSha256: 'e'.repeat(64),
  }))
  await Promise.all([
    writeFile(join(smokeDirectories.runtime, 'arm64.json'), JSON.stringify({
      ...identity,
      image: images.runtime,
      roles,
      migrationCommand: '000045_release_smoke',
      emailRenderer: { passed: true, platform: 'linux', arch: 'arm64', bun: '1.3.14', versions: { react: '19.2.5' }, htmlSha256: 'e'.repeat(64), textSha256: 'f'.repeat(64) },
    })),
    writeFile(join(smokeDirectories.web, 'arm64.json'), JSON.stringify({
      ...identity,
      image: images.web,
      response: { status: 200, bytes: 42, bodySha256: '1'.repeat(64) },
      logsSha256: '2'.repeat(64),
      acceptanceScope: 'container-http-liveness-not-browser-or-public-host',
    })),
    writeFile(join(smokeDirectories['site-runtime'], 'arm64.json'), JSON.stringify({
      ...identity,
      image: images['site-runtime'],
      response: { status: 404, bytes: 42, bodySha256: '3'.repeat(64) },
      logsSha256: '4'.repeat(64),
      directOriginDenied: true,
      acceptanceScope: 'container-http-liveness-and-direct-origin-denial-not-browser-or-public-host',
    })),
  ])

  const paths = new Map<string, string>()
  for (const component of ['runtime', 'web', 'site-runtime'] as const) {
    for (const suffix of ['digest', 'source-sha', 'index.json', 'trivy.sarif', 'spdx.json', 'provenance.json', 'signature.json'] as const) {
      paths.set(`${component}-${suffix}`, join(root, `${component}.${suffix}`))
    }
  }
  const ociIndex = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'5'.repeat(64)}`, size: 1, platform: { os: 'linux', architecture: 'arm64' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'6'.repeat(64)}`, size: 1, platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
    ],
  })
  const sarif = (image: string) => JSON.stringify({
    version: '2.1.0',
    properties: { fuma: { schemaVersion: 1, image, sourceSha, platform: 'linux/arm64', scanner: 'trivy', severity: ['HIGH', 'CRITICAL'], ignoreUnfixed: false, passed: true } },
    runs: [{ tool: { driver: { name: 'Trivy' } }, results: [] }],
  })
  const spdx = JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', documentNamespace: 'https://example.test/sbom', packages: [{ SPDXID: 'SPDXRef-Package', name: 'fixture' }] })
  const provenance = (image: string) => JSON.stringify([{ predicateType: 'https://slsa.dev/provenance/v1', subject: [
    { name: `${image.split('@')[0]}?platform=linux/arm64`, digest: { sha256: '5'.repeat(64) } },
  ], predicate: { buildDefinition: { externalParameters: { sourceSha } } } }])
  const signature = (image: string) => JSON.stringify([{ critical: { identity: { 'docker-reference': image.split('@')[0] }, image: { 'docker-manifest-digest': image.split('@')[1] }, type: 'cosign container image signature' } }])
  for (const component of ['runtime', 'web', 'site-runtime'] as const) {
    await Promise.all([
      writeFile(paths.get(`${component}-digest`)!, `${images[component]}\n`),
      writeFile(paths.get(`${component}-source-sha`)!, `${sourceSha}\n`),
      writeFile(paths.get(`${component}-index.json`)!, ociIndex),
      writeFile(paths.get(`${component}-trivy.sarif`)!, sarif(images[component])),
      writeFile(paths.get(`${component}-spdx.json`)!, spdx),
      writeFile(paths.get(`${component}-provenance.json`)!, provenance(images[component])),
      writeFile(paths.get(`${component}-signature.json`)!, signature(images[component])),
    ])
  }
  const publicationPlan = join(root, 'publication-plan.json')
  await writeFile(publicationPlan, JSON.stringify({
    schemaVersion: 2,
    sourceSha,
    runtimeImage: images.runtime,
    webImage: images.web,
    siteRuntimeImage: images['site-runtime'],
    architectures: ['linux/arm64'],
    state: 'registry-published-unpromoted',
    promotionAuthority: 'external-fuma-079-or-later',
    partialPublicationPolicy: 'orphan-non-promotable',
    rollbackPolicy: 'retain-last-known-good-digests',
    previousPairedReleaseManifestHashSha256: null,
    registryDeletionPlanned: false,
    deploymentMutationPerformed: false,
  }))

  const evidenceArgs = [
    ...(['runtime', 'web', 'site-runtime'] as const).flatMap((component) => [
      `--${component}-index=${paths.get(`${component}-index.json`)}`,
      `--${component}-scan=${paths.get(`${component}-trivy.sarif`)}`,
      `--${component}-sbom=${paths.get(`${component}-spdx.json`)}`,
      `--${component}-provenance=${paths.get(`${component}-provenance.json`)}`,
      `--${component}-signature-verification=${paths.get(`${component}-signature.json`)}`,
      `--${component}-smoke-dir=${smokeDirectories[component]}`,
    ]),
    `--publication-plan=${publicationPlan}`,
  ]
  const args = (output: string) => [
    `--source-sha=${sourceSha}`,
    `--lock-file=${join(ROOT, 'bun.lock')}`,
    `--migration-high-water=${migrationHighWaterMark}`,
    ...(['runtime', 'web', 'site-runtime'] as const).flatMap((component) => [
      `--${component}-digest-file=${paths.get(`${component}-digest`)}`,
      `--${component}-source-sha-file=${paths.get(`${component}-source-sha`)}`,
    ]),
    ...evidenceArgs,
    `--output=${output}`,
  ]
  return { root, lockHashSha256, paths, smokeDirectories, publicationPlan, evidenceArgs, args }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('FUMA-078 native ARM64 paired release tooling', () => {
  it('creates and fully verifies exact immutable bytes without overwriting an existing release', async () => {
    const value = await fixture()
    const output = join(value.root, 'paired-release.json')
    await main(value.args(output))
    const [manifestBefore, digestBefore] = await Promise.all([readFile(output), readFile(`${output}.sha256`)])
    await main([`--verify=${output}`])
    await main([`--verify=${output}`, '--evidence=full', ...value.evidenceArgs])
    await writeFile(value.paths.get('site-runtime-trivy.sarif')!, `${await readFile(value.paths.get('site-runtime-trivy.sarif')!, 'utf8')}\n`)
    await expect(main([`--verify=${output}`, '--evidence=full', ...value.evidenceArgs])).rejects.toThrow('evidence hash mismatch')
    await expect(main(value.args(output))).rejects.toThrow()
    expect(await readFile(output)).toEqual(manifestBefore)
    expect(await readFile(`${output}.sha256`)).toEqual(digestBefore)
  })

  it('removes a newly-created manifest if sidecar creation fails and preserves the collision', async () => {
    const value = await fixture()
    const output = join(value.root, 'sidecar-collision.json')
    await writeFile(`${output}.sha256`, 'operator-owned\n')
    await expect(main(value.args(output))).rejects.toThrow()
    expect(await Bun.file(output).exists()).toBe(false)
    expect(await Bun.file(`${output}.sha256`).text()).toBe('operator-owned\n')
  })

  it('rejects mixed identity, extra architecture records, and non-ARM64 OCI descriptors', async () => {
    const value = await fixture()
    await expect(evidenceDirectoryHash(value.smokeDirectories.runtime, RuntimeSmokeSchema, sourceSha, '9'.repeat(64), migrationHighWaterMark, images.runtime)).rejects.toThrow('Lock hash mismatch')
    await writeFile(join(value.smokeDirectories.runtime, 'amd64.json'), '{}')
    await expect(evidenceDirectoryHash(value.smokeDirectories.runtime, RuntimeSmokeSchema, sourceSha, value.lockHashSha256, migrationHighWaterMark, images.runtime)).rejects.toThrow('only arm64.json')
    await rm(join(value.smokeDirectories.runtime, 'amd64.json'))
    await writeFile(value.paths.get('site-runtime-source-sha')!, `${'9'.repeat(40)}\n`)
    await expect(main(value.args(join(value.root, 'mixed.json')))).rejects.toThrow('source revisions must match')

    const architecture = await fixture()
    const indexPath = architecture.paths.get('web-index.json')!
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as { manifests: unknown[] }
    index.manifests.unshift({ digest: `sha256:${'7'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } })
    await writeFile(indexPath, JSON.stringify(index))
    await expect(main(architecture.args(join(architecture.root, 'amd64.json')))).rejects.toThrow('non-ARM64')
  })

  it('rejects malformed protected evidence and promoting or destructive plans', async () => {
    const value = await fixture()
    await writeFile(value.paths.get('runtime-trivy.sarif')!, JSON.stringify({ version: '2.1.0', runs: [] }))
    await expect(main(value.args(join(value.root, 'bad-scan.json')))).rejects.toThrow('non-empty SARIF')

    const repaired = await fixture()
    const plan = JSON.parse(await readFile(repaired.publicationPlan, 'utf8')) as Record<string, unknown>
    plan.registryDeletionPlanned = true
    await writeFile(repaired.publicationPlan, JSON.stringify(plan))
    await expect(main(repaired.args(join(repaired.root, 'destructive-plan.json')))).rejects.toThrow('Invalid publication plan')
  })

  it('runs a deterministic repository-only rejection demo', () => {
    expect(runPairedReleaseRepositoryDemo()).toMatchObject({
      mode: 'deterministic-repository-only',
      externalEvidence: false,
      architecture: 'linux/arm64',
      imageCount: 3,
      rejected: { mixedSha: true, duplicateDigest: true, wrongArchitecture: true, tamper: true },
    })
  })
})
