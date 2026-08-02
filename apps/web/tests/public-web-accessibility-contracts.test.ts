import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8')

describe('public Web accessibility contracts', () => {
  test('shared mobile action primitives expose at least 44px targets', () => {
    const contracts = new Map([
      ['components/public-sections.tsx', 'min-h-11'],
      ['components/home-hero.tsx', 'min-h-11'],
      ['components/mobile-menu.tsx', 'size-11'],
      ['components/ui/sheet.tsx', 'size-11'],
      ['components/ui/button.tsx', 'min-h-11'],
      ['components/site-shell.tsx', 'min-h-11'],
    ])
    for (const [file, marker] of contracts) expect(read(file)).toContain(marker)
  })

  test('the product canvas uses labelled roving tabs and linked panels', () => {
    const source = read('components/motion-product-canvas.tsx')
    expect(source).toContain('aria-label="Product stages"')
    expect(source).toContain('aria-selected={active === index}')
    expect(source).toContain('aria-controls={`pc-panel-${item.id}`}')
    expect(source).toContain('const labelId = `pc-tab-${scene.id}`')
    expect(source).toContain('aria-labelledby={labelId}')
    expect(source).toContain('tabIndex={active === index ? 0 : -1}')
  })
})
