import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const ADAPTER = join(STUDIO, 'src/admin/onlook')

function adapterSource(): string {
  return readdirSync(ADAPTER)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.css'))
    .map((name) => readFileSync(join(ADAPTER, name), 'utf8'))
    .join('\n')
}

describe('Onlook Studio boundary', () => {
  it('is presentation over Fuma editor authority, not a second platform', () => {
    const source = adapterSource()

    expect(source).toContain("from '@site/store/store'")
    for (const forbidden of [
      '@onlook/',
      'better-auth',
      '@onlook/db',
      'CodeSandbox',
      'CSB_API_KEY',
      'FREESTYLE_API_KEY',
      'drizzle',
      'MinIO',
      'k8s/',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('is mounted only by the visual editor layout', () => {
    const layout = readFileSync(
      join(STUDIO, 'src/admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx'),
      'utf8',
    )
    const body = readFileSync(
      join(STUDIO, 'src/admin/layouts/AdminCanvasLayout/AdminCanvasEditorBody.tsx'),
      'utf8',
    )

    expect(layout).toContain('data-studio-surface="onlook"')
    expect(layout).toContain('OnlookStudioSurface.module.css')
    expect(body).toContain('<OnlookStudioToolDock />')
  })
})
