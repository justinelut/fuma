import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { readServerConfig } from '../../../server/config'
import { HISTORICAL_MIGRATION_SOURCE_HASHES } from '../../../../../tooling/workspaceMigrationBaseline'

const WORKSPACE_ROOT = join(import.meta.dir, '../../../../..')
const STUDIO_ROOT = join(WORKSPACE_ROOT, 'apps/studio')

const StringMapSchema = Type.Record(Type.String(), Type.String())
const PackageManifestSchema = Type.Object({
  name: Type.String(),
  version: Type.String(),
  workspaces: Type.Optional(Type.Array(Type.String())),
  scripts: StringMapSchema,
  dependencies: Type.Optional(StringMapSchema),
  devDependencies: Type.Optional(StringMapSchema),
})
type PackageManifest = Static<typeof PackageManifestSchema>

function readWorkspaceFile(path: string): string {
  return readFileSync(join(WORKSPACE_ROOT, path), 'utf8')
}

function readStudioFile(path: string): string {
  return readFileSync(join(STUDIO_ROOT, path), 'utf8')
}

function readPackage(path: string): PackageManifest {
  return Value.Decode(PackageManifestSchema, JSON.parse(readWorkspaceFile(path)))
}

function sha256(source: string): string {
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}

function quotedArray(source: string, declaration: string): string[] {
  const body = new RegExp(`const ${declaration} = \\[([\\s\\S]*?)\\n\\]`).exec(source)?.[1]
  expect(body, `${declaration} must remain a literal release inventory`).toBeDefined()
  return [...body!.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function expectFragments(source: string, fragments: readonly string[]): void {
  for (const fragment of fragments) expect(source, `missing self-host contract: ${fragment}`).toContain(fragment)
}

describe('FUMA-WEB-003 self-host parity after the apps/studio move', () => {
  test('keeps one relocated Studio runtime and immutable historical migration sources', () => {
    expect(existsSync(join(STUDIO_ROOT, 'server/index.ts'))).toBe(true)
    expect(existsSync(join(WORKSPACE_ROOT, 'server/index.ts'))).toBe(false)

    for (const [path, expectedHash] of Object.entries(HISTORICAL_MIGRATION_SOURCE_HASHES)) {
      const source = readWorkspaceFile(path)
      expect(path.startsWith('apps/studio/server/db/migrations-')).toBe(true)
      expect(sha256(source), `${path} must remain upgrade-compatible`).toBe(expectedHash)
      expect(existsSync(join(WORKSPACE_ROOT, path.slice('apps/studio/'.length)))).toBe(false)
    }
  })

  test('preserves root self-host wrappers and their Studio command authorities', () => {
    const root = readPackage('package.json')
    const studio = readPackage('apps/studio/package.json')

    expect(root.workspaces).toEqual(['apps/*', 'packages/*'])
    expect(root.version).toBe(studio.version)

    const wrappedCommands = [
      'dev',
      'dev:server',
      'start',
      'docker:up',
      'release:bundle',
      'icons:sync',
      'bootstrap:sync',
      'instatic-plugin',
    ] as const
    for (const command of wrappedCommands) {
      expect(root.scripts[command]).toBe(`bun --cwd=apps/studio run ${command}`)
    }


    expect(root.scripts.build).toBe(
      'bun --cwd=packages/brand run typecheck && bun --cwd=packages/design-tokens run typecheck && bun --cwd=packages/public-contracts run typecheck && bun run typecheck:governance && bun run build:studio && bun run build:web && bun run build:site-runtime && bun run build:control',
    )
    expect(studio.scripts).toMatchObject({
      dev: 'bun run scripts/dev.ts',
      'dev:server': 'bun --watch server/index.ts',
      start: 'bun run scripts/start.ts',
      'docker:up': 'docker compose -f ../../compose.prod.yml -f ../../compose.build.yml up --build',
      'release:bundle': 'bun run scripts/build-release-bundle.ts',
      build: 'tsc -b && bun run scripts/vite.ts build',
      'icons:sync': 'bun run scripts/sync-icons.ts',
      'bootstrap:sync': 'bun run scripts/sync-plugin-bootstrap.ts',
      'instatic-plugin': 'bun run src/core/plugin-sdk/cli/index.ts',
    })
    expect(studio.dependencies?.esbuild).toBeTruthy()
    expect(studio.devDependencies?.esbuild).toBeUndefined()
  })

  test('builds at the workspace root and runs from the relocated Studio image root', () => {
    const dockerfile = readWorkspaceFile('Dockerfile')

    expectFragments(dockerfile, [
      'FROM oven/bun:1.3.14 AS build',
      'WORKDIR /app',
      'COPY package.json bun.lock ./',
      'COPY apps/studio/package.json ./apps/studio/package.json',
      'COPY apps/web/package.json ./apps/web/package.json',
      'COPY packages/brand/package.json ./packages/brand/package.json',
      'COPY packages/design-tokens/package.json ./packages/design-tokens/package.json',
      'COPY packages/public-contracts/package.json ./packages/public-contracts/package.json',
      'COPY vendor ./vendor',
      'RUN bun install --frozen-lockfile',
      'COPY . .',
      'RUN bun run build:studio',
      'FROM oven/bun:1.3.14 AS production-deps',
      'RUN bun install --frozen-lockfile --production --filter @fuma/studio',
      'FROM oven/bun:1.3.14 AS runtime',
      'WORKDIR /app/apps/studio',
      'ENV HOST=0.0.0.0',
      'ENV STATIC_DIR=/app/dist',
      'ENV UPLOADS_DIR=/app/uploads',
      'COPY --from=production-deps --chown=bun:bun /app/node_modules /app/node_modules',
      'COPY --from=production-deps --chown=bun:bun /app/apps/studio/node_modules ./node_modules',
      'COPY --from=build --chown=bun:bun /app/apps/studio/dist /app/dist',
      'COPY --chown=bun:bun apps/studio/server ./server',
      'COPY --chown=bun:bun apps/studio/src ./src',
      'RUN mkdir -p /app/uploads /app/data',
      'USER bun',
      'EXPOSE 3001',
      'CMD ["bun", "run", "server/index.ts"]',
    ])
    expect(dockerfile).not.toContain('ENV STATIC_DIR=/app/apps/studio/dist')
    expect(dockerfile).not.toContain('COPY --chown=bun:bun server ./server')
  })

  test('requires PostgreSQL configuration and root environment examples', () => {
    expect(readServerConfig({})).toMatchObject({
      port: 3001,
      databaseUrl: 'postgres://instatic:instatic@127.0.0.1:5433/instatic',
      uploadsDir: './uploads',
      staticDir: './dist',
    })

    const dbFactory = readStudioFile('server/db/index.ts')
    expectFragments(dbFactory, [
      "import { createPostgresClient } from './postgres'",
      "import { pgMigrations } from './migrations-pg'",
      'migrations: pgMigrations',
      'PostgreSQL is required',
    ])
    expect(dbFactory).not.toMatch(/createSqliteClient|sqliteMigrations/)

    const localEnv = readWorkspaceFile('.env.example')
    expectFragments(localEnv, [
      'DATABASE_URL=postgres://instatic:instatic@127.0.0.1:5433/instatic',
      'UPLOADS_DIR=./uploads',
      'STATIC_DIR=./apps/studio/dist',
    ])

    const productionEnv = readWorkspaceFile('.env.production.example')
    expectFragments(productionEnv, [
      'INSTATIC_IMAGE=ghcr.io/corebunch/instatic:latest',
      'INSTATIC_SECRET_KEY=',
      'HOST_PORT=3001',
      'TRUSTED_PROXY_CIDRS=',
      'POSTGRES_DB=instatic',
      'POSTGRES_USER=instatic',
      'POSTGRES_PASSWORD=',
      'DOMAIN=cms.example.com',
      'PUBLIC_ORIGIN=',
    ])
  })

  test('keeps the production and build Compose facades image-compatible and persistent', () => {
    const production = readWorkspaceFile('compose.prod.yml')
    const build = readWorkspaceFile('compose.build.yml')

    expectFragments(production, [
      'image: ${INSTATIC_IMAGE:-ghcr.io/corebunch/instatic:latest}',
      '"${HOST_PORT:-3001}:3001"',
      'HOST: 0.0.0.0',
      'PORT: "3001"',
      'DATABASE_URL: postgres://${POSTGRES_USER:-instatic}:${POSTGRES_PASSWORD:-CHANGEME_set_POSTGRES_PASSWORD_in_env}@postgres:5432/${POSTGRES_DB:-instatic}',
      'UPLOADS_DIR: /app/uploads',
      'STATIC_DIR: /app/dist',
      '- uploads:/app/uploads',
      '- postgres_data:/var/lib/postgresql/data',
      'condition: service_healthy',
      'postgres_data:',
      'uploads:',
    ])
    expect(production).not.toContain('${POSTGRES_PASSWORD:?')
    expect(production).not.toContain('\n    build:')

    expectFragments(build, [
      'app:',
      'build:',
      'context: .',
      'dockerfile: Dockerfile',
      'image: ${INSTATIC_IMAGE:-instatic:local}',
    ])
  })

  test('keeps PostgreSQL data, uploads, TLS state, and published artefacts durable', () => {
    const production = readWorkspaceFile('compose.prod.yml')
    const tls = readWorkspaceFile('compose.tls.yml')
    const staticArtefact = readStudioFile('server/publish/staticArtefact.ts')

    expectFragments(production, [
      '- postgres_data:/var/lib/postgresql/data',
      '- uploads:/app/uploads',
      'postgres_data:',
      'uploads:',
    ])
    expectFragments(tls, [
      'image: caddy:2-alpine',
      'source: ./Caddyfile',
      'target: /etc/caddy/Caddyfile',
      '- caddy_data:/data',
      '- caddy_config:/config',
      'condition: service_healthy',
      'ports: !reset []',
      'PUBLIC_ORIGIN: ${PUBLIC_ORIGIN:-https://${DOMAIN}}',
      'caddy_data:',
      'caddy_config:',
    ])
    expectFragments(staticArtefact, [
      "return join(uploadsDir, 'published')",
      "return join(getPublishedDir(uploadsDir), 'current')",
    ])
  })

  test('uses the same discoverable healthcheck in the image and Compose stack', () => {
    const command = '["bun", "run", "server/healthcheck.ts"]'
    const dockerfile = readWorkspaceFile('Dockerfile')
    const compose = readWorkspaceFile('compose.prod.yml')
    const healthcheck = readStudioFile('server/healthcheck.ts')

    expect(dockerfile).toContain(`HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ${command}`)
    expect(compose).toContain(`test: ["CMD", "bun", "run", "server/healthcheck.ts"]`)
    expectFragments(healthcheck, [
      "const port = process.env.PORT ?? '3001'",
      'const url = `http://127.0.0.1:${port}/health`',
      'process.exit(res.ok ? 0 : 1)',
    ])
  })

  test('ships every portable release asset and publishes the bundle through the root facade', () => {
    const builder = readStudioFile('scripts/build-release-bundle.ts')
    const workflow = readWorkspaceFile('.github/workflows/release.yml')
    const bundleFiles = quotedArray(builder, 'bundleFiles')

    expect(bundleFiles).toEqual(expect.arrayContaining([
      'Caddyfile',
      'compose.prod.yml',
      'compose.tls.yml',
      '.env.production.example',
      'docs/deployment/README.md',
      'docs/deployment/vps.md',
      'docs/deployment/docker-image.md',
      'docs/deployment/tls-caddy.md',
      'docs/deployment/backup-restore.md',
      'docs/deployment/railway.md',
      'docs/deployment/render.md',
      'docs/deployment/render/postgres/render.yaml',
    ]))
    expectFragments(builder, [
      "resolve(import.meta.dir, '../../..')",
      "join(WORKSPACE_ROOT, '.tmp', 'release')",
      'STATIC_DIR=/app/dist',
      'ghcr.io/corebunch/instatic:${version}',
      "spawnSync('tar', ['-czf', archivePath, '-C', OUT_DIR, bundleName]",
    ])
    expectFragments(workflow, [
      'context: .',
      'INSTATIC_VERSION=${{ steps.version.outputs.version }}',
      'run: bun run release:bundle -- "${{ needs.image.outputs.version }}"',
      '".tmp/release/instatic-${{ needs.image.outputs.version }}-release-bundle.tar.gz"',
    ])
  })
})
