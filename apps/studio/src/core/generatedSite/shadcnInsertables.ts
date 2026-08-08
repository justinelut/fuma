import { TENANT_SHADCN_COMPONENTS } from './shadcnBaseline'

/**
 * One primary export from every preinstalled shadcn file that can be inserted on the canvas.
 *
 * Explicit symbols are deliberate. Deriving `AlertDialog` from `alert-dialog` looks harmless until a
 * file exports several related components (CardHeader, CardTitle, CardContent) or an export does not
 * follow filename casing. The insertion surface must name an export the emitted source actually owns,
 * not one guessed from a path.
 */
export type ShadcnInsertable = Readonly<{
  file: string
  symbol: string
  source: `@/components/ui/${string}`
  componentId: `ui.${string}`
  reason: string
}>

const PRIMARY_EXPORTS: ReadonlyArray<Readonly<{ file: string, symbol: string }>> = Object.freeze([
  { file: 'button', symbol: 'Button' },
  { file: 'card', symbol: 'Card' },
  { file: 'input', symbol: 'Input' },
  { file: 'textarea', symbol: 'Textarea' },
  { file: 'label', symbol: 'Label' },
  { file: 'checkbox', symbol: 'Checkbox' },
  { file: 'radio-group', symbol: 'RadioGroup' },
  { file: 'select', symbol: 'Select' },
  { file: 'switch', symbol: 'Switch' },
  { file: 'separator', symbol: 'Separator' },
  { file: 'badge', symbol: 'Badge' },
  { file: 'avatar', symbol: 'Avatar' },
  { file: 'accordion', symbol: 'Accordion' },
  { file: 'tabs', symbol: 'Tabs' },
  { file: 'dialog', symbol: 'Dialog' },
  { file: 'sheet', symbol: 'Sheet' },
  { file: 'dropdown-menu', symbol: 'DropdownMenu' },
  { file: 'navigation-menu', symbol: 'NavigationMenu' },
  { file: 'tooltip', symbol: 'Tooltip' },
  { file: 'alert', symbol: 'Alert' },
  { file: 'skeleton', symbol: 'Skeleton' },
  { file: 'aspect-ratio', symbol: 'AspectRatio' },
  { file: 'table', symbol: 'Table' },
  { file: 'progress', symbol: 'Progress' },
])

const reasons = new Map(TENANT_SHADCN_COMPONENTS.map((component) => [component.name, component.reason]))

export const TENANT_SHADCN_INSERTABLES: readonly ShadcnInsertable[] = Object.freeze(
  PRIMARY_EXPORTS.map(({ file, symbol }) => Object.freeze({
    file,
    symbol,
    source: `@/components/ui/${file}` as const,
    componentId: `ui.${file}` as const,
    reason: reasons.get(file) ?? `Insert the ${symbol} component.`,
  })),
)
