export class EntitlementError extends Error {
  readonly code: 'invalid' | 'incomplete-cost' | 'margin' | 'immutable' | 'expired' | 'destination' | 'internal-only' | 'not-found'

  constructor(code: EntitlementError['code'], message: string) {
    super(message)
    this.name = 'EntitlementError'
    this.code = code
  }
}
