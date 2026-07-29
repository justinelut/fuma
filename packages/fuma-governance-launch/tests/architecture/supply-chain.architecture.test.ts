import { describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

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

describe('FUMA-078 supply-chain architecture', () => {
  it('preserves the exact legacy self-host image while adding separate images', () => {
    const selfHost = read('Dockerfile')
    expect(selfHost).toContain('LABEL org.opencontainers.image.title="Instatic"')
    expect(selfHost).toContain('RUN bun run build:studio')
    expect(selfHost).toContain('USER bun')
    expect(selfHost).toContain('CMD ["bun", "run", "server/index.ts"]')
    expect(read('infra/fuma-phase-13-18/docker/runtime.Dockerfile')).toContain('LABEL org.opencontainers.image.title="Fuma runtime"')
    expect(read('infra/fuma-phase-13-18/docker/public-web.Dockerfile')).toContain('LABEL org.opencontainers.image.title="Fuma public web"')
  })

  it('builds every Fuma image from the one exact root lock and every workspace manifest', () => {
    const dockerfiles = ['infra/fuma-phase-13-18/docker/runtime.Dockerfile', 'infra/fuma-phase-13-18/docker/public-web.Dockerfile'].map(read)
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
    for (const dockerfile of dockerfiles) {
      expect(dockerfile).toContain('COPY package.json bun.lock ./')
      expect(dockerfile).toContain('RUN bun install --frozen-lockfile')
      for (const manifest of workspaceManifests) expect(dockerfile).toContain(manifest)
    }
    const nested = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))].filter((path) => !path.includes('/node_modules/') && /\/(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path))
    expect(nested).toEqual([])
    expect(existsSync(join(ROOT, 'bun.lock'))).toBe(true)
  })

  it('publishes non-root runtime and Next images with explicit runtime commands', () => {
    const runtime = read('infra/fuma-phase-13-18/docker/runtime.Dockerfile')
    const entrypoint = read('infra/fuma-phase-13-18/docker/runtime-entrypoint.sh')
    const web = read('infra/fuma-phase-13-18/docker/public-web.Dockerfile')
    expect(runtime).toContain('USER bun')
    expect(runtime).toContain('ENTRYPOINT ["/usr/local/bin/fuma-runtime"]')
    for (const role of ['web', 'worker', 'scheduler', 'migration']) expect(entrypoint).toContain(role)
    expect(entrypoint).toContain('email-compatibility')
    expect(web).toContain('USER 10001:10001')
    expect(web).toContain('CMD ["node", "apps/web/server.js"]')
  })

  it('binds architecture evidence to image labels and never overwrites or adopts cleanup targets', () => {
    for (const path of [
      'infra/fuma-phase-13-18/docker/runtime-smoke.sh',
      'infra/fuma-phase-13-18/docker/public-web-smoke.sh',
    ]) {
      const smoke = read(path)
      expect(smoke).toContain('ke.co.fuma.lock-hash-sha256')
      expect(smoke).toContain('ke.co.fuma.migration-high-water')
      expect(smoke).toContain('[ ! -e "$output" ]')
      expect(smoke).toContain('container_id=')
      expect(smoke).toContain('mktemp "${output}.tmp.XXXXXX"')
      expect(smoke).toContain('ln "$tmp_output" "$output"')
      expect(smoke).not.toContain('mv "$tmp_output" "$output"')
    }
  })

  it('gates both architectures before protected publication and immutable manifest signing', () => {
    const workflow = read('.github/workflows/fuma-paired-release.yml')
    const runtimeSmoke = read('infra/fuma-phase-13-18/docker/runtime-smoke.sh')
    expect(runtimeSmoke).toContain('email-compatibility')
    for (const fragment of [
      'github.ref_protected == true',
      'linux/amd64',
      'linux/arm64',
      'runtime-smoke.sh',
      'public-web-smoke.sh',
      'aquasecurity/trivy-action@0.33.1',
      'anchore/sbom-action@v0.21.0',
      'provenance: mode=max',
      'sbom: true',
      'Refuse to overwrite existing source-SHA image tags',
      'docker buildx imagetools inspect "$runtime_image" --raw',
      'Generate runtime SBOM from published immutable digest',
      'Generate public-web SBOM from published immutable digest',
      'docker buildx imagetools inspect "$image" --format \'{{json .Provenance}}\'',
      'runtime.signature-verification.json',
      'web.signature-verification.json',
      'registry-published-unpromoted',
      'partialPublicationPolicy:"orphan-non-promotable"',
      'rollbackPolicy:"retain-last-known-good-digests"',
      'deploymentMutationPerformed:false',
      'cosign sign --yes',
      'cosign verify --certificate-identity-regexp',
      'cosign sign-blob --yes',
      'cosign verify-blob --bundle',
      '--runtime-index=supply/runtime.index.json',
      '--runtime-scan=supply/runtime.trivy.sarif',
      '--publication-plan=supply/publication-plan.json',
      'pairedRelease.ts --verify',
      'Prove manifest immutability and mixed-SHA rejection',
    ]) expect(workflow).toContain(fragment)
    expect(workflow.indexOf('needs: [preflight, architecture-gate]')).toBeLessThan(workflow.indexOf('push: true'))
    expect(workflow.indexOf('Bind and validate published scan reports before signing')).toBeLessThan(workflow.indexOf('Sign only scanned immutable image digests'))
    expect(workflow.indexOf('Extract and record BuildKit SLSA provenance')).toBeLessThan(workflow.indexOf('Sign only scanned immutable image digests'))
    expect(workflow.indexOf('Record rollback-safe non-promoting publication plan')).toBeLessThan(workflow.indexOf('Assemble immutable paired release'))
    expect(workflow).toContain('if: github.ref_protected == true && needs.preflight.outputs.source_sha == github.sha')
    const tooling = read('packages/fuma-governance-launch/tooling/pairedRelease.ts')
    expect(tooling).toContain("mkdtemp(join(parent, '.paired-release-'))")
    expect(tooling).toContain('await handle.sync()')
    expect(tooling).toContain('await link(staged, path)')
    expect(tooling).toContain("{ flag: 'wx', mode: 0o644 }")
    expect(workflow).not.toContain('bun --cwd ')
    expect(workflow).not.toMatch(/kubectl|helm\s+upgrade|cloudflare|aws\s|oci\s/)
  })
})
