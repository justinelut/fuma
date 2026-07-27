import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const STUDIO_ROOT = resolve(import.meta.dir, '../../..')
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, '../..')

function readStudioFile(path: string): string {
  return readFileSync(join(STUDIO_ROOT, path), 'utf8')
}

function readWorkspaceFile(path: string): string {
  return readFileSync(join(WORKSPACE_ROOT, path), 'utf8')
}

describe('self-host docker config', () => {
  it('defines a postgres dev service for `bun run dev` to manage', () => {
    const compose = readWorkspaceFile('docker-compose.yml')
    expect(compose).toContain('postgres:')
    expect(compose).toContain('postgres:16')
  })

  it('defines a persistent postgres volume in the dev compose', () => {
    const compose = readWorkspaceFile('docker-compose.yml')
    expect(compose).toContain('postgres_data:')
  })

  it('documents required environment variables', () => {
    const env = readWorkspaceFile('.env.example')
    expect(env).toContain('DATABASE_URL=')
    expect(env).toContain('UPLOADS_DIR=')
  })

  it('defines a production Docker image that builds the studio before runtime startup', () => {
    const dockerfile = readWorkspaceFile('Dockerfile')

    expect(dockerfile).toContain('FROM oven/bun:1.3.14 AS build')
    expect(dockerfile).toContain('COPY apps/studio/package.json ./apps/studio/package.json')
    expect(dockerfile).toContain('COPY apps/web/package.json ./apps/web/package.json')
    expect(dockerfile).toContain('COPY packages/brand/package.json ./packages/brand/package.json')
    expect(dockerfile).toContain('RUN bun run build:studio')
    expect(dockerfile).toContain('FROM oven/bun:1.3.14 AS runtime')
    expect(dockerfile).toContain('WORKDIR /app/apps/studio')
    expect(dockerfile).toContain('ARG INSTATIC_VERSION=dev')
    expect(dockerfile).toContain('LABEL org.opencontainers.image.version="${INSTATIC_VERSION}"')
    expect(dockerfile).toContain('ENV STATIC_DIR=/app/dist')
    expect(dockerfile).toContain('COPY --from=build --chown=bun:bun /app/apps/studio/dist /app/dist')
    expect(dockerfile).toContain('COPY --chown=bun:bun apps/studio/server ./server')
    expect(dockerfile).toContain('USER bun')
    expect(dockerfile).toContain('EXPOSE 3001')
    expect(dockerfile).toContain('CMD ["bun", "run", "server/index.ts"]')
    expect(dockerfile).not.toContain('vite build && bun run server/index.ts')
  })

  it('keeps TypeScript path aliases available in the runtime image', () => {
    const dockerfile = readWorkspaceFile('Dockerfile')

    expect(dockerfile).toContain('COPY --chown=bun:bun tsconfig.base.json /app/')
    expect(dockerfile).toContain('COPY --chown=bun:bun apps/studio/tsconfig*.json ./')
  })

  it('installs the runtime script bundler in studio production dependencies', () => {
    const pkg = JSON.parse(readStudioFile('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(pkg.dependencies?.esbuild).toBeTruthy()
    expect(pkg.devDependencies?.esbuild).toBeUndefined()
  })

  it('allows PATCH in server CORS preflight for CMS media rename', () => {
    const serverIndex = readStudioFile('server/index.ts')

    expect(serverIndex).toContain("'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'")
  })

  it('defines a production compose stack with health checks and persistent data', () => {
    const compose = readWorkspaceFile('compose.prod.yml')
    const buildOverride = readWorkspaceFile('compose.build.yml')

    expect(compose).toContain('ghcr.io/corebunch/instatic:latest')
    expect(compose).not.toContain('build:')
    expect(compose).toContain('restart: unless-stopped')
    expect(compose).toContain('condition: service_healthy')
    expect(compose).toContain('postgres_data:')
    expect(compose).toContain('uploads:')
    expect(buildOverride).toContain('build:')
    expect(buildOverride).toContain('context: .')
    expect(buildOverride).toContain('dockerfile: Dockerfile')
  })

  it('runs CI commands from the workspace root', () => {
    const ci = readWorkspaceFile('.github/workflows/ci.yml')

    expect(ci).toContain('run: bun run build')
    expect(ci).toContain('run: bun test')
    expect(ci).toContain('run: bun run lint')
    expect(ci).not.toContain('working-directory: apps/studio')
  })

  it('lets compose.prod.yml load without an .env (so SQLite mode is zero-config) while making the Postgres password placeholder loudly unsafe', () => {
    // Why this rule exists:
    // SQLite mode (compose.sqlite.yml override) disables the postgres service
    // and replaces the app's DATABASE_URL — Postgres credentials are unused.
    // But compose's `${VAR:?error}` interpolation runs at FILE LOAD TIME,
    // before profiles or overrides are applied. A `:?` guard on POSTGRES_PASSWORD
    // forces SQLite users to invent a `.env` for a service they aren't running.
    //
    // Contract instead:
    //   1. No `:?` guard on POSTGRES_PASSWORD — file loads with empty env.
    //   2. The placeholder default value MUST be obviously unsafe (must contain
    //      the literal string CHANGEME) so a Postgres operator who forgets to
    //      override it sees the placeholder in their running container's
    //      env / logs and rotates it.
    const compose = readWorkspaceFile('compose.prod.yml')

    expect(compose).not.toContain('${POSTGRES_PASSWORD:?')
    expect(compose).toContain('CHANGEME')
  })

  it('keeps release assets at the workspace root while running the builder from studio', () => {
    const builder = readStudioFile('scripts/build-release-bundle.ts')
    const workflow = readWorkspaceFile('.github/workflows/release.yml')

    expect(builder).toContain("resolve(import.meta.dir, '../../..')")
    expect(builder).toContain("join(WORKSPACE_ROOT, '.tmp', 'release')")
    expect(builder).toContain('join(WORKSPACE_ROOT, path)')
    expect(builder).toContain("'docs/deployment/release-workflow.md'")
    expect(builder).toContain("'docs/deployment/self-host-smoke-harness.md'")
    expect(workflow).toContain('bun run release:bundle')
    expect(workflow).toContain('".tmp/release/instatic-${{ needs.image.outputs.version }}-release-bundle.tar.gz"')
  })

  it('defines production environment variables required by the compose stack', () => {
    const env = readWorkspaceFile('.env.production.example')
    const compose = readWorkspaceFile('compose.prod.yml')

    expect(env).toContain('POSTGRES_PASSWORD=')
    expect(env).toContain('INSTATIC_SECRET_KEY=')
    expect(env).toContain('TRUSTED_PROXY_CIDRS=')
    expect(compose).toContain('INSTATIC_SECRET_KEY:')
    expect(compose).toContain('TRUSTED_PROXY_CIDRS:')
  })
})
