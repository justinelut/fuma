const state = { draining: false }

export function beginDrain(): void { state.draining = true }
export function isDraining(): boolean { return state.draining }

export function assertServing(): void {
  if (state.draining) throw new Error('site-runtime-draining')
}
