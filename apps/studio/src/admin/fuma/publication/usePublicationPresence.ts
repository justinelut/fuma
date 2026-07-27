import { useEffect, useRef, useState } from 'react'
import { PublicationPresenceStateSchema, type PublicationPresenceState } from '@core/fuma/publication'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { publicationPresenceSocketUrl, type PublicationClientTarget } from './client'

const SnapshotSchema = Type.Object({ type: Type.Literal('snapshot'), entries: Type.Array(PublicationPresenceStateSchema, { maxItems: 256 }) }, { additionalProperties: false })
export type PublicationPresenceConnection = 'connecting'|'connected'|'disconnected'
export type PublicationPresenceSocketFactory = (url: string) => WebSocket

export function usePublicationPresence(input: Readonly<{
  target: PublicationClientTarget
  resourceKind: PublicationPresenceState['resourceKind']
  resourceId: string
  displayName: string
  selection: PublicationPresenceState['selection']
  draftSequence: number
  enabled?: boolean
  socketFactory?: PublicationPresenceSocketFactory
}>): Readonly<{ entries: readonly PublicationPresenceState[]; connection: PublicationPresenceConnection; tabId: string }> {
  const [entries, setEntries] = useState<readonly PublicationPresenceState[]>([])
  const [connection, setConnection] = useState<PublicationPresenceConnection>('disconnected')
  const [tabId] = useState(() => crypto.randomUUID())
  const socketRef = useRef<WebSocket | null>(null)
  const updateRef = useRef({ type: 'update' as const, displayName: input.displayName, selection: input.selection, draftSequence: input.draftSequence })

  useEffect(() => {
    if (input.enabled === false || !input.resourceId) return
    let active = true
    queueMicrotask(() => { if (active) { setEntries([]); setConnection('connecting') } })
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    let attempt = 0
    const factory = input.socketFactory ?? ((url: string) => new WebSocket(url))
    const connect = () => {
      if (!active) return
      setConnection('connecting')
      const socket = factory(publicationPresenceSocketUrl(input.target, input.resourceKind, input.resourceId, tabId))
      socketRef.current = socket
      socket.addEventListener('open', () => {
        if (!active) return
        attempt = 0; setConnection('connected'); socket.send(JSON.stringify(updateRef.current))
        heartbeatTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(updateRef.current)) }, 10_000)
      })
      socket.addEventListener('message', (event) => {
        if (!active || typeof event.data !== 'string') return
        try {
          const parsed = safeParseValue(SnapshotSchema, JSON.parse(event.data))
          if (parsed.ok) setEntries(Object.freeze(parsed.value.entries))
        } catch { /* malformed advisory frames are ignored */ }
      })
      socket.addEventListener('close', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        if (!active) return
        socketRef.current = null; setEntries([]); setConnection('disconnected')
        const delay = Math.min(5_000, 250 * (2 ** attempt++))
        reconnectTimer = setTimeout(connect, delay)
      })
    }
    connect()
    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      socketRef.current?.close(1000, 'Component unmounted')
      socketRef.current = null
    }
  }, [input.enabled, input.resourceId, input.resourceKind, input.socketFactory, input.target, tabId])

  useEffect(() => {
    updateRef.current = { type: 'update', displayName: input.displayName, selection: input.selection, draftSequence: input.draftSequence }
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(updateRef.current))
  }, [input.displayName, input.selection, input.draftSequence])

  return Object.freeze({ entries: input.enabled === false ? [] : entries, connection: input.enabled === false ? 'disconnected' : connection, tabId })
}
