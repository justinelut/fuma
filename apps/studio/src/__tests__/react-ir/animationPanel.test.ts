import { describe, it, expect } from 'bun:test'
import {
  ANIMATION_PRESETS,
  animationPanel,
  applyPreset,
  describesAnyAnimation,
  setPanelField,
  type AnimationPanel,
} from '@core/react-ir/animationPanel'
import { MotionAnimationSchema, type MotionAnimation } from '@core/react-ir/motion'
import { Value } from '@sinclair/typebox/value'

function fieldOf(panel: AnimationPanel, key: string) {
  for (const section of panel.sections) {
    const found = section.fields.find((field) => field.key === key)
    if (found) return found
  }
  throw new Error(`no field ${key}`)
}

describe('the panel describes every editable field', () => {
  it('offers the three states', () => {
    const panel = animationPanel({})
    expect(fieldOf(panel, 'initial')).toBeDefined()
    expect(fieldOf(panel, 'animate')).toBeDefined()
    expect(fieldOf(panel, 'exit')).toBeDefined()
  })

  it('reads a value already set', () => {
    const panel = animationPanel({ transition: { duration: 0.8 } })
    expect(fieldOf(panel, 'transition.duration').value).toBe(0.8)
  })

  it('carries bounds so a control cannot produce an invalid value', () => {
    const field = fieldOf(animationPanel({}), 'transition.bounce')
    expect(field.min).toBe(0)
    expect(field.max).toBe(1)
  })

  it('offers the easing names Motion itself accepts, rather than free text', () => {
    expect(fieldOf(animationPanel({}), 'transition.ease').options).toContain('easeOut')
  })
})

describe('a field that has no effect says so', () => {
  it('marks spring parameters inactive on a tween', () => {
    // Motion ignores stiffness on a tween. A designer setting 400 and seeing no change
    // has been lied to by the interface.
    const panel = animationPanel({ transition: { type: 'tween' } })
    expect(fieldOf(panel, 'transition.stiffness').inactive?.code).toBe('spring-only')
  })

  it('activates spring parameters on a spring', () => {
    const panel = animationPanel({ transition: { type: 'spring' } })
    expect(fieldOf(panel, 'transition.stiffness').inactive).toBeNull()
  })

  it('marks easing inactive on a spring', () => {
    // A spring derives its own curve; ease is read by nothing.
    const panel = animationPanel({ transition: { type: 'spring' } })
    expect(fieldOf(panel, 'transition.ease').inactive?.code).toBe('tween-only')
  })

  it('keeps duration active on a spring', () => {
    // Motion 12 accepts duration on a spring as an alternative to stiffness and damping,
    // so marking it inactive would be wrong.
    const panel = animationPanel({ transition: { type: 'spring' } })
    expect(fieldOf(panel, 'transition.duration').inactive).toBeNull()
  })

  it('treats a missing type as tween, which is Motion default', () => {
    const panel = animationPanel({})
    expect(fieldOf(panel, 'transition.stiffness').inactive?.code).toBe('spring-only')
  })

  it('marks in-view options inactive without a whileInView gesture', () => {
    const panel = animationPanel({})
    expect(fieldOf(panel, 'inView.once').inactive?.code).toBe('needs-in-view-gesture')
  })

  it('activates in-view options once the gesture exists', () => {
    const panel = animationPanel({ gestures: { whileInView: { target: { opacity: 1 } } } })
    expect(fieldOf(panel, 'inView.amount').inactive).toBeNull()
  })

  it('marks stagger inactive without variants', () => {
    // Stagger reaches children only through variants.
    const panel = animationPanel({})
    expect(fieldOf(panel, 'transition.staggerChildren').inactive?.code).toBe('needs-variants')
  })

  it('activates stagger once variants are declared', () => {
    const panel = animationPanel({ variants: { hidden: { target: { opacity: 0 } } } })
    expect(fieldOf(panel, 'transition.staggerChildren').inactive).toBeNull()
  })

  it('marks repeat mode inactive with no repeat count', () => {
    const panel = animationPanel({})
    expect(fieldOf(panel, 'transition.repeatType').inactive?.code).toBe('needs-repeat')
  })

  it('activates repeat mode once a count is set', () => {
    const panel = animationPanel({ transition: { repeat: 3 } })
    expect(fieldOf(panel, 'transition.repeatType').inactive).toBeNull()
  })
})

describe('warnings name mistakes rather than dormant fields', () => {
  it('warns about an exit with no presence ancestor', () => {
    const panel = animationPanel(
      { exit: { opacity: 0 } },
      { hasPresenceAncestor: false },
    )
    expect(panel.warnings.some((warning) => warning.includes('AnimatePresence'))).toBe(true)
  })

  it('stays quiet when presence is present', () => {
    const panel = animationPanel(
      { exit: { opacity: 0 } },
      { hasPresenceAncestor: true },
    )
    expect(panel.warnings).toEqual([])
  })

  it('warns about a variant name declared nowhere', () => {
    // Motion does not warn: the element simply does not animate.
    const panel = animationPanel({ animate: 'visible' })
    expect(panel.warnings.some((warning) => warning.includes('visible'))).toBe(true)
  })

  it('accepts a variant name that is declared', () => {
    const panel = animationPanel({
      animate: 'visible',
      variants: { visible: { target: { opacity: 1 } } },
    })
    expect(panel.warnings).toEqual([])
  })

  it('allows for inheritance rather than calling it an error', () => {
    // A name may legitimately come from a parent, so the wording must not assert a fault.
    const panel = animationPanel({ animate: 'visible' })
    expect(panel.warnings[0]).toContain('inherited from a parent')
  })

  it('warns about a stagger with no variants to carry it', () => {
    const panel = animationPanel({ transition: { staggerChildren: 0.1 } })
    expect(panel.warnings.some((warning) => warning.includes('variant names only'))).toBe(true)
  })
})

describe('presets', () => {
  it('every preset produces a valid animation', () => {
    for (const preset of ANIMATION_PRESETS) {
      expect(Value.Check(MotionAnimationSchema, preset.build())).toBe(true)
    }
  })

  it('every preset states what it produces', () => {
    // Nothing hidden behind the name.
    for (const preset of ANIMATION_PRESETS) {
      expect(preset.describe.length).toBeGreaterThan(10)
    }
  })

  it('returns transforms to their identity value rather than omitting them', () => {
    // Omitting y makes Motion animate to computed style, which silently differs once a
    // class sets a transform.
    const fadeUp = ANIMATION_PRESETS.find((preset) => preset.id === 'fade-up')?.build()
    expect((fadeUp?.animate as Record<string, unknown>)['y']).toBe(0)
  })

  it('returns scale to one, not zero', () => {
    const scaleIn = ANIMATION_PRESETS.find((preset) => preset.id === 'scale-in')?.build()
    expect((scaleIn?.animate as Record<string, unknown>)['scale']).toBe(1)
  })

  it('builds a spring preset with spring parameters', () => {
    const spring = ANIMATION_PRESETS.find((preset) => preset.id === 'spring-in')?.build()
    expect(spring?.transition?.type).toBe('spring')
    expect(spring?.transition?.stiffness).toBeGreaterThan(0)
  })

  it('builds the stagger preset with matching variants and a stagger', () => {
    const stagger = ANIMATION_PRESETS.find((preset) => preset.id === 'stagger-children')?.build()
    expect(Object.keys(stagger?.variants ?? {})).toEqual(['hidden', 'visible'])
    expect(stagger?.transition?.staggerChildren).toBeGreaterThan(0)
  })

  it('builds the scroll preset using whileInView and once', () => {
    const scroll = ANIMATION_PRESETS.find((preset) => preset.id === 'on-scroll')?.build()
    expect(scroll?.gestures?.whileInView).toBeDefined()
    expect(scroll?.inView?.once).toBe(true)
  })

  it('reports when a preset replaced existing work', () => {
    // Applying over a hand-tuned animation silently means the author loses it.
    const applied = applyPreset('fade-in', { transition: { duration: 2 } })
    expect(applied?.replaced).toContain('replaced')
  })

  it('reports nothing replaced on an element with no animation', () => {
    expect(applyPreset('fade-in', {})?.replaced).toBeNull()
  })

  it('returns null for an unknown preset', () => {
    expect(applyPreset('does-not-exist', {})).toBeNull()
  })

  it('knows an empty animation says nothing', () => {
    expect(describesAnyAnimation({})).toBe(false)
    expect(describesAnyAnimation({ animate: { opacity: 1 } })).toBe(true)
  })

  it('a preset result survives the panel reader', () => {
    // Whatever a preset writes must be describable by the panel, or the author cannot
    // then tune it.
    for (const preset of ANIMATION_PRESETS) {
      expect(() => animationPanel(preset.build())).not.toThrow()
    }
  })
})

describe('writing a field back', () => {
  it('sets a transition value', () => {
    const next = setPanelField({}, 'transition.duration', 1.2)
    expect(next.transition?.duration).toBe(1.2)
  })

  it('keeps other transition values', () => {
    const next = setPanelField({ transition: { delay: 0.2 } }, 'transition.duration', 1)
    expect(next.transition?.delay).toBe(0.2)
  })

  it('removes a cleared value rather than storing undefined', () => {
    // `duration: undefined` would otherwise reach the generator.
    const next = setPanelField({ transition: { duration: 1 } }, 'transition.duration', undefined)
    expect(next.transition).toBeUndefined()
  })

  it('drops the transition entirely once its last value is cleared', () => {
    const next = setPanelField({ transition: { duration: 1 } }, 'transition.duration', undefined)
    expect('transition' in next).toBe(false)
  })

  it('sets an in-view option', () => {
    expect(setPanelField({}, 'inView.once', true).inView?.once).toBe(true)
  })

  it('sets a top-level value', () => {
    expect(setPanelField({}, 'layoutId', 'card').layoutId).toBe('card')
  })

  it('turns the string "true" into a real boolean for layout', () => {
    // A select can only hand back a string, and storing "false" would make layout truthy —
    // the opposite of what the author chose.
    expect(setPanelField({}, 'layout', 'true').layout).toBe(true)
  })

  it('removes layout when set to "false"', () => {
    expect(setPanelField({ layout: true }, 'layout', 'false').layout).toBeUndefined()
  })

  it('keeps an axis literal for drag', () => {
    expect(setPanelField({}, 'drag', 'x').drag).toBe('x')
  })

  it('produces an animation the schema still accepts', () => {
    let animation: MotionAnimation = {}
    animation = setPanelField(animation, 'transition.type', 'spring')
    animation = setPanelField(animation, 'transition.stiffness', 250)
    animation = setPanelField(animation, 'layout', 'position')
    expect(Value.Check(MotionAnimationSchema, animation)).toBe(true)
  })

  it('round-trips through the panel reader', () => {
    const written = setPanelField({}, 'transition.duration', 0.75)
    expect(fieldOf(animationPanel(written), 'transition.duration').value).toBe(0.75)
  })
})
