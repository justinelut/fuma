import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../../../..')
const WEB = join(ROOT, 'apps/web')

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function manifest(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>
}

describe('FUMA-WEB-005 public Web scaffold', () => {
  test('owns an exact-pinned Next/React/Tailwind/shadcn application', () => {
    const pkg = manifest('apps/web/package.json') as {
      name: string
      private: boolean
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.name).toBe('@fuma/web')
    expect(pkg.private).toBe(true)
    expect(pkg.dependencies.next).toBe('16.2.9')
    expect(pkg.dependencies.react).toBe('19.2.5')
    expect(pkg.dependencies['react-dom']).toBe('19.2.5')
    expect(pkg.devDependencies.tailwindcss).toBe('4.3.3')
    expect(pkg.devDependencies['@tailwindcss/postcss']).toBe('4.3.3')
    expect(pkg.devDependencies.shadcn).toBe('4.14.1')
    for (const version of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) {
      if (version.startsWith('workspace:')) continue
      expect(version).not.toMatch(/^[~^*]|latest|next|https?:|git\+|file:/)
    }
    expect(pkg.dependencies.zod).toBeUndefined()
    expect(pkg.devDependencies.zod).toBeUndefined()
  })

  test('uses App Router, MDX, React Compiler, strict TypeScript, and standalone output', () => {
    const config = read('apps/web/next.config.ts')
    const tsconfig = read('apps/web/tsconfig.json')
    expect(existsSync(join(WEB, 'app/layout.tsx'))).toBe(true)
    expect(existsSync(join(WEB, 'app/page.tsx'))).toBe(true)
    expect(config).toContain("output: 'standalone'")
    expect(config).toContain('reactCompiler: true')
    expect(config).toContain("pageExtensions: ['ts', 'tsx', 'md', 'mdx']")
    expect(tsconfig).toContain('"strict": true')
    expect(tsconfig).toContain('"noEmit": true')
  })

  test('keeps Tailwind and reviewed shadcn source local to Web', () => {
    const uiFiles = readdirSync(join(WEB, 'components/ui')).sort()
    expect(uiFiles).toEqual(['button.tsx', 'card.tsx'])
    expect(existsSync(join(WEB, 'components.json'))).toBe(true)
    expect(existsSync(join(WEB, 'postcss.config.mjs'))).toBe(true)
    expect(read('apps/web/app/globals.css')).toContain('@import "../styles/generated/fuma-design-tokens.css"')
    expect(read('apps/web/lib/utils.ts')).toContain("from 'tailwind-merge'")
    expect(existsSync(join(ROOT, 'packages/ui'))).toBe(false)
  })

  test('contains no Studio imports, Zod imports, or app-local install authority', () => {
    const files: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else files.push(path)
      }
    }
    walk(WEB)
    const source = files.filter((path) => /\.(?:ts|tsx|mdx)$/.test(path)).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).not.toMatch(/apps\/studio|@fuma\/studio|from ['"]zod(?:\/|['"])/)
    expect(existsSync(join(WEB, 'bun.lock'))).toBe(false)
  })

  test('has a separate non-root architecture-neutral standalone image target', () => {
    const dockerfile = read('infra/docker/web.Dockerfile')
    expect(dockerfile).toContain('RUN bun run build:web')
    expect(dockerfile).toContain('FROM node:22.22.0-slim AS runtime')
    expect(dockerfile).toContain('USER web')
    expect(dockerfile).toContain('CMD ["node", "apps/web/server.js"]')
    expect(dockerfile).not.toMatch(/amd64|x86_64/)
  })
})
