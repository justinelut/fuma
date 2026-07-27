export const publicBrandColors = Object.freeze({
  black: '#000000',
  nearWhite: '#f4f4f5',
  mutedGray: '#a1a1aa',
  mint: '#8ee6c8',
  lilac: '#c8b6ff',
  sky: '#9bdcff',
  peach: '#ffc7a8',
})

export const publicTypography = Object.freeze({
  fontFamily: Object.freeze({
    sans: '"Inter Variable", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  }),
  fontSize: Object.freeze({
    xs: 'clamp(14px, calc(13.257px + 0.19vw), 16px)',
    sm: 'clamp(16px, calc(15.257px + 0.19vw), 18px)',
    md: 'clamp(20px, calc(18.514px + 0.381vw), 24px)',
    lg: 'clamp(24px, calc(22.514px + 0.381vw), 28px)',
    display: 'clamp(40px, calc(34.057px + 1.524vw), 56px)',
  }),
})

export const publicSpacing = Object.freeze({
  hairline: '1px',
  xs: 'clamp(4px, calc(3.629px + 0.095vw), 5px)',
  sm: 'clamp(6px, calc(5.257px + 0.19vw), 8px)',
  md: 'clamp(8px, calc(7.257px + 0.19vw), 10px)',
  lg: 'clamp(14px, calc(13.257px + 0.19vw), 16px)',
  xl: 'clamp(20px, calc(18.514px + 0.381vw), 24px)',
  '2xl': 'clamp(32px, calc(29.029px + 0.762vw), 40px)',
  '3xl': 'clamp(56px, calc(50.057px + 1.524vw), 72px)',
})

export const publicRadii = Object.freeze({
  sm: '3px',
  md: '6px',
  lg: '12px',
  xl: '16px',
  pill: '1em',
})

export type CssVariableName = `--${string}`

export type CssVariableInput = Readonly<{
  selector: string
  declarations: Readonly<Record<CssVariableName, string>>
}>

export const publicWebCssVariables = Object.freeze({
  selector: ':root',
  declarations: Object.freeze({
    '--fuma-color-black': publicBrandColors.black,
    '--fuma-color-near-white': publicBrandColors.nearWhite,
    '--fuma-color-muted-gray': publicBrandColors.mutedGray,
    '--fuma-color-mint': publicBrandColors.mint,
    '--fuma-color-lilac': publicBrandColors.lilac,
    '--fuma-color-sky': publicBrandColors.sky,
    '--fuma-color-peach': publicBrandColors.peach,
    '--fuma-font-sans': publicTypography.fontFamily.sans,
    '--fuma-font-mono': publicTypography.fontFamily.mono,
    '--fuma-text-xs': publicTypography.fontSize.xs,
    '--fuma-text-sm': publicTypography.fontSize.sm,
    '--fuma-text-md': publicTypography.fontSize.md,
    '--fuma-text-lg': publicTypography.fontSize.lg,
    '--fuma-text-display': publicTypography.fontSize.display,
    '--fuma-space-hairline': publicSpacing.hairline,
    '--fuma-space-xs': publicSpacing.xs,
    '--fuma-space-sm': publicSpacing.sm,
    '--fuma-space-md': publicSpacing.md,
    '--fuma-space-lg': publicSpacing.lg,
    '--fuma-space-xl': publicSpacing.xl,
    '--fuma-space-2xl': publicSpacing['2xl'],
    '--fuma-space-3xl': publicSpacing['3xl'],
    '--fuma-radius-sm': publicRadii.sm,
    '--fuma-radius-md': publicRadii.md,
    '--fuma-radius-lg': publicRadii.lg,
    '--fuma-radius-xl': publicRadii.xl,
    '--fuma-radius-pill': publicRadii.pill,
  }),
}) satisfies CssVariableInput

function compareNames(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function renderCssVariables(input: CssVariableInput): string {
  const declarations = Object.entries(input.declarations)
    .sort(([left], [right]) => compareNames(left, right))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  return `${input.selector} {\n${declarations}\n}\n`
}
