export const FUMA_EMAIL_COMPATIBILITY_PACKAGES = Object.freeze({
  '@react-email/ui': Object.freeze({
    version: '6.9.1',
    repository: 'https://github.com/resend/react-email.git#packages/ui',
    integrity: 'sha512-zw7KvwMu3RU/fDC9TAkegg9/qNV9foJtd3QRoetdWVFe8aQC/NyXmWTrG9IrkzVLzn5otkkxu7e7B1QelcwdiQ==',
    engines: null,
    peerDependencies: null,
    os: null,
    cpu: null,
  }),
  'react-email': Object.freeze({
    version: '6.9.1',
    repository: 'https://github.com/resend/react-email.git#packages/react-email',
    integrity: 'sha512-uUDRgFukMUXRlrsCNGlA0PZuUlQ44faI9hT/D7uMjozdumLBdHjfQttQswRYLjyLW8fFtg2HBrxAESbFU4ZKKA==',
    engines: Object.freeze({ node: '>=20.0.0' }),
    peerDependencies: Object.freeze({
      react: '^18.0 || ^19.0 || ^19.0.0-rc',
      'react-dom': '^18.0 || ^19.0 || ^19.0.0-rc',
    }),
    os: null,
    cpu: null,
  }),
})

export const FUMA_EMAIL_REJECTED_PACKAGES = Object.freeze({
  '@react-email/components': 'React Email 6 exports components from react-email directly',
  '@react-email/render': 'React Email 6 exports render from react-email directly',
})

export const FUMA_EMAIL_PROVEN_BUN_RANGE = '>=1.3.0 <1.4.0'
export const FUMA_EMAIL_PROVEN_RUNTIME = Object.freeze({
  bun: '1.3.14',
  react: '19.2.5',
  reactDom: '19.2.5',
})

export const FUMA_EMAIL_CLI_COMMANDS = Object.freeze({
  preview: 'email dev --dir server/fuma/email/compatibility/emails',
  build: 'email build --dir server/fuma/email/compatibility/emails',
  serve: 'email start',
  exportHtml: 'email export --dir server/fuma/email/compatibility/emails',
  exportText: 'email export --dir server/fuma/email/compatibility/emails --plainText',
})

export const FUMA_EMAIL_ARCHITECTURE_MATRIX = Object.freeze([
  Object.freeze({
    platform: 'linux' as const,
    arch: 'arm64' as const,
    artifact: 'fuma-email-compatibility-linux-arm64.json',
    runner: 'ubuntu-24.04-arm',
    probe: 'FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=arm64 bun run server/fuma/email/compatibility/architectureProbe.ts',
    nativeGate: 'FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-arm64.json bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts arm64',
  }),
  Object.freeze({
    platform: 'linux' as const,
    arch: 'x64' as const,
    artifact: 'fuma-email-compatibility-linux-amd64.json',
    runner: 'ubuntu-24.04',
    probe: 'FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=x64 bun run server/fuma/email/compatibility/architectureProbe.ts',
    nativeGate: 'FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-amd64.json bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts amd64',
  }),
])

export const FUMA_EMAIL_EXPECTED_OUTPUT_SHA256 = Object.freeze({
  html: '15529a7edd130c292f7818ff0b9bd8431ccf5c416672f979b0b9d6c7fd4d49b4',
  text: '74f8137974fc8ef6d0ee1f6ea056cb641b6881a3ba06bb3fff0efa8706a41935',
})

export type FumaEmailCompatibilityInput = {
  reactEmail: string
  reactEmailUi: string
  react: string
  reactDom: string
  bun: string
  platform: NodeJS.Platform
  arch: string
}

export function assertSupportedEmailCompatibility(input: FumaEmailCompatibilityInput): void {
  if (input.reactEmail !== FUMA_EMAIL_COMPATIBILITY_PACKAGES['react-email'].version) {
    throw new Error(`FUMA-041 unsupported react-email version ${input.reactEmail}`)
  }
  if (input.reactEmailUi !== FUMA_EMAIL_COMPATIBILITY_PACKAGES['@react-email/ui'].version) {
    throw new Error(`FUMA-041 unsupported @react-email/ui version ${input.reactEmailUi}`)
  }
  if (input.react !== FUMA_EMAIL_PROVEN_RUNTIME.react) {
    throw new Error(`FUMA-041 unsupported React version ${input.react}`)
  }
  if (input.reactDom !== FUMA_EMAIL_PROVEN_RUNTIME.reactDom) {
    throw new Error(`FUMA-041 unsupported React DOM version ${input.reactDom}`)
  }
  if (input.bun !== FUMA_EMAIL_PROVEN_RUNTIME.bun) {
    throw new Error(`FUMA-041 unsupported Bun version ${input.bun}`)
  }
  const supportedHost = FUMA_EMAIL_ARCHITECTURE_MATRIX.some(
    ({ platform, arch }) => platform === input.platform && arch === input.arch,
  )
  if (!supportedHost) {
    throw new Error(`FUMA-041 unsupported host ${input.platform}/${input.arch}`)
  }
}
