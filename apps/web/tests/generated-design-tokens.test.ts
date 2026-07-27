import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  GENERATED_DESIGN_TOKEN_CSS_PATH,
  buildGeneratedDesignTokenCss,
} from '../scripts/sync-design-token-css'

describe('public Web generated design tokens', () => {
  test('the committed generated CSS is byte-current', () => {
    expect(readFileSync(GENERATED_DESIGN_TOKEN_CSS_PATH, 'utf8')).toBe(buildGeneratedDesignTokenCss())
  })

  test('every generated primitive remains Fuma-namespaced', () => {
    const declarations = buildGeneratedDesignTokenCss()
      .split('\n')
      .filter((line) => line.trimStart().startsWith('--'))

    expect(declarations.length).toBeGreaterThan(0)
    expect(declarations.every((line) => line.trimStart().startsWith('--fuma-'))).toBe(true)
  })
})
