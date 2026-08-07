/**
 * Tests the tenant scaffold emitter against the REAL shipped admin components.
 *
 * Reading the real files is the point rather than a convenience: the whole reason this module exists
 * server-side is that the shadcn set is not generated from a template but rewritten from the files the
 * admin itself renders. A test against fixtures would prove nothing about that.
 */
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import {
  ADMIN_UI_DIRECTORY,
  persistScaffold,
  scaffoldTenantWorkspace,
  type ScaffoldResult,
  type ScaffoldWriter,
} from '../../../server/fuma/editor/tenantScaffold'
import { TENANT_SHADCN_COMPONENTS } from '@core/generatedSite/shadcnBaseline'
import { readModuleSource } from '@core/react-ir/read'

const STUDIO_ROOT = join(import.meta.dir, '..', '..', '..')

let cached: ScaffoldResult | null = null
async function scaffold(): Promise<ScaffoldResult> {
  cached ??= await scaffoldTenantWorkspace(STUDIO_ROOT, 'Demo Site')
  return cached
}

function sourceAt(result: ScaffoldResult, path: string): string {
  const file = result.files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`scaffold produced no ${path}`)
  return file.source
}

describe('the tenant scaffold emits what the earlier tasks only modelled', () => {
  it('reports no problems against the shipped admin set, so the gate is not crying wolf', async () => {
    const result = await scaffold()
    expect(result.problems).toEqual([])
  })

  it('emits every declared shadcn component', async () => {
    const result = await scaffold()
    for (const component of TENANT_SHADCN_COMPONENTS) {
      const path = `components/ui/${component.name}.tsx`
      expect(result.files.some((file) => file.path === path), path).toBe(true)
    }
  })

  it('leaves NO admin path in any emitted file, or the tenant build cannot resolve the import', async () => {
    const result = await scaffold()
    for (const file of result.files) {
      expect(file.source.includes('@admin/'), file.path).toBe(false)
    }
  })

  it('rewrites the cn helper at the tenant path rather than ours', async () => {
    const result = await scaffold()
    const button = sourceAt(result, 'components/ui/button.tsx')
    expect(button).toContain('@/lib/utils')
    // Six shadcn components import button; left alone that specifier is an admin path in a tenant file.
    const dialog = sourceAt(result, 'components/ui/dialog.tsx')
    expect(dialog.includes('@admin/fuma/ui/')).toBe(false)
  })

  it('emits the Field primitives, which no admin file can supply', async () => {
    const result = await scaffold()
    // Task 23 removed zod and react-hook-form from the admin and deleted its form.tsx, so this half of
    // the vocabulary exists ONLY as emitted source.
    const field = sourceAt(result, 'components/ui/field.tsx')
    expect(field).toContain('FieldLabel')
    expect(field).toContain('FieldError')
    expect(field).toContain('aria-describedby')
  })

  it('emits the member auth flows, and the guard is named for what it protects', async () => {
    const result = await scaffold()
    expect(sourceAt(result, 'app/sign-in/page.tsx')).toContain('sign')
    expect(sourceAt(result, 'app/sign-up/page.tsx')).toContain('sign')
    const guard = sourceAt(result, 'components/member-only.tsx')
    expect(guard).toContain('MemberOnly')
    // A route-shaped name would invite the belief that the page's own file is private. It is not:
    // a static release serves that file to anybody who asks for the path.
    expect(guard).not.toContain('ProtectedRoute')
  })

  it('writes the session provider where the auth pages actually import it from', async () => {
    const result = await scaffold()
    // Two generators had to agree on one path and did not: the auth pages import
    // '@/lib/member-session' while the emit first wrote components/member-session.tsx, so every file
    // that needed it failed to resolve. Only compiling the emitted set together showed it.
    expect(result.files.some((file) => file.path === 'lib/member-session.tsx')).toBe(true)
    for (const path of ['app/sign-in/page.tsx', 'app/sign-up/page.tsx', 'components/member-only.tsx']) {
      expect(sourceAt(result, path), path).toContain("@/lib/member-session")
    }
  })

  it('uses the Field API the primitives actually declare, not an invented prop', async () => {
    const result = await scaffold()
    const field = sourceAt(result, 'components/ui/field.tsx')
    // FieldError takes children (ComponentProps<'p'>). The auth pages passed `message`, which
    // typechecks nowhere and made the page unbuildable the moment both were emitted together.
    expect(field).toContain('function FieldError({ className, children')
    for (const path of ['app/sign-in/page.tsx', 'app/sign-up/page.tsx']) {
      expect(sourceAt(result, path), path).not.toMatch(/<FieldError[^>]*message=/)
    }
  })

  it('carries the starter, so a scaffolded site has a home page rather than a 404', async () => {
    const result = await scaffold()
    expect(result.files.some((file) => file.path === 'app/page.tsx')).toBe(true)
    expect(result.files.some((file) => file.path === 'app/layout.tsx')).toBe(true)
    // Configuration is present but NOT a module: a tsconfig has no editor kind to be stored under.
    const tsconfig = result.files.find((file) => file.path === 'tsconfig.json')
    expect(tsconfig?.module).toBe(false)
  })

  it('produces no duplicate path, so which file the tenant receives cannot depend on write order', async () => {
    const result = await scaffold()
    const paths = result.files.map((file) => file.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('emits the same set twice, so two tenants scaffolded a week apart receive identical source', async () => {
    const first = await scaffoldTenantWorkspace(STUDIO_ROOT, 'Demo Site')
    const second = await scaffoldTenantWorkspace(STUDIO_ROOT, 'Demo Site')
    expect(second.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path))
    expect(second.files.map((f) => f.source)).toEqual(first.files.map((f) => f.source))
  })

  it('reports a declared component whose source is missing rather than emitting a broken set', async () => {
    // Pointing at a directory with no components proves the refusal fires; the real set is asserted
    // clean above, so this cannot be the only evidence.
    const result = await scaffoldTenantWorkspace(join(STUDIO_ROOT, 'server'), 'Demo Site')
    expect(result.problems.length).toBeGreaterThan(0)
    expect(result.problems.every((problem) => problem.code === 'component-source-missing')).toBe(true)
    expect(result.problems[0]!.message).toContain('unable to resolve')
  })

  it('names the real admin directory, so the emit reads what the admin itself renders', () => {
    expect(ADMIN_UI_DIRECTORY).toBe('src/admin/fuma/ui')
  })
})

describe('our own reader opens what the scaffold emits', () => {
  it('opens the starter page and the auth pages with no diagnostics', async () => {
    const result = await scaffold()
    // If a scaffolded module fell outside the accepted subset the tenant would open the builder on day
    // one to an EMPTY CANVAS, which reads as the product being broken rather than as an unusual file.
    for (const path of ['app/page.tsx', 'app/layout.tsx', 'components/Hero.tsx']) {
      // The signature is (path, source). I had it reversed at first, which parsed the PATH STRING as
      // source and reported a missing default export for a file that plainly has one.
      const read = readModuleSource(path, sourceAt(result, path))
      expect(read.diagnostics, path).toEqual([])
    }
  })
})

describe('persisting the scaffold never destroys a tenant edit', () => {
  const hashOf = async (source: string): Promise<string> => `h${source.length}`

  function writerWith(existing: Record<string, string>): { writer: ScaffoldWriter; puts: string[] } {
    const puts: string[] = []
    const store = { ...existing }
    return {
      puts,
      writer: {
        get: async (path) => (store[path] === undefined ? null : { source: store[path]! }),
        put: async (path, source) => { puts.push(path); store[path] = source },
      },
    }
  }

  it('writes every module into an empty workspace', async () => {
    const result = await scaffold()
    const { writer, puts } = writerWith({})
    const outcome = await persistScaffold(writer, result, hashOf, '2026-01-01T00:00:00.000Z')
    expect(outcome.written.length).toBe(puts.length)
    expect(outcome.written).toContain('app/page.tsx')
    expect(outcome.skipped).toEqual([])
  })

  it('SKIPS a path the tenant already holds rather than overwriting their work', async () => {
    const result = await scaffold()
    const { writer, puts } = writerWith({ 'app/page.tsx': 'export default function Page() { return <main>mine</main> }' })
    const outcome = await persistScaffold(writer, result, hashOf, '2026-01-01T00:00:00.000Z')
    expect(outcome.skipped).toContain('app/page.tsx')
    expect(puts).not.toContain('app/page.tsx')
    // Re-running is therefore useful rather than destructive: everything else still lands.
    expect(outcome.written).toContain('app/sign-in/page.tsx')
  })

  it('never writes configuration through the module store', async () => {
    const result = await scaffold()
    const { writer, puts } = writerWith({})
    await persistScaffold(writer, result, hashOf, '2026-01-01T00:00:00.000Z')
    expect(puts).not.toContain('tsconfig.json')
    expect(puts).not.toContain('package.json')
  })

  it('carries the emit problems through, so a caller cannot persist and believe it was clean', async () => {
    const broken = await scaffoldTenantWorkspace(join(STUDIO_ROOT, 'server'), 'Demo Site')
    const { writer } = writerWith({})
    const outcome = await persistScaffold(writer, broken, hashOf, '2026-01-01T00:00:00.000Z')
    expect(outcome.problems.length).toBeGreaterThan(0)
  })
})
