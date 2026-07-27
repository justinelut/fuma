import { createHash } from 'node:crypto'
import { PublicationPresenceStateSchema, type PublicationPresenceState } from '@core/fuma/publication'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteBoundary } from '../context'
import { bindPublicationScope, samePublicationScope, type PublicationRepositoryScope } from './scope'
import { publicationPresenceRoom, PublicationPresenceService } from './collaboration'

const SOCKET_SUFFIX = /^\/publication\/presence\/socket\/([^/]+)\/([^/]+)$/
const MAX_PAYLOAD_BYTES = 4_096
const PRESENCE_TTL_MS = 30_000

const SocketTargetSchema = Type.Object({
  resourceKind: PublicationPresenceStateSchema.properties.resourceKind,
  resourceId: PublicationPresenceStateSchema.properties.resourceId,
  tabId: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
}, { additionalProperties: false })
const PresenceUpdateSchema = Type.Object({
  type: Type.Literal('update'),
  displayName: PublicationPresenceStateSchema.properties.displayName,
  selection: PublicationPresenceStateSchema.properties.selection,
  draftSequence: PublicationPresenceStateSchema.properties.draftSequence,
}, { additionalProperties: false })
const PresenceSnapshotSchema = Type.Object({
  type: Type.Literal('snapshot'),
  entries: Type.Array(PublicationPresenceStateSchema, { maxItems: 256 }),
}, { additionalProperties: false })

export type PublicationPresenceSocketData = {
  channel: 'presence'
  request: Request
  scope: PublicationRepositoryScope
  actorId: string
  sessionId: string
  resourceKind: PublicationPresenceState['resourceKind']
  resourceId: string
  room: string
  lastState: PublicationPresenceState | null
}

type PresenceSocket = Bun.ServerWebSocket<PublicationPresenceSocketData>

function decode(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

function target(request: Request): { resourceKind: PublicationPresenceState['resourceKind']; resourceId: string; tabId: string } | null {
  const url = new URL(request.url)
  const scopedSuffix = url.pathname.match(/^\/api\/fuma\/organizations\/[^/]+\/workspaces\/[^/]+\/sites\/[^/]+(\/.*)$/)?.[1]
  const match = scopedSuffix?.match(SOCKET_SUFFIX)
  const resourceKind = match ? decode(match[1]!) : null
  const resourceId = match ? decode(match[2]!) : null
  const parsed = safeParseValue(SocketTargetSchema, { resourceKind, resourceId, tabId: url.searchParams.get('tab') })
  return parsed.ok ? parsed.value : null
}

function tabSessionId(authoritySessionId: string, tabId: string): string {
  return `presence-${createHash('sha256').update(`${authoritySessionId}\0${tabId}`).digest('hex')}`
}

function snapshot(entries: readonly PublicationPresenceState[]): string {
  const parsed = safeParseValue(PresenceSnapshotSchema, { type: 'snapshot', entries })
  if (!parsed.ok) throw new Error('Presence snapshot failed validation.')
  return JSON.stringify(parsed.value)
}

/** Authenticated, advisory site-room presence. It never participates in edit authorization. */
export class PublicationPresenceSocketHub {
  readonly handler: Bun.WebSocketHandler<PublicationPresenceSocketData>
  readonly #presence: PublicationPresenceService
  readonly #authority: FumaScopedRouteBoundary
  readonly #now: () => Date
  readonly #rooms = new Map<string, Set<PresenceSocket>>()
  readonly #unsubscribes = new Map<string, () => Promise<void>>()

  constructor(input: Readonly<{ presence: PublicationPresenceService; authority: FumaScopedRouteBoundary; now?: () => Date }>) {
    this.#presence = input.presence
    this.#authority = input.authority
    this.#now = input.now ?? (() => new Date())
    this.handler = {
      maxPayloadLength: MAX_PAYLOAD_BYTES,
      backpressureLimit: 65_536,
      closeOnBackpressureLimit: true,
      open: (socket) => this.#open(socket),
      message: (socket, message) => this.#message(socket, message),
      close: (socket) => this.#close(socket),
    }
  }

  handles(request: Request): boolean { return target(request) !== null }

  async upgrade(request: Request, server: Bun.Server<PublicationPresenceSocketData>): Promise<Response | undefined | null> {
    const requested = target(request)
    if (!requested) return null
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'WebSocket upgrade required.' }), { status: 426, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
    const authority = await this.#authority.authorize(request, 'publication.posts.read', { requireOrigin: true })
    if (!authority || authority.context.actor.kind !== 'staff') return new Response(JSON.stringify({ error: 'Resource not found.' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    const scope = bindPublicationScope(authority.repositoryScope, authority.context.profile.id)
    const data: PublicationPresenceSocketData = {
      channel: 'presence',
      request,
      scope,
      actorId: authority.context.actor.userId,
      sessionId: tabSessionId(authority.context.actor.sessionId, requested.tabId),
      resourceKind: requested.resourceKind,
      resourceId: requested.resourceId,
      room: publicationPresenceRoom(scope, requested.resourceKind, requested.resourceId),
      lastState: null,
    }
    if (!server.upgrade(request, { data })) return new Response(JSON.stringify({ error: 'WebSocket upgrade failed.' }), { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    return undefined
  }

  async close(): Promise<void> {
    for (const sockets of this.#rooms.values()) for (const socket of sockets) socket.close(1012, 'Server shutting down')
    await Promise.all([...this.#unsubscribes.values()].map((unsubscribe) => unsubscribe()))
    this.#rooms.clear(); this.#unsubscribes.clear()
  }

  async #open(socket: PresenceSocket): Promise<void> {
    let sockets = this.#rooms.get(socket.data.room)
    if (!sockets) { sockets = new Set(); this.#rooms.set(socket.data.room, sockets) }
    sockets.add(socket)
    if (!this.#unsubscribes.has(socket.data.room)) {
      const unsubscribe = await this.#presence.subscribeChanged(socket.data.scope, socket.data.resourceKind, socket.data.resourceId, () => { void this.#broadcast(socket.data.room, socket.data) })
      this.#unsubscribes.set(socket.data.room, unsubscribe)
    }
    await this.#broadcast(socket.data.room, socket.data)
  }

  async #reauthorize(data: PublicationPresenceSocketData): Promise<boolean> {
    const authority = await this.#authority.authorize(data.request, 'publication.posts.read', { requireOrigin: true })
    if (!authority || authority.context.actor.kind !== 'staff') return false
    const current = bindPublicationScope(authority.repositoryScope, authority.context.profile.id)
    return authority.context.actor.userId === data.actorId && samePublicationScope(current, data.scope)
  }

  async #message(socket: PresenceSocket, message: string | Buffer<ArrayBuffer>): Promise<void> {
    if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > MAX_PAYLOAD_BYTES) { socket.close(1009, 'Payload too large'); return }
    let candidate: unknown
    try { candidate = JSON.parse(message) } catch { socket.close(1007, 'Invalid payload'); return }
    const update = safeParseValue(PresenceUpdateSchema, candidate)
    if (!update.ok) { socket.close(1007, 'Invalid payload'); return }
    try {
      if (!await this.#reauthorize(socket.data)) { socket.close(1008, 'Authority changed'); return }
      if (!await this.#presence.allowUpdate(socket.data.scope, socket.data.resourceKind, socket.data.resourceId, socket.data.sessionId)) { socket.close(1013, 'Rate limited'); return }
      const state: PublicationPresenceState = { actorId: socket.data.actorId, sessionId: socket.data.sessionId, resourceKind: socket.data.resourceKind, resourceId: socket.data.resourceId, displayName: update.value.displayName, selection: update.value.selection, draftSequence: update.value.draftSequence, observedAt: this.#now().toISOString() }
      socket.data.lastState = state
      await this.#presence.heartbeat(socket.data.scope, state, PRESENCE_TTL_MS)
      await this.#broadcast(socket.data.room, socket.data)
      await this.#presence.publishChanged(socket.data.scope, socket.data.resourceKind, socket.data.resourceId)
    } catch { socket.close(1013, 'Presence unavailable') }
  }

  async #close(socket: PresenceSocket): Promise<void> {
    const data = socket.data
    const sockets = this.#rooms.get(data.room)
    sockets?.delete(socket)
    try { await this.#presence.leave(data.scope, data.resourceKind, data.resourceId, data.sessionId) } catch { /* advisory absence remains TTL-bounded */ }
    await this.#broadcast(data.room, data)
    try { await this.#presence.publishChanged(data.scope, data.resourceKind, data.resourceId) } catch { /* pub/sub is advisory */ }
    if (sockets?.size === 0) {
      this.#rooms.delete(data.room)
      const unsubscribe = this.#unsubscribes.get(data.room); this.#unsubscribes.delete(data.room)
      await unsubscribe?.()
    }
  }

  async #broadcast(room: string, data: PublicationPresenceSocketData): Promise<void> {
    const entries = await this.#presence.list(data.scope, data.resourceKind, data.resourceId)
    const payload = snapshot(entries)
    for (const socket of this.#rooms.get(room) ?? []) if (socket.send(payload) < 0) socket.close(1013, 'Backpressure')
  }
}
