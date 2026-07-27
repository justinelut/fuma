import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSystemNotice } from './renderFixture'
import {
  assertExactEmailPackageAuthority,
  assertOfficialEmailApi,
  FUMA_EMAIL_EVIDENCE_SOURCE_FILES,
  parseAndVerifyNativeReceipt,
  parseArchitectureEvidence,
  readAndAssertEmailPackageMetadata,
} from './evidence'
import {
  assertSupportedEmailCompatibility,
  FUMA_EMAIL_ARCHITECTURE_MATRIX,
  FUMA_EMAIL_CLI_COMMANDS,
  FUMA_EMAIL_COMPATIBILITY_PACKAGES,
  FUMA_EMAIL_EXPECTED_OUTPUT_SHA256,
  FUMA_EMAIL_PROVEN_BUN_RANGE,
  FUMA_EMAIL_PROVEN_RUNTIME,
  FUMA_EMAIL_REJECTED_PACKAGES,
} from './versions'

const STUDIO_ROOT = new URL('../../../../', import.meta.url).pathname
const WORKSPACE_ROOT = new URL('../../../../../../', import.meta.url).pathname
const EMAILS_DIRECTORY = 'server/fuma/email/compatibility/emails'
const GENERATED_PREVIEW_DIRECTORY = join(STUDIO_ROOT, '.react-email')
const BUILD_PREVIEW_PORT = '30441'

const FUMA_010_EXACT_PINS = Object.freeze({
  '@better-auth/drizzle-adapter': '1.6.25',
  auth: '1.6.25',
  'better-auth': '1.6.25',
  'drizzle-orm': '0.45.2',
  postgres: '3.4.9',
})

afterEach(async () => {
  await rm(GENERATED_PREVIEW_DIRECTORY, { force: true, recursive: true })
})

async function runBun(args: string[], env: Record<string, string | undefined> = process.env) {
  const subprocess = Bun.spawn([process.execPath, ...args], {
    cwd: STUDIO_ROOT,
    env: { ...env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    Bun.readableStreamToText(subprocess.stdout),
    Bun.readableStreamToText(subprocess.stderr),
  ])
  if (exitCode !== 0) {
    throw new Error(`FUMA-041 command failed: bun ${args.join(' ')}\n${stdout}\n${stderr}`)
  }
  return { stdout, stderr }
}

async function runArchitectureProbe(platform: 'linux', arch: 'arm64' | 'x64') {
  return runBun(['run', 'server/fuma/email/compatibility/architectureProbe.ts'], {
    ...process.env,
    FUMA_EMAIL_EXPECT_PLATFORM: platform,
    FUMA_EMAIL_EXPECT_ARCH: arch,
  })
}

async function requestPreview(url: string): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => resolve({ body, status: response.statusCode ?? 0 }))
    })
    request.on('error', reject)
  })
}

async function waitForPreview(url: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await requestPreview(url)
      if (response.status === 200) return response.body
      lastError = new Error(`preview returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(250)
  }
  throw new Error('FUMA-041 preview server did not become ready', { cause: lastError })
}

function terminateProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
    throw error
  }
}

describe('FUMA-041 exact official package selection', () => {
  it('pins registry-verified React Email packages and preserves FUMA-010 pins', async () => {
    await assertExactEmailPackageAuthority()
    const metadataVersions = await readAndAssertEmailPackageMetadata()
    expect(metadataVersions).toEqual({
      reactEmail: '6.9.1',
      reactEmailUi: '6.9.1',
      react: '19.2.5',
      reactDom: '19.2.5',
    })
    const packageJson = await Bun.file(join(STUDIO_ROOT, 'package.json')).json()
    const directDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const lock = await Bun.file(join(WORKSPACE_ROOT, 'bun.lock')).text()

    for (const [name, evidence] of Object.entries(FUMA_EMAIL_COMPATIBILITY_PACKAGES)) {
      expect(directDependencies[name]).toBe(evidence.version)
      expect(lock).toContain(`${name}@${evidence.version}`)
      expect(lock).toContain(evidence.integrity)
      expect(evidence.repository).toStartWith('https://github.com/resend/react-email.git#packages/')
      expect(evidence.os).toBeNull()
      expect(evidence.cpu).toBeNull()
    }
    for (const [name, version] of Object.entries(FUMA_010_EXACT_PINS)) {
      const dependencySet = name === 'auth' ? packageJson.devDependencies : packageJson.dependencies
      expect(dependencySet[name]).toBe(version)
      expect(lock).toContain(`${name}@${version}`)
    }

    expect(packageJson.dependencies['@react-email/components']).toBeUndefined()
    expect(packageJson.dependencies['@react-email/render']).toBeUndefined()
    expect(FUMA_EMAIL_REJECTED_PACKAGES).toEqual({
      '@react-email/components': 'React Email 6 exports components from react-email directly',
      '@react-email/render': 'React Email 6 exports render from react-email directly',
    })
    expect(FUMA_EMAIL_PROVEN_BUN_RANGE).toBe('>=1.3.0 <1.4.0')
    expect(FUMA_EMAIL_PROVEN_RUNTIME).toEqual({
      bun: '1.3.14',
      react: '19.2.5',
      reactDom: '19.2.5',
    })
    const rootPackageJson = await Bun.file(join(WORKSPACE_ROOT, 'package.json')).json()
    expect(rootPackageJson.packageManager).toBe(`bun@${FUMA_EMAIL_PROVEN_RUNTIME.bun}`)
    expect(lock).toContain(`react@${FUMA_EMAIL_PROVEN_RUNTIME.react}`)
    expect(lock).toContain(`react-dom@${FUMA_EMAIL_PROVEN_RUNTIME.reactDom}`)
  })

  it('loads unified components/render APIs and declared CLI commands on Bun with React 19', async () => {
    const [reactEmail, react, reactDomPackage, api, cliHelp] = await Promise.all([
      import('react-email'),
      import('react'),
      import('react-dom/package.json', { with: { type: 'json' } }),
      assertOfficialEmailApi(),
      runBun(['run', 'email', '--help']),
    ])

    expect(reactEmail.Html).toBeTruthy()
    expect(reactEmail.Button).toBeTruthy()
    expect(typeof reactEmail.render).toBe('function')
    expect(api.cliBin).toBe('./dist/cli/index.mjs')
    expect(api.components).toContain('Html')
    expect(react.version).toStartWith('19.')
    expect(reactDomPackage.default.version).toStartWith('19.')
    expect(cliHelp.stdout).toContain('dev [options]     Starts the preview email development app')
    expect(cliHelp.stdout).toContain('build [options]   Copies the preview app')
    expect(cliHelp.stdout).toContain('start             Runs the built preview app')
    expect(cliHelp.stdout).toContain('export [options]')
    expect(FUMA_EMAIL_CLI_COMMANDS).toEqual({
      preview: 'email dev --dir server/fuma/email/compatibility/emails',
      build: 'email build --dir server/fuma/email/compatibility/emails',
      serve: 'email start',
      exportHtml: 'email export --dir server/fuma/email/compatibility/emails',
      exportText: 'email export --dir server/fuma/email/compatibility/emails --plainText',
    })
  })

  it('rejects unselected versions, unsupported hosts, and hostile native target claims', async () => {
    const supported = {
      reactEmail: '6.9.1',
      reactEmailUi: '6.9.1',
      react: '19.2.5',
      reactDom: '19.2.5',
      bun: '1.3.14',
      platform: 'linux' as const,
      arch: 'arm64',
    }

    expect(() => assertSupportedEmailCompatibility(supported)).not.toThrow()
    expect(() => assertSupportedEmailCompatibility({ ...supported, reactEmail: '6.9.0' }))
      .toThrow('unsupported react-email version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, reactEmailUi: '6.9.0' }))
      .toThrow('unsupported @react-email/ui version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, react: '18.3.1' }))
      .toThrow('unsupported React version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, react: '19.2.4' }))
      .toThrow('unsupported React version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, reactDom: '19.2.4' }))
      .toThrow('unsupported React DOM version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, bun: '1.2.23' }))
      .toThrow('unsupported Bun version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, bun: '1.3.13' }))
      .toThrow('unsupported Bun version')
    expect(() => assertSupportedEmailCompatibility({ ...supported, arch: 'riscv64' }))
      .toThrow('unsupported host linux/riscv64')
    expect(() => assertSupportedEmailCompatibility({ ...supported, platform: 'darwin' }))
      .toThrow('unsupported host darwin/arm64')

    const oppositeArch = process.arch === 'arm64' ? 'x64' : 'arm64'
    await expect(runArchitectureProbe('linux', oppositeArch)).rejects
      .toThrow(`architecture mismatch: expected linux/${oppositeArch}`)
    const targetAlias = process.arch === 'arm64' ? 'amd64' : 'arm64'
    await expect(runBun(['run', 'scripts/fuma-email-compatibility-matrix.ts', targetAlias], {
      ...process.env,
      FUMA_EMAIL_RECEIPT_PATH: join(tmpdir(), 'hostile-fuma041-receipt.json'),
    })).rejects.toThrow('native matrix target mismatch')
  })
})

describe('FUMA-041 deterministic render and representative client markup', () => {
  it('matches committed HTML and plaintext snapshots byte-for-byte', async () => {
    const [{ html, text }, expectedHtml, expectedText] = await Promise.all([
      renderSystemNotice(),
      Bun.file(new URL('./snapshots/systemNotice.html', import.meta.url)).text(),
      Bun.file(new URL('./snapshots/systemNotice.txt', import.meta.url)).text(),
    ])

    expect(html).toBe(expectedHtml)
    expect(text).toBe(expectedText)
    expect(new Bun.CryptoHasher('sha256').update(html).digest('hex'))
      .toBe(FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.html)
    expect(new Bun.CryptoHasher('sha256').update(text).digest('hex'))
      .toBe(FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.text)
  })

  it('emits layout, Outlook, preheader, image, and link constraints without active content', async () => {
    const { html, text } = await renderSystemNotice()

    expect(html).toStartWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"')
    expect(html).toContain('<meta name="x-apple-disable-message-reformatting"/>')
    expect(html).toContain('role="presentation"')
    expect(html).toContain('cellPadding="0" cellSpacing="0"')
    expect(html).toContain('max-width:600px')
    expect(html).toContain('data-skip-in-text="true"')
    expect(html).toContain('<!--[if mso]>')
    expect(html).toContain('mso-text-raise:9px')
    expect(html).toContain('src="https://cdn.fuma.invalid/email/logo.png"')
    expect(html).toContain('alt="Fuma" height="32"')
    expect(html).toContain('href="https://app.fuma.invalid/notices/notice_041"')
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(text).not.toContain('<table')
    expect(text).toContain('Review workspace https://app.fuma.invalid/notices/notice_041')
  })

  it('exports the same HTML and plaintext through the Bun-invoked official CLI', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'fuma041-export-'))
    const htmlDirectory = join(temporaryDirectory, 'html')
    const textDirectory = join(temporaryDirectory, 'text')
    try {
      await runBun(['run', 'email', 'export', '--dir', EMAILS_DIRECTORY, '--outDir', htmlDirectory])
      await runBun([
        'run', 'email', 'export', '--dir', EMAILS_DIRECTORY, '--outDir', textDirectory, '--plainText',
      ])
      const [{ html, text }, exportedHtml, exportedText] = await Promise.all([
        renderSystemNotice(),
        Bun.file(join(htmlDirectory, 'systemNotice.html')).text(),
        Bun.file(join(textDirectory, 'systemNotice.txt')).text(),
      ])
      expect(exportedHtml).toBe(html)
      expect(exportedText).toBe(text)
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  }, 180_000)
})

it.skipIf(process.platform !== 'linux' || process.arch !== 'arm64')(
  'FUMA-041 Linux ARM64 matrix gate renders the exact snapshots from the exact lockfile',
  async () => {
    const { stdout } = await runArchitectureProbe('linux', 'arm64')
    expect(stdout).toContain('"passed":true')
    expect(stdout).toContain('"platform":"linux"')
    expect(stdout).toContain('"arch":"arm64"')
    expect(stdout).toContain(`"htmlSha256":"${FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.html}"`)
    expect(stdout).toContain(`"textSha256":"${FUMA_EMAIL_EXPECTED_OUTPUT_SHA256.text}"`)
  },
  60_000,
)

it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(
  'FUMA-041 Linux amd64 matrix gate renders the exact snapshots from the exact lockfile',
  async () => {
    const { stdout } = await runArchitectureProbe('linux', 'x64')
    expect(stdout).toContain('"passed":true')
    expect(stdout).toContain('"platform":"linux"')
    expect(stdout).toContain('"arch":"x64"')
  },
  60_000,
)

it('publishes deterministic native matrix, receipt, workflow, and explicit skip contracts', async () => {
  expect(FUMA_EMAIL_ARCHITECTURE_MATRIX).toEqual([
    {
      platform: 'linux',
      arch: 'arm64',
      artifact: 'fuma-email-compatibility-linux-arm64.json',
      runner: 'ubuntu-24.04-arm',
      probe: 'FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=arm64 bun run server/fuma/email/compatibility/architectureProbe.ts',
      nativeGate: 'FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-arm64.json bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts arm64',
    },
    {
      platform: 'linux',
      arch: 'x64',
      artifact: 'fuma-email-compatibility-linux-amd64.json',
      runner: 'ubuntu-24.04',
      probe: 'FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=x64 bun run server/fuma/email/compatibility/architectureProbe.ts',
      nativeGate: 'FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-amd64.json bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts amd64',
    },
  ])

  const [workflow, matrixScript, testSource] = await Promise.all([
    Bun.file(join(WORKSPACE_ROOT, '.github/workflows/fuma-email-compatibility.yml')).text(),
    Bun.file(join(STUDIO_ROOT, 'scripts/fuma-email-compatibility-matrix.ts')).text(),
    Bun.file(import.meta.path).text(),
  ])
  expect(workflow).toContain('runner: ubuntu-24.04')
  expect(workflow).toContain('runner: ubuntu-24.04-arm')
  expect(workflow).toContain('FUMA_EMAIL_RECEIPT_PATH:')
  expect(workflow).toContain('actions/upload-artifact@v4.6.2')
  expect(workflow).not.toContain('docker')
  expect(matrixScript).not.toContain("['docker'")
  expect(matrixScript).toContain('native matrix target mismatch')
  expect(testSource).toContain("it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')")

  if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'x64')) {
    const { stdout } = await runArchitectureProbe('linux', process.arch)
    const architectureEvidence = parseArchitectureEvidence(JSON.parse(stdout.trim().split('\n').at(-1)!))
    expect(Object.keys(architectureEvidence.sourceFiles)).toEqual([...FUMA_EMAIL_EVIDENCE_SOURCE_FILES])
    expect(FUMA_EMAIL_EVIDENCE_SOURCE_FILES).toEqual(expect.arrayContaining([
      'apps/studio/server/fuma/email/compatibility/DECISION.md',
      'apps/studio/server/fuma/email/index.ts',
      'apps/studio/server/fuma/email/tenantDocumentRenderer.ts',
      'apps/studio/server/fuma/email/trustedSystemTemplateRenderer.tsx',
      'apps/studio/src/__tests__/architecture/fuma-email-boundaries.test.ts',
      'apps/studio/src/__tests__/fuma/emailDocumentRenderer.test.ts',
      'apps/studio/src/core/fuma/email/document.ts',
      'apps/studio/src/core/fuma/email/index.ts',
    ]))
    const receipt = await parseAndVerifyNativeReceipt({
      ...architectureEvidence,
      receiptKind: 'fuma-email-native-compatibility',
      compatibilityTests: { passed: 9, skipped: 1, failed: 0 },
      rendererArchitectureTests: { passed: 12, skipped: 0, failed: 0 },
      cli: FUMA_EMAIL_CLI_COMMANDS,
    })
    expect(receipt.target).toEqual(receipt.host)
    const tamperedSourceFiles = {
      ...receipt.sourceFiles,
      'apps/studio/src/__tests__/fuma/emailDocumentRenderer.test.ts': '0'.repeat(64),
    }
    await expect(parseAndVerifyNativeReceipt({ ...receipt, sourceFiles: tamperedSourceFiles }))
      .rejects.toThrow('does not bind to the current exact source')
    await expect(parseAndVerifyNativeReceipt({ ...receipt, sourceSha256: '0'.repeat(64) }))
      .rejects.toThrow('does not bind to the current exact source')
    await expect(parseAndVerifyNativeReceipt({
      ...receipt,
      target: { ...receipt.target, arch: process.arch === 'arm64' ? 'x64' : 'arm64' },
    }, { verifyCurrentSource: false })).rejects.toThrow('not bound to its native host')
  }
})

it.skipIf(process.platform !== 'linux')(
  'builds and serves the fixture preview through the Bun-invoked official CLI',
  async () => {
    await rm(GENERATED_PREVIEW_DIRECTORY, { force: true, recursive: true })
    const { stdout } = await runBun(['run', 'email', 'build', '--dir', EMAILS_DIRECTORY])
    expect(stdout).toContain('/preview/systemNotice')
    expect(await Bun.file(join(GENERATED_PREVIEW_DIRECTORY, '.next', 'BUILD_ID')).exists()).toBe(true)
    expect(await Bun.file(join(GENERATED_PREVIEW_DIRECTORY, 'package-lock.json')).exists()).toBe(true)

    const preview = Bun.spawn(['setsid', process.execPath, 'run', 'email', 'start'], {
      cwd: STUDIO_ROOT,
      env: { ...process.env, NO_COLOR: '1', PORT: BUILD_PREVIEW_PORT },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const html = await waitForPreview(`http://127.0.0.1:${BUILD_PREVIEW_PORT}/preview/systemNotice`)
      expect(html).toContain('Workspace ready')
      expect(html).toContain('https://app.fuma.invalid/notices/notice_041')
    } finally {
      terminateProcessGroup(preview.pid)
      await preview.exited
    }
  },
  900_000,
)
