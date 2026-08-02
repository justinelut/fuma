import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path: string) => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')
const IMAGE_SOURCES = [
  'infra/fuma-phase-13-18/docker/runtime.Dockerfile',
  'infra/fuma-phase-13-18/docker/public-web.Dockerfile',
  'infra/fuma-phase-13-18/docker/site-runtime.Dockerfile',
] as const

const WALK_EXCLUDED = new Set(['.git', '.next', 'build', 'dist', 'node_modules', 'out', 'target'])
function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (WALK_EXCLUDED.has(name)) return []
    const path = join(directory, name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) return []
    return metadata.isDirectory() ? walk(path) : [path]
  })
}

describe('FUMA-078 native ARM64 supply-chain architecture', () => {
  it('preserves the exact legacy self-host image while adding three separate sources', () => {
    expect(sha256('Dockerfile')).toBe('afaec1fe3304c95fa159035c0e9e7c2fc680383658948f9a354a5339f455dd39')
    const selfHost = read('Dockerfile')
    expect(selfHost).toContain('LABEL org.opencontainers.image.title="Instatic"')
    expect(selfHost).toContain('RUN bun run build:studio')
    expect(selfHost).toContain('USER bun')
    expect(selfHost).toContain('CMD ["bun", "run", "server/index.ts"]')
    expect(read(IMAGE_SOURCES[0])).toContain('LABEL org.opencontainers.image.title="Fuma runtime"')
    expect(read(IMAGE_SOURCES[1])).toContain('LABEL org.opencontainers.image.title="Fuma public web"')
    expect(read(IMAGE_SOURCES[2])).toContain('LABEL org.opencontainers.image.title="Fuma site runtime"')
  })

  it('builds every Fuma image from the exact root lock and every workspace manifest', () => {
    const workspaceManifests = ['apps', 'packages'].flatMap((scope) => readdirSync(join(ROOT, scope))
      .map((name) => `${scope}/${name}/package.json`)
      .filter((path) => existsSync(join(ROOT, path))))
      .sort()
    expect(workspaceManifests).toEqual([
      'apps/control-surfaces/package.json',
      'apps/studio/package.json',
      'apps/web/package.json',
      'packages/brand/package.json',
      'packages/design-tokens/package.json',
      'packages/fuma-governance-launch/package.json',
      'packages/public-contracts/package.json',
    ])
    for (const path of IMAGE_SOURCES) {
      const dockerfile = read(path)
      expect(dockerfile).toContain('COPY package.json bun.lock ./')
      expect(dockerfile).toContain('RUN bun install --frozen-lockfile')
      for (const manifest of workspaceManifests) expect(dockerfile).toContain(manifest)
    }
    const nested = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]
      .filter((path) => /\/(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path))
    expect(nested).toEqual([])
    expect(sha256('bun.lock')).toBe('8601be172f0b8d80a785e9a57183c0fa3b55be66c812bfefd715b5e72c0d1b1a')
  })

  it('defines explicit non-root commands for every runtime role and image', () => {
    const runtime = read(IMAGE_SOURCES[0])
    const entrypoint = read('infra/fuma-phase-13-18/docker/runtime-entrypoint.sh')
    const web = read(IMAGE_SOURCES[1])
    const siteRuntime = read(IMAGE_SOURCES[2])
    expect(runtime).toContain('USER bun')
    expect(runtime).toContain('ENTRYPOINT ["/usr/local/bin/fuma-runtime"]')
    for (const role of ['web', 'worker', 'scheduler', 'migration']) expect(entrypoint).toContain(role)
    expect(entrypoint).toContain('email-compatibility')
    expect(web).toContain('USER 10001:10001')
    expect(web).toContain('CMD ["node", "apps/web/server.js"]')
    expect(siteRuntime).toContain('USER 10002:10002')
    expect(siteRuntime).toContain('CMD ["node", "apps/site-runtime/server.js"]')
  })

  it('binds ARM64 smoke evidence to labels and uses create-only output ownership', () => {
    for (const path of [
      'infra/fuma-phase-13-18/docker/runtime-smoke.sh',
      'infra/fuma-phase-13-18/docker/public-web-smoke.sh',
      'infra/fuma-phase-13-18/docker/site-runtime-smoke.sh',
    ]) {
      const smoke = read(path)
      expect(smoke).toContain('linux/arm64')
      expect(smoke).not.toContain('linux/amd64')
      expect(smoke).toContain('ke.co.fuma.lock-hash-sha256')
      expect(smoke).toContain('ke.co.fuma.migration-high-water')
      expect(smoke).toContain('[ ! -e "$output" ]')
      expect(smoke).toContain('container_id=')
      expect(smoke).toContain('mktemp "${output}.tmp.XXXXXX"')
      expect(smoke).toContain('ln "$tmp_output" "$output"')
      expect(smoke).not.toContain('mv "$tmp_output" "$output"')
    }
  })

  it('requires native ARM64 gates before protected publication and immutable signing', () => {
    const workflow = read('.github/workflows/fuma-paired-release.yml')
    for (const fragment of [
      'github.ref_protected == true',
      'runs-on: ubuntu-24.04-arm',
      'test "$RUNNER_ARCH" = "$REQUIRED_RUNNER_ARCH"',
      'platforms: linux/arm64',
      'site-runtime.Dockerfile',
      'runtime-smoke.sh',
      'public-web-smoke.sh',
      'site-runtime-smoke.sh',
      'provenance: mode=max',
      'sbom: true',
      'Refuse to overwrite existing source-SHA image tags',
      'ghcr.io/corebunch/fuma-site-runtime',
      'Scan published immutable ARM64 runtime digest',
      'Generate runtime SPDX from published immutable ARM64 digest',
      'Extract BuildKit SLSA provenance',
      'Sign only scanned immutable image digests',
      'cosign verify --certificate-identity-regexp',
      'registry-published-unpromoted',
      'partialPublicationPolicy:"orphan-non-promotable"',
      'rollbackPolicy:"retain-last-known-good-digests"',
      'deploymentMutationPerformed:false',
      '--site-runtime-index=supply/site-runtime.index.json',
      '--site-runtime-scan=supply/site-runtime.trivy.sarif',
      '--site-runtime-smoke-dir=supply/site-runtime-smoke',
      'pairedRelease.ts',
      'Prove manifest tamper and mixed-SHA rejection',
    ]) expect(workflow).toContain(fragment)
    expect(workflow).not.toMatch(/linux\/amd64|setup-qemu|qemu|emulat/i)
    expect(workflow.indexOf('needs: [preflight, architecture-gate]')).toBeLessThan(workflow.indexOf('push: true'))
    expect(workflow.indexOf('Scan published immutable ARM64 runtime digest')).toBeLessThan(workflow.indexOf('Sign only scanned immutable image digests'))
    expect(workflow.indexOf('Extract BuildKit SLSA provenance')).toBeLessThan(workflow.indexOf('Sign only scanned immutable image digests'))
    expect(workflow).toContain('if: github.ref_protected == true && needs.preflight.outputs.source_sha == github.sha')
    const tooling = read('packages/fuma-governance-launch/tooling/pairedRelease.ts')
    expect(tooling).toContain("mkdtemp(join(parent, '.paired-release-'))")
    expect(tooling).toContain('await handle.sync()')
    expect(tooling).toContain('await link(staged, path)')
    expect(tooling).toContain("{ flag: 'wx', mode: 0o644 }")
    expect(workflow).not.toMatch(/kubectl|helm\s+upgrade|cloudflare|aws\s|oci\s/)
  })
})
