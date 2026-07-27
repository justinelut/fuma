import { readFile } from 'node:fs/promises'
import { authorizePromotion, verifyPairedRelease, verifyPublicWebDeploymentSeam } from '../../../packages/fuma-governance-launch/src/index'

if (!process.argv.includes('--dry-run')) throw new Error('Promotion planning is dry-run only. Deployment execution belongs to the externally approved release controller.')

function option(name: string): string {
  const value = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (!value) throw new Error(`--${name}=<path> is required.`)
  return value
}

const release = verifyPairedRelease(JSON.parse(await readFile(option('release'), 'utf8')))
const smoke = JSON.parse(await readFile(option('promotion-evidence'), 'utf8'))
const seam = JSON.parse(await readFile(option('public-web-seam'), 'utf8'))
authorizePromotion(release, smoke)
verifyPublicWebDeploymentSeam(seam, release)

const plan = {
  schemaVersion: 1,
  mode: 'dry-run',
  releaseSourceSha: release.sourceSha,
  migrationHighWaterMark: release.migrationHighWaterMark,
  externalMutations: [],
  phases: [
    { order: 1, name: 'pre-migration-backup', gate: 'current encrypted off-host backup and separate key recovery' },
    { order: 2, name: 'serialized-migration', gate: 'suspended 000035..000039 job, advisory lock, immutable checksums' },
    { order: 3, name: 'runtime-staff-canary', gate: 'RED/USE, host/session isolation, queue and provider evidence' },
    { order: 4, name: 'public-web-canary', percent: seam.canaryPercent, gate: 'Blyss HTTPS browser, contract, WCAG, Web Vitals and conversion evidence' },
    { order: 5, name: 'bounded-customer-cohorts', gate: 'objective abort thresholds and named incident command' },
  ],
  rollback: {
    publicWeb: 'restore previous public Web digest and dataset only; product and tenant digests remain unchanged',
    runtime: 'restore previous compatible runtime digest or invoke approved restore; never reverse forward schema',
  },
}
console.log(JSON.stringify(plan, null, 2))
