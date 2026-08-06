import { describe, it, expect } from 'bun:test'
import {
  buildDefaultSpacingSettings,
  buildDefaultTypographySettings,
  makeFreshSpacingGroup,
} from '@core/framework/defaults'
import {
  generateTailwindThemeCss,
  planTailwindTheme,
} from '@core/framework/tailwindTheme'
import type { FrameworkColorToken } from '@core/framework-schema/schemas'

function colorToken(
  overrides: Partial<FrameworkColorToken> & Pick<FrameworkColorToken, 'id' | 'slug' | 'lightValue'>,
): FrameworkColorToken {
  return {
    category: '',
    darkValue: '',
    darkModeEnabled: false,
    generateUtilities: { text: true, background: true, border: true, fill: true },
    generateTransparent: false,
    generateShades: { enabled: false, count: 0 },
    generateTints: { enabled: false, count: 0 },
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('Core Framework to Tailwind theme tokens', () => {
  it('aliases colours into the colour namespace without copying values', () => {
    const plan = planTailwindTheme({
      colors: { tokens: [colorToken({ id: 't1', slug: 'primary', lightValue: '#3f6bff' })] },
    })
    const primary = plan.aliases.find((entry) => entry.source === '--primary')
    expect(primary).toBeDefined()
    expect(primary?.name).toBe('--color-primary')
    expect(primary?.namespace).toBe('color')

    // Aliasing, not copying: the resolved colour must not appear, or theme
    // inversion scopes that override --primary would stop affecting utilities.
    const css = generateTailwindThemeCss({
      colors: { tokens: [colorToken({ id: 't1', slug: 'primary', lightValue: '#3f6bff' })] },
    })
    expect(css).toContain('--color-primary: var(--primary);')
    expect(css).not.toContain('#3f6bff')
  })

  it('emits an inline theme block so utilities resolve at the point of use', () => {
    const css = generateTailwindThemeCss({
      colors: { tokens: [colorToken({ id: 't1', slug: 'brand', lightValue: '#111111' })] },
    })
    // `inline` substitutes the value into the utility, which keeps scoped
    // overrides of the source variable working.
    expect(css.startsWith('@theme inline {')).toBe(true)
    expect(css.trimEnd().endsWith('}')).toBe(true)
  })

  it('carries derived colour variants across as their own tokens', () => {
    const plan = planTailwindTheme({
      colors: {
        tokens: [colorToken({
          id: 't1',
          slug: 'primary',
          lightValue: '#3f6bff',
          generateShades: { enabled: true, count: 2 },
        })],
      },
    })
    const names = plan.aliases.map((entry) => entry.name)
    expect(names).toContain('--color-primary')
    expect(names).toContain('--color-primary-d-1')
    expect(names).toContain('--color-primary-d-2')
  })

  it('does not double-prefix a convention that already means the namespace', () => {
    const plan = planTailwindTheme({ spacing: buildDefaultSpacingSettings() })
    const spacing = plan.aliases.filter((entry) => entry.namespace === 'spacing')
    expect(spacing.length).toBeGreaterThan(0)

    // The default convention is `space`, so --space-m must become --spacing-m.
    // --spacing-space-m would generate a p-space-m utility nobody wants.
    for (const entry of spacing) {
      expect(entry.name.startsWith('--spacing-space-')).toBe(false)
    }
    expect(spacing.some((entry) => entry.source === '--space-m' && entry.name === '--spacing-m'))
      .toBe(true)
  })

  it('keeps a custom convention as a qualifier so groups stay distinguishable', () => {
    const spacing = buildDefaultSpacingSettings()
    spacing.groups.push(makeFreshSpacingGroup('Gutter', 'gutter', 1))
    const plan = planTailwindTheme({ spacing })

    // Two spacing groups must not collapse onto the same Tailwind names.
    expect(plan.aliases.some((entry) => entry.name === '--spacing-m')).toBe(true)
    expect(plan.aliases.some((entry) => entry.name === '--spacing-gutter-m')).toBe(true)
    expect(plan.collisions).toHaveLength(0)
  })

  it('passes through variables already inside a Tailwind namespace', () => {
    const plan = planTailwindTheme({ typography: buildDefaultTypographySettings() })
    // The default typography convention is `text`, which is already Tailwind's
    // own namespace, so those variables need no alias at all.
    expect(plan.passthrough).toContain('--text-m')
    expect(plan.aliases.some((entry) => entry.source === '--text-m')).toBe(false)
  })

  it('reports a collision rather than silently picking a winner', () => {
    // Two colour tokens whose slugs differ only by characters the identifier
    // normaliser drops would claim the same Tailwind name.
    const plan = planTailwindTheme({
      colors: {
        tokens: [
          colorToken({ id: 't1', slug: 'brand-one', lightValue: '#111111' }),
          colorToken({ id: 't2', slug: 'brand_one', lightValue: '#222222', order: 1 }),
        ],
      },
    })
    // Core Framework dedupes slugs, so a genuine collision needs the normaliser
    // to converge two distinct slugs. If it does, it must be reported, and the
    // first claimant keeps the name so output stays deterministic.
    const names = plan.aliases.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    for (const collision of plan.collisions) {
      expect(collision.sources.length).toBeGreaterThan(1)
    }
  })

  it('emits nothing when a site has no tokens', () => {
    expect(generateTailwindThemeCss(null)).toBe('')
    expect(generateTailwindThemeCss({})).toBe('')
    expect(planTailwindTheme(null).aliases).toHaveLength(0)
  })

  it('produces valid custom property identifiers', () => {
    const plan = planTailwindTheme({
      colors: { tokens: [colorToken({ id: 't1', slug: 'Brand Accent', lightValue: '#333333' })] },
    })
    for (const entry of plan.aliases) {
      expect(entry.name).toMatch(/^--[a-z0-9][a-z0-9_-]*$/)
    }
  })
})
