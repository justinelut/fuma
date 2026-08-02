import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8')

describe('FUMA-WEB-012 integrated visual system', () => {
  test('mounts one accessible Motion product canvas with an SSR-visible first scene', () => {
    const hero = read('components/home-hero.tsx')
    const canvas = read('components/motion-product-canvas.tsx')
    const panel = read('components/motion-product-panel.tsx')

    expect(hero.match(/<MotionProductCanvasIsland\b/g)).toHaveLength(1)
    for (const capture of ['site.webp', 'content.webp', 'dashboard.webp']) expect(hero).toContain(`/product/${capture}`)
    for (const marker of ['role="tablist"', 'role="tab"', 'aria-controls=', 'role="tabpanel"', 'tabIndex=', 'ArrowRight', 'Home', 'End']) {
      expect(canvas).toContain(marker)
    }
    expect(canvas).toContain("lazy(() => import('./motion-product-panel')")
    expect(canvas).toContain('const staticPanel = <div')
    expect(canvas).toContain('motionRequested')
    expect(panel).toContain('initial={reduced ? false')
    expect(panel).toContain('useReducedMotion')
    expect(panel).toContain("from 'motion/react'")
    expect(panel).toContain("from 'motion/react-m'")
  })

  test('uses one direct animation dependency and no competing animation API', () => {
    const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies.motion).toBe('12.43.0')
    expect(manifest.dependencies['framer-motion']).toBeUndefined()

    const production = [
      'components/motion-product-canvas.tsx',
      'components/motion-product-panel.tsx',
      'components/home-hero.tsx',
      'app/page.tsx',
    ].map(read).join('\n')
    expect(production).not.toContain("from 'framer-motion'")
  })

  test('keeps mutable status and unsupported commercial promises out of static presentation', () => {
    const source = [
      'components/site-shell.tsx',
      'components/site-nav.tsx',
      'components/stack-collapse.tsx',
      'app/page.tsx',
    ].map(read).join('\n')
    expect(source).not.toMatch(/All services online|One bill|no hidden per-seat surprises/i)
    expect(source).toContain('Service status')
    expect(source).toContain('Current KES plans and what each one includes.')
  })

  test('uses action-first account copy without narrating infrastructure', () => {
    const accountEntry = [
      'app/start/page.tsx',
      'components/intent-form.tsx',
    ].map(read).join('\n')
    expect(accountEntry).toContain('Log in to Fuma')
    expect(accountEntry).toContain("sign_in: 'Log in'")
    expect(accountEntry).toContain('You’ll be asked to sign in if needed.')
    expect(accountEntry).not.toMatch(/Secure application transition|valid, closed request shape|Intent \/ resolution signature|What crosses this boundary|Preparing a safe transition|Continue to the Fuma application|app\.trimly\.co\.ke|public-site cookie/i)
  })
})