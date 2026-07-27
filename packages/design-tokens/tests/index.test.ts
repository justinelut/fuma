import { describe, expect, it } from 'bun:test'
import {
  publicBrandColors,
  publicRadii,
  publicSpacing,
  publicTypography,
  publicWebCssVariables,
  renderCssVariables,
  type CssVariableInput,
} from '../src'

describe('@fuma/design-tokens', () => {
  it('owns the documented public brand primitives without admin component tokens', () => {
    expect(publicBrandColors).toEqual({
      black: '#000000',
      nearWhite: '#f4f4f5',
      mutedGray: '#a1a1aa',
      mint: '#8ee6c8',
      lilac: '#c8b6ff',
      sky: '#9bdcff',
      peach: '#ffc7a8',
    })
    expect(publicTypography.fontSize).toHaveProperty('display')
    expect(publicSpacing).toHaveProperty('hairline', '1px')
    expect(publicRadii).toEqual({ sm: '3px', md: '6px', lg: '12px', xl: '16px', pill: '1em' })
    expect(publicWebCssVariables.declarations).not.toHaveProperty('--bg-surface')
    expect(publicWebCssVariables.declarations).not.toHaveProperty('--danger')
  })

  it('maps every owned primitive to a namespaced public Web CSS variable', () => {
    expect(publicWebCssVariables.selector).toBe(':root')
    expect(publicWebCssVariables.declarations['--fuma-color-mint']).toBe(publicBrandColors.mint)
    expect(publicWebCssVariables.declarations['--fuma-font-sans']).toBe(publicTypography.fontFamily.sans)
    expect(publicWebCssVariables.declarations['--fuma-text-display']).toBe(publicTypography.fontSize.display)
    expect(publicWebCssVariables.declarations['--fuma-space-3xl']).toBe(publicSpacing['3xl'])
    expect(publicWebCssVariables.declarations['--fuma-radius-pill']).toBe(publicRadii.pill)
    expect(Object.keys(publicWebCssVariables.declarations)).toHaveLength(27)
  })

  it('exposes immutable token tables and CSS generation inputs', () => {
    expect(Object.isFrozen(publicBrandColors)).toBe(true)
    expect(Object.isFrozen(publicTypography)).toBe(true)
    expect(Object.isFrozen(publicTypography.fontFamily)).toBe(true)
    expect(Object.isFrozen(publicTypography.fontSize)).toBe(true)
    expect(Object.isFrozen(publicSpacing)).toBe(true)
    expect(Object.isFrozen(publicRadii)).toBe(true)
    expect(Object.isFrozen(publicWebCssVariables)).toBe(true)
    expect(Object.isFrozen(publicWebCssVariables.declarations)).toBe(true)
  })

  it('renders byte-stable CSS independent of declaration insertion order', () => {
    const forward: CssVariableInput = {
      selector: ':root',
      declarations: {
        '--fuma-z': '2px',
        '--fuma-a': '#000000',
      },
    }
    const reverse: CssVariableInput = {
      selector: ':root',
      declarations: {
        '--fuma-a': '#000000',
        '--fuma-z': '2px',
      },
    }
    const expected = ':root {\n  --fuma-a: #000000;\n  --fuma-z: 2px;\n}\n'

    expect(renderCssVariables(forward)).toBe(expected)
    expect(renderCssVariables(reverse)).toBe(expected)
    expect(renderCssVariables(publicWebCssVariables)).toBe(renderCssVariables(publicWebCssVariables))
  })
})
