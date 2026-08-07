/**
 * Tasks 71, 72 and 73: shadcn as the default building blocks, importable into the components
 * section, with the unstyled primitive layer behind it.
 *
 * Every claim is checked against the SHIPPED components and the SHIPPED baseline rather than against
 * this file's own list, so a component or a dependency changing surfaces here.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADMIN_SPECIFIERS,
  DEFAULT_BLOCKS,
  PRIMITIVE_LAYER,
  PRIMITIVE_PACKAGE,
  TENANT_SHADCN_COMPONENTS,
  isTenantImportable,
  reviewTenantComponent,
  rewriteForTenant,
  tenantPathFor,
} from '../../core/generatedSite/shadcnBaseline'
import { allBaselinePackages } from '../../core/generatedSite/libraryBaseline'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const UI_DIR = join(STUDIO, 'src/admin/fuma/ui')

// The baseline's OWN accessor, not a concatenation of its two lists - composing them here would
// drift the moment a third list is added.
const PINNED: readonly string[] = allBaselinePackages().map((p) => p.name)

/** Package specifiers a source file imports, read from the real file. */
function importsOf(source: string): string[] {
  const found: string[] = []
  const pattern = /from\s+["']([^"']+)["']/g
  for (const match of source.matchAll(pattern)) found.push(match[1]!)
  return found
}

function adminSourceFor(name: string): string {
  return readFileSync(join(UI_DIR, `${name}.tsx`), 'utf8')
}

describe('every declared component actually exists in the shipped set', () => {
  it('so the list cannot name something that was renamed or removed', () => {
    for (const component of TENANT_SHADCN_COMPONENTS) {
      expect(existsSync(join(UI_DIR, `${component.name}.tsx`))).toBe(true)
    }
  })

  it('and the shipped set is genuinely shadcn, not a lookalike', () => {
    // cva + the cn helper is shadcn's own shape; asserting it means a rewrite that abandoned the
    // convention would surface here rather than producing components the tenant cannot recognise.
    const button = adminSourceFor('button')
    expect(button).toContain('class-variance-authority')
    expect(button).toContain('cn(')
  })
})

describe('THE MEMBERSHIP RULE: every shipped component\'s dependencies are pinned', () => {
  it('holds for every component in the tenant set', () => {
    // This is the assertion that makes the set derived rather than opinion. A component whose
    // package is not pinned would install fine and fail the tenant's build.
    const unpinned: string[] = []
    for (const component of TENANT_SHADCN_COMPONENTS) {
      const emitted = rewriteForTenant(adminSourceFor(component.name))
      for (const specifier of importsOf(emitted)) {
        if (!isTenantImportable(specifier, PINNED)) {
          unpinned.push(`${component.name} -> ${specifier}`)
        }
      }
    }
    expect(unpinned).toEqual([])
  })

  it('and the components deliberately EXCLUDED are excluded for that reason', () => {
    // Proving the rule bites: these exist in the admin and pull packages the tenant does not have.
    const excludedForDependency = ['chart', 'drawer', 'sonner', 'resizable', 'input-otp', 'command', 'carousel']
    const names = TENANT_SHADCN_COMPONENTS.map((c) => c.name)
    for (const excluded of excludedForDependency) {
      expect(names).not.toContain(excluded)
      if (!existsSync(join(UI_DIR, `${excluded}.tsx`))) continue
      const specifiers = importsOf(adminSourceFor(excluded))
      const unpinned = specifiers.filter((s) => !isTenantImportable(s, PINNED))
      // Each is absent because of a real unpinned package, not because somebody disliked it.
      expect(unpinned.length).toBeGreaterThan(0)
    }
  })

  it('radix-ui itself is pinned, or every primitive-backed component is unshippable', () => {
    expect(PINNED).toContain(PRIMITIVE_PACKAGE)
  })
})

describe('rewriting for the tenant', () => {
  it('replaces the admin cn alias, which does not resolve in a generated site', () => {
    const emitted = rewriteForTenant(adminSourceFor('button'))
    expect(emitted).toContain('@/lib/utils')
    for (const specifier of ADMIN_SPECIFIERS) {
      expect(emitted).not.toContain(`"${specifier}"`)
    }
  })

  it('and NO emitted component retains any admin path', () => {
    for (const component of TENANT_SHADCN_COMPONENTS) {
      const emitted = rewriteForTenant(adminSourceFor(component.name))
      expect(emitted).not.toContain('@admin/')
    }
  })

  it('rewrites a component that composes another to the tenant\'s own directory', () => {
    // Several shadcn components import button; left alone that is an admin path in a tenant file.
    const rewritten = rewriteForTenant('import { Button } from "@admin/fuma/ui/button"')
    expect(rewritten).toBe('import { Button } from "@/components/ui/button"')
  })

  it('targets the shadcn-conventional location so the tenant finds them where they expect', () => {
    expect(tenantPathFor('button')).toBe('components/ui/button.tsx')
  })

  it('and the starter already emits the cn target, so the rewrite does not dangle', () => {
    const starter = readFileSync(join(STUDIO, 'src/core/generatedSite/starterTemplate.ts'), 'utf8')
    expect(starter).toContain('lib/utils.ts')
    expect(starter).toContain('export function cn(')
  })

  it('and the starter resolves @/ WITHOUT baseUrl, which TypeScript 6 deprecates', () => {
    // The baseline pins typescript 6.0.3, where `baseUrl` is a hard TS5101 error unless
    // ignoreDeprecations is set - so a starter carrying it would fail every tenant's own typecheck
    // with a message about a compiler option rather than about their code. Measured while compiling
    // the emitted components: my own probe config hit exactly that error, the starter does not.
    const starter = readFileSync(join(STUDIO, 'src/core/generatedSite/starterTemplate.ts'), 'utf8')
    expect(starter).toContain('"paths"')
    expect(starter).not.toContain('"baseUrl"')
  })
})

describe('the import gate', () => {
  it('allows a tenant-relative path with no pin', () => {
    expect(isTenantImportable('@/lib/utils', [])).toBe(true)
    expect(isTenantImportable('./cn', [])).toBe(true)
  })

  it('resolves a sub-path against its package root', () => {
    expect(isTenantImportable('react-dom/server', ['react-dom'])).toBe(true)
  })

  it('handles a scoped package as two segments, not one', () => {
    expect(isTenantImportable('@hookform/resolvers/zod', ['@hookform/resolvers'])).toBe(true)
    expect(isTenantImportable('@hookform/resolvers/zod', ['@hookform'])).toBe(false)
  })

  it('refuses an unpinned package', () => {
    expect(isTenantImportable('cmdk', PINNED)).toBe(false)
  })
})

describe('the review catches both failures', () => {
  it('a sound component reports nothing', () => {
    expect(reviewTenantComponent({
      name: 'button',
      source: 'import { cn } from "@/lib/utils"',
      imports: ['@/lib/utils', 'react'],
      pinnedPackages: PINNED,
    })).toHaveLength(0)
  })

  it('a surviving admin path names the consequence', () => {
    const problems = reviewTenantComponent({
      name: 'button',
      source: 'import { cn } from "@admin/fuma/ui/cn"',
      imports: [],
      pinnedPackages: PINNED,
    })
    expect(problems.map((p) => p.code)).toContain('admin-path-survived')
    expect(problems[0]!.message).toContain('does not resolve')
  })

  it('an unpinned dependency states that install succeeds and the BUILD fails', () => {
    const problems = reviewTenantComponent({
      name: 'command',
      source: '',
      imports: ['cmdk'],
      pinnedPackages: PINNED,
    })
    const message = problems.find((p) => p.code === 'dependency-not-pinned')!.message
    expect(message).toContain('build would fail')
  })
})

describe('the primitive layer behind shadcn (task 73)', () => {
  it('is radix-ui, already installed for every generated site', () => {
    expect(PRIMITIVE_LAYER.package).toBe('radix-ui')
    expect(PRIMITIVE_LAYER.why).toContain('already installed')
  })

  it('states when to reach for it AND what it costs', () => {
    // Offering the unstyled layer without stating the cost invites reaching for it by default.
    expect(PRIMITIVE_LAYER.whenToUseDirectly.length).toBeGreaterThan(40)
    expect(PRIMITIVE_LAYER.cost).toContain('unstyled')
  })

  it('and every declared primitive is one radix really exports', () => {
    // A primitive name nobody can import is a promise the component cannot keep.
    const radixIndex = join(STUDIO, '..', '..', 'node_modules', 'radix-ui', 'dist', 'index.d.ts')
    if (!existsSync(radixIndex)) return
    const declared = readFileSync(radixIndex, 'utf8')
    for (const component of TENANT_SHADCN_COMPONENTS) {
      if (component.primitive === null) continue
      expect(declared).toContain(component.primitive)
    }
  })
})

describe('the set is a considered subset, not everything available', () => {
  it('is smaller than the admin\'s own set', () => {
    const shipped = readdirSync(UI_DIR).filter((f) => f.endsWith('.tsx')).length
    expect(TENANT_SHADCN_COMPONENTS.length).toBeLessThan(shipped)
  })

  it('every entry states why a site gets it', () => {
    // A component nobody can justify is one nobody can remove.
    for (const component of TENANT_SHADCN_COMPONENTS) {
      expect(component.reason.length).toBeGreaterThan(30)
    }
  })

  it('names no component twice', () => {
    const names = TENANT_SHADCN_COMPONENTS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers the form controls task 75 composes', () => {
    const names = TENANT_SHADCN_COMPONENTS.map((c) => c.name)
    for (const required of ['input', 'textarea', 'label', 'checkbox', 'select', 'button']) {
      expect(names).toContain(required)
    }
  })
})

describe('"default building blocks" means something checkable', () => {
  it('states the rule, the reason and the deliberate escape', () => {
    expect(DEFAULT_BLOCKS.rule).toContain('before it composes bare elements')
    expect(DEFAULT_BLOCKS.why).toContain('drifts')
    // Bare elements staying available matters: wrapping a section in a component adds indirection
    // the canvas cannot style, which is task 61's finding.
    expect(DEFAULT_BLOCKS.escape).toContain('indirection')
  })

  it('and the AI prompt actually instructs it, or the default is only a document', () => {
    const prompt = readFileSync(join(STUDIO, 'src/core/ai/tsxAuthoringPrompt.ts'), 'utf8')
    expect(prompt).toContain('shadcn components before writing your own')
    expect(prompt).toContain('@/components/ui/button')
  })

  it('EVERY component the prompt lists is one the tenant actually receives', () => {
    // The drift that would otherwise happen silently: the prompt names a component the site does not
    // have, the AI imports it, and the tenant's build fails on a missing module.
    const prompt = readFileSync(join(STUDIO, 'src/core/ai/tsxAuthoringPrompt.ts'), 'utf8')
    const listed = /- Available: ([^\n]+)/.exec(prompt)?.[1] ?? ''
    expect(listed.length).toBeGreaterThan(0)
    const names = listed.replace(/\.$/, '').split(',').map((n) => n.trim()).filter(Boolean)
    expect(names.length).toBeGreaterThan(10)
    const shipped = TENANT_SHADCN_COMPONENTS.map((c) => c.name)
    for (const name of names) expect(shipped).toContain(name)
  })

  it('and the prompt tells the model to use variants rather than overriding className', () => {
    // The sharp point: a className override is both a drift and unavailable to the canvas, because
    // the cva variants are what task 72 turns into controls.
    const prompt = readFileSync(join(STUDIO, 'src/core/ai/tsxAuthoringPrompt.ts'), 'utf8')
    expect(prompt).toContain('NOT by overriding with className')
    expect(prompt).toContain('asChild')
  })
})
