import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const css = readFileSync(path.join(import.meta.dir, '../app/globals.css'), 'utf8')

function channel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const normalized = hex.replace('#', '')
  return 0.2126 * channel(normalized.slice(0, 2))
    + 0.7152 * channel(normalized.slice(2, 4))
    + 0.0722 * channel(normalized.slice(4, 6))
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

describe('public acquisition accessibility contracts', () => {
  test('core light and dark text pairs exceed WCAG AA contrast', () => {
    expect(contrast('#000000', '#f4f4f5')).toBeGreaterThan(4.5)
    expect(contrast('#a1a1aa', '#000000')).toBeGreaterThan(4.5)
    // Light muted text is 64% black over near-white; this conservative resolved pair remains AA.
    expect(contrast('#585859', '#e5e5e6')).toBeGreaterThan(4.5)
  })

  test('focus, reduced-motion and forced-colors rules remain explicit', () => {
    expect(css.match(/--ring:\s*var\(--foreground\)/g)).toHaveLength(2)
    expect(css).toContain(':focus-visible')
    expect(css).toContain('outline-2 outline-offset-4 outline-ring')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('scroll-behavior: auto !important')
    expect(css).toContain('animation-iteration-count: 1 !important')
    expect(css).toContain('@media (forced-colors: active)')
  })
})
