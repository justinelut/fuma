import { createHash } from 'node:crypto'
import { renderSystemNotice } from './renderFixture'
import {
  assertExactEmailPackageAuthority,
  assertOfficialEmailApi,
  collectEmailCompatibilitySourceEvidence,
  parseArchitectureEvidence,
  readAndAssertEmailPackageMetadata,
} from './evidence'
import {
  assertSupportedEmailCompatibility,
  FUMA_EMAIL_EXPECTED_OUTPUT_SHA256,
} from './versions'

const expectedPlatform = process.env.FUMA_EMAIL_EXPECT_PLATFORM
const expectedArch = process.env.FUMA_EMAIL_EXPECT_ARCH

if (expectedPlatform === undefined || expectedArch === undefined) {
  throw new Error('FUMA-041 architecture probe requires FUMA_EMAIL_EXPECT_PLATFORM and FUMA_EMAIL_EXPECT_ARCH')
}
if (process.platform !== expectedPlatform || process.arch !== expectedArch) {
  throw new Error(
    `FUMA-041 architecture mismatch: expected ${expectedPlatform}/${expectedArch}, received ${process.platform}/${process.arch}`,
  )
}

await assertExactEmailPackageAuthority()
const [versions, api, source] = await Promise.all([
  readAndAssertEmailPackageMetadata(),
  assertOfficialEmailApi(),
  collectEmailCompatibilitySourceEvidence(),
])

assertSupportedEmailCompatibility({
  ...versions,
  bun: Bun.version,
  platform: process.platform,
  arch: process.arch,
})

const first = await renderSystemNotice()
const second = await renderSystemNotice()
if (first.html !== second.html || first.text !== second.text) {
  throw new Error('FUMA-041 render output is not deterministic')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const htmlSha256 = sha256(first.html)
const textSha256 = sha256(first.text)
if (htmlSha256 !== FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.html) {
  throw new Error(`FUMA-041 HTML snapshot mismatch ${htmlSha256}`)
}
if (textSha256 !== FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.text) {
  throw new Error(`FUMA-041 plaintext snapshot mismatch ${textSha256}`)
}

const evidence = parseArchitectureEvidence({
  schemaVersion: 3,
  tickets: ['FUMA-041', 'FUMA-042'],
  passed: true,
  execution: 'native',
  target: { platform: expectedPlatform, arch: expectedArch },
  host: { platform: process.platform, arch: process.arch },
  bun: Bun.version,
  versions,
  ...source,
  api,
  htmlSha256,
  textSha256,
})

console.log(JSON.stringify(evidence))
