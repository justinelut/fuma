import type { FumaRuntimeRole } from './lifecycle'

export type FumaRuntimeEvent = Readonly<Record<string, unknown> & {
  event: string
  role: FumaRuntimeRole
}>

export type FumaRuntimeEventLogger = (event: FumaRuntimeEvent) => void

export function logFumaRuntimeEvent(event: FumaRuntimeEvent): void {
  console.error(`[fuma:${event.role}] ${JSON.stringify(event)}`)
}
