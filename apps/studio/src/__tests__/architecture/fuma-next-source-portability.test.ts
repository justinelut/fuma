import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../..')
const PORTABILITY_ROOTS = [
  'apps/studio/server/fuma/nextSource',
  'apps/studio/src/core/siteImport',
  'apps/studio/src/admin/modals/SiteImport/shared',
  'apps/studio/src/admin/modals/SiteImport/steps',
] as const

function ticketFiles(): readonly string[] {
  const output: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(join(ROOT, path))) {
      const child = join(path, entry)
      const stat = statSync(join(ROOT, child))
      if (stat.isDirectory()) walk(child)
      else if (/\.(?:ts|tsx|css)$/.test(entry) && /nextSource|NextSource/.test(entry)) output.push(child)
    }
  }
  for (const path of PORTABILITY_ROOTS) walk(path)
  return output.sort()
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('FUMA-077 generic Next.js source portability architecture', () => {
  test('keeps the portability authority generic, app-local, TypeBox-only, and Tailwind-free', () => {
    const files = ticketFiles()
    expect(files.length).toBeGreaterThan(10)
    const source = files.map((path) => `// ${relative(ROOT, join(ROOT, path))}\n${read(path)}`).join('\n')
    expect(source).not.toMatch(/lawyerImport|LawyerRuntime|thelawyer/i)
    expect(source).not.toMatch(/from ['"]zod|require\(['"]zod|@fuma\/shared-ui|from ['"][^'"]*apps\/(?:web|site-runtime|control-surfaces)/)
    expect(source).not.toMatch(/className=["'][^"']*(?:^|\s)(?:p|m|text|bg|grid|flex)-/m)
    expect(read('apps/studio/src/core/siteImport/nextSourceContracts.ts')).toContain('{ additionalProperties: false }')
  })

  test('never executes, installs, or dynamically imports tenant source in the projection path', () => {
    const source = [
      'apps/studio/server/fuma/nextSource/projection.ts',
      'apps/studio/server/fuma/nextSource/projectionShared.ts',
      'apps/studio/server/fuma/nextSource/projectionEvaluator.ts',
      'apps/studio/server/fuma/nextSource/projectionCompiler.ts',
    ].map(read).join('\n')
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\b|Bun\.(?:spawn|spawnSync)|child_process|npm\s+install|bun\s+install/)
    expect(source).not.toMatch(/\bimport\s*\(\s*(?:source|specifier|path|revision|files)/)
    expect(source).toContain('MAX_STATIC_COLLECTION_ITEMS')
    expect(source).toContain('MAX_PROJECTED_NODES_PER_ROUTE')
    expect(source).toContain('Static JSX map callback must be an inline function.')
    expect(source).toContain('Static collection predicates must be inline functions.')
    expect(source).toContain('Static collection predicates must contain one unconditional return.')
    expect(source).toContain("method === 'keys' || method === 'values' || method === 'entries'")
    expect(source).toContain('tuple destructuring must be flat, contiguous, and explicit.')
    expect(source).toContain('accepts only a scalar needle.')
    expect(source).toContain("method === 'startsWith' || method === 'endsWith'")
    expect(source).toContain('Static split separator must be a string literal, never a regular expression.')
    expect(source).toContain('Static split exceeds the bounded projection item limit.')
    expect(source).toContain('Static join accepts only scalar array values.')
    expect(source).toContain('Static string operation exceeds the bounded output limit.')
    expect(source).not.toMatch(/callback\s*\.\s*(?:call|apply)\s*\(|Reflect\.apply\s*\(/)
  })

  test('inventories only bounded finite class alternatives without evaluating source', () => {
    const classifier = read('apps/studio/src/core/siteImport/nextSourceStaticClasses.ts')
    const analyzer = read('apps/studio/src/core/siteImport/analyzeNextSource.ts')
    expect(classifier).toContain('const MAX_ALTERNATIVES = 64')
    expect(classifier).toContain('const MAX_OBJECT_PROPERTIES = 64')
    expect(classifier).toContain('collectBindings')
    expect(classifier).toContain('collectFiniteLocalComponentProps')
    expect(classifier).toContain('objectBindingIsReadOnly')
    expect(classifier).toContain('ts.createSourceFile')
    expect(classifier).toContain('dynamicOffsets.push')
    expect(classifier).not.toMatch(/\beval\s*\(|new\s+Function|callback\s*\.\s*(?:call|apply)|Reflect\.apply/)
    expect(analyzer).toContain('analyzeNextSourceStaticClasses(source).dynamicOffsets')
    expect(analyzer).toContain('analyzeNextSourceStaticClasses(source).staticClassNames')
  })

  test('keeps next/font/google adaptation source-only, hash-bound, owner-reviewed, and fail-closed', () => {
    const generator = read('apps/studio/src/core/siteImport/nextSourceFontAdaptation.ts')
    const contracts = read('apps/studio/src/core/siteImport/nextSourcePortabilityContracts.ts')
    const service = read('apps/studio/src/core/siteImport/nextSourceAdaptation.ts')
    expect(generator).toContain("ts.createSourceFile")
    expect(generator).toContain("specifier !== 'next/font/google'")
    expect(generator).toContain('only .variable in a className template is reviewed')
    expect(generator).toContain('must occur exactly once in an imported CSS token declaration')
    expect(generator).toContain('styleChange: \'review-required-system-fallback\'')
    expect(generator).not.toMatch(/\bfetch\s*\(|https?:\/\/|Bun\.(?:spawn|spawnSync)|child_process|npm\s+install|bun\s+install/)
    expect(contracts).toContain("Type.Literal('next-font-google-system-fallback')")
    expect(contracts).toContain("Type.Literal('review-required-system-fallback')")
    expect(contracts).toContain('networkAccessed: Type.Literal(false)')
    expect(contracts).toContain('fontDownloaded: Type.Literal(false)')
    expect(contracts).toContain('importedCodeExecuted: Type.Literal(false)')
    expect(contracts).toContain('dependencyChanged: Type.Literal(false)')
    expect(service).toContain("input.authority.actorId !== 'fuma-next-source-policy'")
    expect(service).toContain('beforeUnsupported - afterUnsupported !== 1')
    expect(service).toContain('Executable adaptation requires owner diff confirmation.')
  })

  test('keeps podcast publication blocked until a reviewed canonical authority exists', () => {
    const bindings = read('apps/studio/src/core/siteImport/nextSourceInteractionBindings.ts')
    expect(bindings).toContain('podcast: []')
    expect(bindings).toContain('Current Publication contracts do not model episodes/audio enclosures.')
    expect(bindings).not.toContain("podcast: ['publication.content']")
  })

  test('keeps GitHub App import inert until both exact credentials are configured', () => {
    const server = read('apps/studio/server/index.ts')
    expect(server).toContain('process.env.FUMA_GITHUB_APP_ID?.trim()')
    expect(server).toContain('&& process.env.FUMA_GITHUB_APP_PRIVATE_KEY_PEM?.trim()')
    expect(server).toContain('...(nextSourceGithubConfigured')
    expect(server).not.toContain("hostedFumaConfig.environment === 'production' || nextSourceGithubConfigured")
  })
})
