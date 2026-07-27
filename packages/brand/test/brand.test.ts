import { describe, expect, test } from 'bun:test'
import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'

describe('@fuma/brand', () => {
  test('exports only the ratified public identity facts', () => {
    expect(FUMA_PUBLIC_IDENTITY).toEqual({
      product: {
        name: 'Fuma',
        host: 'app.fuma.co.ke',
      },
      marketing: {
        host: 'fuma.co.ke',
        status: 'deferred',
      },
      launchDefaults: {
        locale: 'en-KE',
        currency: 'KES',
        timeZone: 'Africa/Nairobi',
      },
    })
  })

  test('keeps the exported metadata immutable', () => {
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.product)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.marketing)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.launchDefaults)).toBe(true)
  })
})
