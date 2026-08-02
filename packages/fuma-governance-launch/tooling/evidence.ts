import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

if (!process.argv.includes('--dry-run')) throw new Error('Evidence tooling is dry-run only; pass --dry-run. It never deploys or mutates external systems.')

const packageRoot = resolve(import.meta.dir, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const outputRoot = join(repositoryRoot, '.tmp/fuma-evidence')
const excluded = new Set(['node_modules', '.git', '.next', '.tmp'])
const zeroSha256 = '0'.repeat(64)
const zeroSourceRevision = '0'.repeat(40)

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path)
  const nested = await Promise.all(entries.filter((name) => !excluded.has(name)).map(async (name) => {
    const child = join(path, name)
    return (await stat(child)).isDirectory() ? walk(child) : [child]
  }))
  return nested.flat()
}

async function sha256(path: string): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(await readFile(path)).digest('hex')
}

function option(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
}

async function releaseDigests(directory: string | null): Promise<Readonly<Record<string, string>>> {
  if (!directory) return Object.freeze({})
  const absolute = resolve(repositoryRoot, directory)
  const output: Record<string, string> = {}
  for (const name of await readdir(absolute)) {
    if (!name.endsWith('.digest')) continue
    const value = (await readFile(join(absolute, name), 'utf8')).trim()
    if (!/^ghcr\.io\/corebunch\/fuma-[a-z-]+@sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`Digest artifact ${name} is malformed.`)
    output[basename(name, '.digest')] = value
  }
  return Object.freeze(output)
}

const manifestPath = join(packageRoot, 'handoff/phase-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { tickets: readonly { id: string }[] }
const ownedRoots = [packageRoot, join(repositoryRoot, 'apps/control-surfaces'), join(repositoryRoot, 'infra/fuma-phase-13-18')]
const inventory = (await Promise.all(ownedRoots.map(walk))).flat().sort()
const files = await Promise.all(inventory.map(async (path) => ({ path: relative(repositoryRoot, path), sha256: await sha256(path), bytes: (await stat(path)).size })))
const digests = await releaseDigests(option('release-digests'))
const sourceSha = process.env.GITHUB_SHA && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(process.env.GITHUB_SHA) ? process.env.GITHUB_SHA : zeroSourceRevision
const report = {
  schemaVersion: 1,
  mode: 'dry-run',
  state: 'authored-unvalidated',
  generatedAt: new Date().toISOString(),
  tickets: manifest.tickets.map(({ id }) => id),
  fileCount: files.length,
  files,
  releaseCandidate: {
    schemaVersion: 1,
    state: 'unsigned-unvalidated-candidate',
    sourceSha,
    lockHashSha256: await sha256(join(repositoryRoot, 'bun.lock')),
    migrationHighWaterMark: '000039_launch_evidence_privacy',
    runtimeImage: digests.runtime ?? 'ghcr.io/corebunch/fuma-runtime@sha256:' + zeroSha256,
    webImage: digests.web ?? 'ghcr.io/corebunch/fuma-web@sha256:' + zeroSha256,
    siteRuntimeImage: digests['site-runtime'] ?? 'ghcr.io/corebunch/fuma-site-runtime@sha256:' + zeroSha256,
    deploymentArtifacts: {
      controlSurfacesImage: digests['control-surfaces'] ?? 'ghcr.io/corebunch/fuma-control-surfaces@sha256:' + zeroSha256,
      opsImage: digests.ops ?? 'ghcr.io/corebunch/fuma-ops@sha256:' + zeroSha256,
    },
    architectures: ['linux/arm64'],
    sbomHashSha256: zeroSha256,
    provenanceHashSha256: zeroSha256,
    smokeEvidenceHashSha256: zeroSha256,
    promotable: false,
  },
  commandsExecutedByTool: [],
  networkRequests: 0,
  externalMutations: [],
  warnings: [
    'This report is source inventory and an unsigned candidate only, not acceptance evidence.',
    'Zero hashes deliberately keep the candidate non-promotable until signed SBOM, provenance and Blyss HTTPS smoke evidence are attached.',
    'Tests, typechecks, builds, lint, Playwright, Docker, Kubernetes, cloud, DNS, signing, and provider calls are intentionally not run.',
  ],
}
await mkdir(outputRoot, { recursive: true })
await writeFile(join(outputRoot, 'source-inventory.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' })
await writeFile(join(outputRoot, 'paired-release.candidate.json'), `${JSON.stringify(report.releaseCandidate, null, 2)}\n`, { flag: 'w' })
await writeFile(join(outputRoot, 'README.txt'), 'Dry-run source inventory and unsigned candidate only. No validation or external action was performed.\n', { flag: 'w' })
console.log(JSON.stringify({ mode: report.mode, state: report.state, ticketCount: report.tickets.length, fileCount: report.fileCount, output: relative(repositoryRoot, outputRoot) }))
