/**
 * The Blocks panel: task 81's surface.
 *
 * Rendered against real DOM through @testing-library/react, so the assertions are about what somebody
 * can actually see and click rather than about the component's internals.
 */
import { describe, expect, it } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { BlocksPanel } from '../../admin/pages/site/panels/BlocksPanel/BlocksPanel'
import { BLOCK_CATALOGUE } from '../../core/react-ir/blockCatalogue'
import type { BlockDefinition } from '../../core/react-ir/blockLibrary'

function renderPanel(props: Partial<Parameters<typeof BlocksPanel>[0]> = {}) {
  cleanup()
  const inserted: BlockDefinition[] = []
  render(
    <BlocksPanel
      onInsert={(block) => inserted.push(block)}
      {...props}
    />,
  )
  return inserted
}

describe('the panel shows the catalogue', () => {
  it('every base block is offered with an insert control', () => {
    renderPanel()
    const bases = BLOCK_CATALOGUE.filter((b) => b.variantOf === null)
    for (const block of bases) {
      expect(screen.getByRole('button', { name: `Insert ${block.name}` })).toBeTruthy()
    }
  })

  it('a block states what it is for, so the picker is choosable without inserting each one', () => {
    renderPanel()
    const hero = BLOCK_CATALOGUE.find((b) => b.id === 'hero.centred')!
    expect(screen.getByText(hero.description)).toBeTruthy()
  })

  it('inserting calls back with the block itself', () => {
    const inserted = renderPanel()
    const hero = BLOCK_CATALOGUE.find((b) => b.id === 'hero.centred')!
    screen.getByRole('button', { name: `Insert ${hero.name}` }).click()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.id).toBe('hero.centred')
  })
})

describe('variants are shown beside their base, not as peers', () => {
  it('the split hero appears as a variant control rather than a second row heading', () => {
    // Listing both as peers would show two heroes with nothing saying they are the same block
    // differently arranged.
    renderPanel()
    const split = BLOCK_CATALOGUE.find((b) => b.id === 'hero.split')!
    const control = screen.getByRole('button', { name: `Insert ${split.name}` })
    // The variant button carries only the distinguishing word, not the repeated family name.
    expect(control.textContent).toBe('split')
  })

  it('and inserting a variant passes the variant, not its base', () => {
    const inserted = renderPanel()
    const split = BLOCK_CATALOGUE.find((b) => b.id === 'hero.split')!
    screen.getByRole('button', { name: `Insert ${split.name}` }).click()
    expect(inserted[0]!.id).toBe('hero.split')
  })

  it('a family with no variants renders no variants row', () => {
    renderPanel({ blocks: [BLOCK_CATALOGUE.find((b) => b.id === 'cta.banner')!] })
    expect(screen.queryByText('Variants')).toBeNull()
  })
})

describe('unavailability is explained rather than only disabled', () => {
  it('the reason is announced and the controls are disabled', () => {
    // A disabled button with no explanation reads as the product being broken.
    renderPanel({ unavailableReason: 'Select something on the canvas to insert into.' })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Select something on the canvas')
    const hero = BLOCK_CATALOGUE.find((b) => b.id === 'hero.centred')!
    expect(
      (screen.getByRole('button', { name: `Insert ${hero.name}` }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('and nothing is announced when insertion is available', () => {
    renderPanel()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a disabled control cannot insert', () => {
    const inserted = renderPanel({ unavailableReason: 'Nothing selected.' })
    const hero = BLOCK_CATALOGUE.find((b) => b.id === 'hero.centred')!
    screen.getByRole('button', { name: `Insert ${hero.name}` }).click()
    expect(inserted).toHaveLength(0)
  })
})

describe('the copied-on-insert cost is stated in the interface', () => {
  it('because a block that looks like a component invites the wrong expectation', () => {
    renderPanel()
    expect(screen.getByText(/do not change pages you already/i)).toBeTruthy()
  })
})

describe('search', () => {
  it('an empty catalogue after filtering says so rather than showing everything', () => {
    // Falling back to the full list would look as though the search had been ignored.
    renderPanel({ blocks: [] })
    expect(screen.getByText('No blocks match that search.')).toBeTruthy()
  })
})
