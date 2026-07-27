import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { hashPairedReleaseFile } from '../../src'
import {
  RuntimeSmokeSchema,
  evidenceDirectoryHash,
  main,
} from '../../tooling/pairedRelease'

const ROOT = resolve(import.meta.dir, '../../../..')
const sourceSha = 'a'.repeat(40)
const migrationHighWaterMark = '000044_publication_lifecycle_metadata'
const runtimeImage = `ghcr.io/corebunch/fuma-runtime@sha256:${'b'.repeat(64)}`
const webImage = `ghcr.io/corebunch/fuma-web@sha256:${'c'.repeat(64)}`
const tempRoots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fuma-078-release-'))
  tempRoots.push(root)
  const runtimeSmoke = join(root, 'runtime-smoke')
  const webSmoke = join(root, 'web-smoke')
  await Promise.all([mkdir(runtimeSmoke), mkdir(webSmoke)])
  const lockHashSha256 = hashPairedReleaseFile(await readFile(join(ROOT, 'bun.lock')))

  for (const [arch, platform, emailArch] of [
    ['amd64', 'linux/amd64', 'x64'],
    ['arm64', 'linux/arm64', 'arm64'],
  ] as const) {
    const roles = (['web', 'worker', 'scheduler'] as const).map((role) => ({
      role,
      health: {
        service: 'fuma',
        topology: 'pooled',
        role,
        state: 'ready',
        ownedComponents: [`${role}-runtime`],
        inFlight: 0,
      },
      logsSha256: 'd'.repeat(64),
    }))
    await writeFile(join(runtimeSmoke, `${arch}.json`), JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      lockHashSha256,
      migrationHighWaterMark,
      platform,
      image: runtimeImage,
      nonRoot: true,
      roles,
      migrationCommand: '000045_release_smoke',
      emailRenderer: {
        passed: true,
        platform: 'linux',
        arch: emailArch,
        bun: '1.3.14',
        versions: { react: '19.2.5' },
        htmlSha256: 'e'.repeat(64),
        textSha256: 'f'.repeat(64),
      },
    }))
    await writeFile(join(webSmoke, `${arch}.json`), JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      lockHashSha256,
      migrationHighWaterMark,
      platform,
      image: webImage,
      nonRoot: true,
      response: { status: 200, bytes: 42, bodySha256: '1'.repeat(64) },
      logsSha256: '2'.repeat(64),
      acceptanceScope: 'container-http-liveness-not-browser-or-public-host',
    }))
  }

  const files = {
    runtimeDigest: join(root, 'runtime.digest'),
    runtimeSource: join(root, 'runtime.source'),
    webDigest: join(root, 'web.digest'),
    webSource: join(root, 'web.source'),
    runtimeIndex: join(root, 'runtime.index.json'),
    webIndex: join(root, 'web.index.json'),
    runtimeScan: join(root, 'runtime.trivy.sarif'),
    webScan: join(root, 'web.trivy.sarif'),
    runtimeSbom: join(root, 'runtime.spdx.json'),
    webSbom: join(root, 'web.spdx.json'),
    runtimeProvenance: join(root, 'runtime.provenance.json'),
    webProvenance: join(root, 'web.provenance.json'),
    runtimeSignature: join(root, 'runtime.signature.json'),
    webSignature: join(root, 'web.signature.json'),
    publicationPlan: join(root, 'publication-plan.json'),
  }
  const ociIndex = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'3'.repeat(64)}`, size: 1, platform: { os: 'linux', architecture: 'amd64' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'4'.repeat(64)}`, size: 1, platform: { os: 'linux', architecture: 'arm64' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'5'.repeat(64)}`, size: 1, platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${'6'.repeat(64)}`, size: 1, platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
    ],
  })
  const sarif = (image: string) => JSON.stringify({
    version: '2.1.0',
    properties: { fuma: { schemaVersion: 1, image, sourceSha, scanner: 'trivy', severity: ['HIGH', 'CRITICAL'], ignoreUnfixed: false, passed: true } },
    runs: [{ tool: { driver: { name: 'Trivy' } }, results: [] }],
  })
  const spdx = JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', documentNamespace: 'https://example.test/sbom', packages: [{ SPDXID: 'SPDXRef-Package', name: 'fixture' }] })
  const provenance = (image: string) => JSON.stringify([{ predicateType: 'https://slsa.dev/provenance/v1', subject: [
    { name: `${image.split('@')[0]}?platform=linux/amd64`, digest: { sha256: '3'.repeat(64) } },
    { name: `${image.split('@')[0]}?platform=linux/arm64`, digest: { sha256: '4'.repeat(64) } },
  ], predicate: { buildDefinition: { externalParameters: { sourceSha } } } }])
  const signature = (image: string) => JSON.stringify([{ critical: { identity: { 'docker-reference': image.split('@')[0] }, image: { 'docker-manifest-digest': image.split('@')[1] }, type: 'cosign container image signature' } }])
  await Promise.all([
    writeFile(files.runtimeDigest, `${runtimeImage}\n`),
    writeFile(files.runtimeSource, `${sourceSha}\n`),
    writeFile(files.webDigest, `${webImage}\n`),
    writeFile(files.webSource, `${sourceSha}\n`),
    writeFile(files.runtimeIndex, ociIndex),
    writeFile(files.webIndex, ociIndex),
    writeFile(files.runtimeScan, sarif(runtimeImage)),
    writeFile(files.webScan, sarif(webImage)),
    writeFile(files.runtimeSbom, spdx),
    writeFile(files.webSbom, spdx),
    writeFile(files.runtimeProvenance, provenance(runtimeImage)),
    writeFile(files.webProvenance, provenance(webImage)),
    writeFile(files.runtimeSignature, signature(runtimeImage)),
    writeFile(files.webSignature, signature(webImage)),
    writeFile(files.publicationPlan, JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      runtimeImage,
      webImage,
      architectures: ['linux/amd64', 'linux/arm64'],
      state: 'registry-published-unpromoted',
      promotionAuthority: 'external-fuma-079-or-later',
      partialPublicationPolicy: 'orphan-non-promotable',
      rollbackPolicy: 'retain-last-known-good-digests',
      previousPairedReleaseManifestHashSha256: null,
      registryDeletionPlanned: false,
      deploymentMutationPerformed: false,
    })),
  ])

  const evidenceArgs = [
    `--runtime-index=${files.runtimeIndex}`,
    `--web-index=${files.webIndex}`,
    `--runtime-scan=${files.runtimeScan}`,
    `--web-scan=${files.webScan}`,
    `--runtime-sbom=${files.runtimeSbom}`,
    `--web-sbom=${files.webSbom}`,
    `--runtime-provenance=${files.runtimeProvenance}`,
    `--web-provenance=${files.webProvenance}`,
    `--runtime-signature-verification=${files.runtimeSignature}`,
    `--web-signature-verification=${files.webSignature}`,
    `--runtime-smoke-dir=${runtimeSmoke}`,
    `--web-smoke-dir=${webSmoke}`,
    `--publication-plan=${files.publicationPlan}`,
  ]
  const args = (output: string) => [
    `--source-sha=${sourceSha}`,
    `--lock-file=${join(ROOT, 'bun.lock')}`,
    `--migration-high-water=${migrationHighWaterMark}`,
    `--runtime-digest-file=${files.runtimeDigest}`,
    `--runtime-source-sha-file=${files.runtimeSource}`,
    `--web-digest-file=${files.webDigest}`,
    `--web-source-sha-file=${files.webSource}`,
    `--runtime-index=${files.runtimeIndex}`,
    `--web-index=${files.webIndex}`,
    `--runtime-scan=${files.runtimeScan}`,
    `--web-scan=${files.webScan}`,
    `--runtime-sbom=${files.runtimeSbom}`,
    `--web-sbom=${files.webSbom}`,
    `--runtime-provenance=${files.runtimeProvenance}`,
    `--web-provenance=${files.webProvenance}`,
    `--runtime-signature-verification=${files.runtimeSignature}`,
    `--web-signature-verification=${files.webSignature}`,
    `--runtime-smoke-dir=${runtimeSmoke}`,
    `--web-smoke-dir=${webSmoke}`,
    `--publication-plan=${files.publicationPlan}`,
    `--output=${output}`,
  ]
  return { root, runtimeSmoke, lockHashSha256, files, evidenceArgs, args }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('FUMA-078 paired release tooling', () => {
  it('creates and verifies exact immutable bytes without overwriting an existing release', async () => {
    const value = await fixture()
    const output = join(value.root, 'paired-release.json')
    await main(value.args(output))
    const [manifestBefore, digestBefore] = await Promise.all([
      readFile(output),
      readFile(`${output}.sha256`),
    ])

    await main([`--verify=${output}`])
    await main([`--verify=${output}`, '--evidence=full', ...value.evidenceArgs])
    await writeFile(value.files.runtimeScan, `${await readFile(value.files.runtimeScan, 'utf8')}\n`)
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

  it('rejects mixed identity and anything beyond the exact two architecture records', async () => {
    const value = await fixture()
    await expect(evidenceDirectoryHash(
      value.runtimeSmoke,
      RuntimeSmokeSchema,
      sourceSha,
      '9'.repeat(64),
      migrationHighWaterMark,
      runtimeImage,
    )).rejects.toThrow('Lock hash mismatch')

    await writeFile(join(value.runtimeSmoke, 'notes.txt'), 'not evidence')
    await expect(evidenceDirectoryHash(
      value.runtimeSmoke,
      RuntimeSmokeSchema,
      sourceSha,
      value.lockHashSha256,
      migrationHighWaterMark,
      runtimeImage,
    )).rejects.toThrow('must contain only amd64.json and arm64.json')

    await rm(join(value.runtimeSmoke, 'notes.txt'))
    await writeFile(value.files.runtimeSource, `${'9'.repeat(40)}\n`)
    await expect(main(value.args(join(value.root, 'mixed.json')))).rejects.toThrow('source revisions must match')
  })

  it('rejects malformed published evidence and promoting or destructive publication plans', async () => {
    const value = await fixture()
    await writeFile(value.files.runtimeScan, JSON.stringify({ version: '2.1.0', runs: [] }))
    await expect(main(value.args(join(value.root, 'bad-scan.json')))).rejects.toThrow('non-empty SARIF')

    const repaired = await fixture()
    const plan = JSON.parse(await readFile(repaired.files.publicationPlan, 'utf8')) as Record<string, unknown>
    plan.registryDeletionPlanned = true
    await writeFile(repaired.files.publicationPlan, JSON.stringify(plan))
    await expect(main(repaired.args(join(repaired.root, 'destructive-plan.json')))).rejects.toThrow('Invalid publication plan')

    const wrongProvenance = await fixture()
    await writeFile(wrongProvenance.files.runtimeProvenance, JSON.stringify([{ predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: '9'.repeat(64) } }], predicate: { sourceSha } }]))
    await expect(main(wrongProvenance.args(join(wrongProvenance.root, 'wrong-provenance.json')))).rejects.toThrow('both runnable OCI platform digests')
  })
})
