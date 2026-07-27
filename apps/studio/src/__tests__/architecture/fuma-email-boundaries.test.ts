import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const STUDIO_ROOT = resolve(import.meta.dir, '../../..')
const EMAIL_ROOT = join(STUDIO_ROOT, 'server/fuma/email')
const TENANT_RENDERER = join(EMAIL_ROOT, 'tenantDocumentRenderer.ts')
const TRUSTED_RENDERER = join(EMAIL_ROOT, 'trustedSystemTemplateRenderer.tsx')
const DOCUMENT_CONTRACT = join(STUDIO_ROOT, 'src/core/fuma/email/document.ts')
const ALLOWED_NODE_TYPES = [
  'button',
  'column',
  'container',
  'divider',
  'heading',
  'image',
  'link',
  'row',
  'section',
  'spacer',
  'text',
]

async function productionReferences(symbol: string): Promise<string[]> {
  const references: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['__tests__', 'compatibility', 'node_modules'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (/\.(?:ts|tsx)$/.test(entry.name) && (await Bun.file(path).text()).includes(symbol)) {
        references.push(relative(STUDIO_ROOT, path).replaceAll('\\', '/'))
      }
    }
  }
  await visit(join(STUDIO_ROOT, 'server'))
  return references.sort()
}

describe('FUMA-042 tenant email architecture', () => {
  test('keeps a versioned strict TypeBox data contract with bounded resources and no Zod', async () => {
    const source = await Bun.file(DOCUMENT_CONTRACT).text()
    expect(source).toContain("export const EMAIL_DOCUMENT_VERSION = 1 as const")
    expect(source).toContain('export const EmailDocumentSchema = Type.Object(')
    expect(source).toContain('{ additionalProperties: false')
    expect(source).toContain('EMAIL_DOCUMENT_MAX_BYTES')
    expect(source).toContain('EMAIL_DOCUMENT_MAX_DEPTH')
    expect(source).toContain('EMAIL_DOCUMENT_MAX_NODES')
    expect(source).toContain('EMAIL_DOCUMENT_MAX_OUTPUT_BYTES')
    expect(source).not.toMatch(/from ['"]zod|require\(['"]zod/)
  })

  test('maps only the closed static component allowlist after validation', async () => {
    const source = await Bun.file(TENANT_RENDERER).text()
    const cases = [...source.matchAll(/case '([^']+)'/g)].map((match) => match[1]).sort()
    expect(cases).toEqual(ALLOWED_NODE_TYPES)
    expect(source.indexOf('const document = parseEmailDocument(input)'))
      .toBeLessThan(source.indexOf('const element = createTenantElement(document)'))
    expect(source).not.toMatch(/createElement\(node\.|dangerouslySetInnerHTML|\beval\s*\(|new Function|import\s*\(|require\s*\(/)
    expect(source).not.toContain('renderTrustedSystemTemplate')
  })

  test('keeps trusted server JSX explicit and unreachable from production tenant callers', async () => {
    const trusted = await Bun.file(TRUSTED_RENDERER).text()
    expect(trusted).toContain('serverAuthoredTemplate: ReactNode')
    expect(trusted).not.toContain('parseEmailDocument')
    expect(await productionReferences('renderTrustedSystemTemplate')).toEqual([
      'server/fuma/email/index.ts',
      'server/fuma/email/trustedSystemTemplateRenderer.tsx',
    ])
  })
})
