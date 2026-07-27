#!/usr/bin/env bun
import { resolve } from 'node:path'
import { parseAndVerifyNativeReceipt } from '../server/fuma/email/compatibility/evidence'
import { FUMA_EMAIL_ARCHITECTURE_MATRIX } from '../server/fuma/email/compatibility/versions'

const WORKSPACE_ROOT = resolve(import.meta.dir, '../../..')
const targetArgument = process.argv[2]
const receiptPath = process.env.FUMA_EMAIL_RECEIPT_PATH
const aliases = Object.freeze({ arm64: 'arm64', amd64: 'x64' } as const)

if (process.argv.length !== 3 || (targetArgument !== 'arm64' && targetArgument !== 'amd64')) {
  throw new Error('FUMA-041 native matrix requires exactly one target argument: arm64 or amd64')
}
if (receiptPath === undefined || receiptPath.trim() === '') {
  throw new Error('FUMA-041 native matrix requires FUMA_EMAIL_RECEIPT_PATH')
}

const expectedArch = aliases[targetArgument]
const contract = FUMA_EMAIL_ARCHITECTURE_MATRIX.find(({ arch }) => arch === expectedArch)
if (contract === undefined) throw new Error(`FUMA-041 target ${targetArgument} is outside the declared matrix`)
if (process.platform !== contract.platform || process.arch !== contract.arch) {
  throw new Error(
    `FUMA-041 native matrix target mismatch: ${targetArgument} requires ${contract.platform}/${contract.arch}, received ${process.platform}/${process.arch}; run it on ${contract.runner}`,
  )
}

const processHandle = Bun.spawn([
  process.execPath,
  'run',
  'apps/studio/scripts/fuma-email-compatibility-target.ts',
], {
  cwd: WORKSPACE_ROOT,
  env: {
    ...process.env,
    FUMA_EMAIL_EXPECT_PLATFORM: contract.platform,
    FUMA_EMAIL_EXPECT_ARCH: contract.arch,
    FUMA_EMAIL_RECEIPT_PATH: receiptPath,
    NO_COLOR: '1',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})
let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  processHandle.kill('SIGKILL')
}, 1_200_000)
const exitCode = await processHandle.exited.finally(() => clearTimeout(timeout))
if (timedOut) throw new Error('FUMA-041 native matrix timed out after 1200000ms')
if (exitCode !== 0) throw new Error(`FUMA-041 native matrix target failed with exit code ${exitCode}`)

const receipt = await parseAndVerifyNativeReceipt(await Bun.file(receiptPath).json())
if (receipt.target.arch !== contract.arch) {
  throw new Error(`FUMA-041 native matrix receipt arch mismatch: ${receipt.target.arch}`)
}
console.log(`FUMA-041 native ${contract.platform}/${contract.arch} receipt verified: ${resolve(receiptPath)}`)
