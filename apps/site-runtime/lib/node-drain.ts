import { beginDrain } from './drain'

let registered = false
export function registerNodeDrainSignals(): void {
  if (registered) return
  registered = true
  process.once('SIGTERM', beginDrain)
  process.once('SIGINT', beginDrain)
}
