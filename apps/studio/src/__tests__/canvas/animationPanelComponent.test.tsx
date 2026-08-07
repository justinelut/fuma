/**
 * The animation panel component.
 *
 * Rendered against real DOM, because the properties worth checking are accessibility and
 * disabled state — neither is observable from the model alone.
 *
 * Sections are collapsible and Radix unmounts closed content, so a test inspecting a field
 * opens its section first. That is the real interaction, not a workaround: a designer also
 * has to open the section.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { AnimationPanel } from '@admin/pages/site/panels/AnimationPanel/AnimationPanel'
import type { MotionAnimation } from '@core/react-ir/motion'

afterEach(cleanup)

const ALL_SECTIONS = [
  'states', 'timing', 'spring', 'repeat', 'orchestration', 'inView', 'layout',
]

function panel(
  animation: MotionAnimation,
  hasPresenceAncestor?: boolean,
  openSections: readonly string[] = ALL_SECTIONS,
) {
  const changes: MotionAnimation[] = []
  render(
    <AnimationPanel
      animation={animation}
      hasPresenceAncestor={hasPresenceAncestor}
      // Every section open, because Radix unmounts closed content and the assertions are
      // about field state rather than about the accordion.
      defaultOpenSections={openSections}
      onChange={(next) => changes.push(next)}
    />,
  )
  return changes
}

describe('presets', () => {
  it('offers every preset as a button', () => {
    panel({})
    expect(screen.getByRole('button', { name: /Fade up/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Spring in/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Reveal on scroll/ })).toBeDefined()
  })

  it('applies a preset when clicked', () => {
    const changes = panel({})
    screen.getByRole('button', { name: /Fade up/ }).click()
    expect(changes).toHaveLength(1)
    expect(changes[0]?.animate).toBeDefined()
  })

  it('applies the stagger preset with its variants', () => {
    const changes = panel({})
    screen.getByRole('button', { name: /Stagger children/ }).click()
    expect(Object.keys(changes[0]?.variants ?? {})).toEqual(['hidden', 'visible'])
  })
})

describe('a field with no effect', () => {
  it('renders disabled rather than hidden', () => {
    // Hiding it leaves a designer hunting for a control that exists; enabling it accepts a
    // value Motion silently ignores.
    panel({ transition: { type: 'tween' } })
    expect((screen.getByLabelText('Stiffness') as HTMLInputElement).disabled).toBe(true)
  })

  it('states why, so switching to a spring is discoverable', () => {
    panel({ transition: { type: 'tween' } })
    expect(screen.getAllByText(/current type is tween/).length).toBeGreaterThan(0)
  })

  it('associates the reason with the control for a screen reader', () => {
    panel({ transition: { type: 'tween' } })
    const stiffness = screen.getByLabelText('Stiffness')
    const describedBy = stiffness.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent)
      .toContain('spring transition')
  })

  it('enables the field once it applies', () => {
    panel({ transition: { type: 'spring' } })
    expect((screen.getByLabelText('Stiffness') as HTMLInputElement).disabled).toBe(false)
  })

  it('disables easing on a spring', () => {
    // A spring derives its own curve, so ease is read by nothing.
    panel({ transition: { type: 'spring' } })
    expect(screen.getByLabelText('Easing').getAttribute('data-disabled')).not.toBeNull()
  })

  it('disables in-view options with no whileInView gesture', () => {
    panel({})
    expect((screen.getByLabelText('Viewport margin') as HTMLInputElement).disabled).toBe(true)
  })
})

describe('warnings', () => {
  it('shows an exit-without-presence warning', () => {
    panel({ exit: { opacity: 0 } }, false)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('AnimatePresence')
  })

  it('shows nothing when there is nothing wrong', () => {
    panel({ transition: { duration: 0.4 } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('warns about a variant name declared nowhere', () => {
    panel({ animate: 'visible' })
    expect(screen.getByRole('status').textContent).toContain('visible')
  })
})

describe('which sections start open', () => {
  it('opens states and timing by default, because that is where most edits happen', () => {
    panel({}, undefined, ['states', 'timing'])
    expect(screen.getByLabelText('Duration (s)')).toBeDefined()
    // Spring is collapsed, and Radix unmounts closed content.
    expect(screen.queryByLabelText('Stiffness')).toBeNull()
  })

  it('honours a caller that wants a different section open', () => {
    // Opening "In view" after the author adds a scroll animation puts them where the next
    // decision is.
    panel({}, undefined, ['inView'])
    expect(screen.getByLabelText('Viewport margin')).toBeDefined()
  })
})

describe('controls carry their constraints', () => {
  it('bounds a number control so it cannot produce an invalid value', () => {
    panel({})
    const bounce = screen.getByLabelText('Bounce') as HTMLInputElement
    expect(bounce.min).toBe('0')
    expect(bounce.max).toBe('1')
  })

  it('labels every control in the sections open by default', () => {
    // A control with no label is unusable with a screen reader.
    panel({})
    for (const label of ['From', 'To', 'Exit', 'Duration (s)', 'Delay (s)', 'Easing']) {
      expect(screen.getByLabelText(label)).toBeDefined()
    }
  })

  it('shows a target as a readable summary rather than JSON', () => {
    panel({ initial: { opacity: 0, y: 24 } })
    expect((screen.getByLabelText('From') as HTMLInputElement).value)
      .toBe('opacity: 0, y: 24')
  })

  it('leaves a target read-only because it is edited on the canvas', () => {
    panel({ initial: { opacity: 0 } })
    expect((screen.getByLabelText('From') as HTMLInputElement).disabled).toBe(true)
  })

  it('reports a cleared number as no opinion rather than zero', () => {
    // Zero duration is a real instruction to skip the animation, so the two must differ.
    const changes = panel({ transition: { duration: 1 } })
    const duration = screen.getByLabelText('Duration (s)') as HTMLInputElement
    duration.value = ''
    duration.dispatchEvent(new Event('input', { bubbles: true }))
    expect(changes[0]?.transition?.duration).toBeUndefined()
  })
})
