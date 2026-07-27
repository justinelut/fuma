import { createHash } from 'node:crypto'
import {
  CollaborationSocketClientMessageSchema,
  CollaborationSocketServerMessageSchema,
  type CollaborationSocketServerMessage,
  type PublicationPresenceState,
} from '@core/fuma/publication'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteBoundary } from '../context'
import { bindPublicationScope, samePublicationScope, type PublicationRepositoryScope } from './scope'
import { publicationPresenceRoom, PublicationCollaborationService } from './collaboration'

const SOCKET_SUFFIX = /^\/publication\/collaboration\/socket\/([^/]+)\/([^/]+)$/
const MAX_PAYLOAD_BYTES = 65_536

export type PublicationCollaborationSocketData = {
  channel: 'collaboration'
  request: Request
  scope: PublicationRepositoryScope
  actorId: string
  actorSessionId: string
  resourceKind: PublicationPresenceState['resourceKind']
  resourceId: string
  room: string
  lastSequence: number
}

type CollaborationSocket = Bun.ServerWebSocket<PublicationCollaborationSocketData>

function decode(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

function target(request: Request): { resourceKind: PublicationPresenceState['resourceKind']; resourceId: string; tabId: string } | null {
  const url = new URL(request.url)
  const scopedSuffix = url.pathname.match(/^\/api\/fuma\/organizations\/[^/]+\/workspaces\/[^/]+\/sites\/[^/]+(\/.*)$/)?.[1]
  const match = scopedSuffix?.match(SOCKET_SUFFIX)
  const resourceKind = match ? decode(match[1]!) : null
  const resourceId = match ? decode(match[2]!) : null
  const tabId = url.searchParams.get('tab')
  if (!resourceKind || !['post', 'page', 'template', 'newsletter'].includes(resourceKind) || !resourceId || resourceId.length > 255 || !tabId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(tabId)) return null
  return { resourceKind: resourceKind as PublicationPresenceState['resourceKind'], resourceId, tabId }
}

function tabSessionId(authoritySessionId: string, tabId: string): string {
  return `collaboration-${createHash('sha256').update(`${authoritySessionId}\0${tabId}`).digest('hex')}`
}

function encode(message: CollaborationSocketServerMessage): string {
  const parsed = safeParseValue(CollaborationSocketServerMessageSchema, message)
  if (!parsed.ok) throw new Error('Collaboration socket response failed validation.')
  return JSON.stringify(parsed.value)
}

/** Durable collaboration transport. Presence remains advisory and separate. */
export class PublicationCollaborationSocketHub {
  readonly handler: Bun.WebSocketHandler<PublicationCollaborationSocketData>
  readonly #collaboration: PublicationCollaborationService
  readonly #authority: FumaScopedRouteBoundary
  readonly #rooms = new Map<string, Set<CollaborationSocket>>()
  readonly #unsubscribes = new Map<string, () => Promise<void>>()

  constructor(input: Readonly<{ collaboration: PublicationCollaborationService; authority: FumaScopedRouteBoundary }>) {
    this.#collaboration = input.collaboration
    this.#authority = input.authority
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

  async upgrade(request: Request, server: Bun.Server<PublicationCollaborationSocketData>): Promise<Response | undefined | null> {
    const requested = target(request)
    if (!requested) return null
    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'WebSocket upgrade required.' }), { status: 426, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    const authority = await this.#authority.authorize(request, 'publication.posts.read', { requireOrigin: true })
    if (!authority || authority.context.actor.kind !== 'staff') return new Response(JSON.stringify({ error: 'Resource not found.' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    const scope = bindPublicationScope(authority.repositoryScope, authority.context.profile.id)
    const data: PublicationCollaborationSocketData = {
      channel: 'collaboration',
      request,
      scope,
      actorId: authority.context.actor.userId,
      actorSessionId: tabSessionId(authority.context.actor.sessionId, requested.tabId),
      resourceKind: requested.resourceKind,
      resourceId: requested.resourceId,
      room: publicationPresenceRoom(scope, requested.resourceKind, requested.resourceId),
      lastSequence: 0,
    }
    if (!server.upgrade(request, { data })) return new Response(JSON.stringify({ error: 'WebSocket upgrade failed.' }), { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    return undefined
  }

  async close(): Promise<void> {
    for (const sockets of this.#rooms.values()) for (const socket of sockets) socket.close(1012, 'Server shutting down')
    await Promise.all([...this.#unsubscribes.values()].map((unsubscribe) => unsubscribe()))
    this.#rooms.clear()
    this.#unsubscribes.clear()
  }

  async #open(socket: CollaborationSocket): Promise<void> {
    let sockets = this.#rooms.get(socket.data.room)
    if (!sockets) { sockets = new Set(); this.#rooms.set(socket.data.room, sockets) }
    sockets.add(socket)
    if (!this.#unsubscribes.has(socket.data.room)) {
      const unsubscribe = await this.#collaboration.subscribeChanged(
        socket.data.scope,
        socket.data.resourceKind,
        socket.data.resourceId,
        (message) => this.#broadcast(socket.data.room, message),
      )
      this.#unsubscribes.set(socket.data.room, unsubscribe)
    }
  }

  async #authorize(data: PublicationCollaborationSocketData, permission: 'publication.posts.read' | 'publication.posts.write'): Promise<boolean> {
    const authority = await this.#authority.authorize(data.request, permission, { requireOrigin: true })
    if (!authority || authority.context.actor.kind !== 'staff') return false
    const current = bindPublicationScope(authority.repositoryScope, authority.context.profile.id)
    return authority.context.actor.userId === data.actorId && samePublicationScope(current, data.scope)
  }

  async #message(socket: CollaborationSocket, message: string | Buffer<ArrayBuffer>): Promise<void> {
    if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > MAX_PAYLOAD_BYTES) { socket.close(1009, 'Payload too large'); return }
    let candidate: unknown
    try { candidate = JSON.parse(message) } catch { socket.close(1007, 'Invalid payload'); return }
    const parsed = safeParseValue(CollaborationSocketClientMessageSchema, candidate)
    if (!parsed.ok) { socket.close(1007, 'Invalid payload'); return }
    try {
      if (parsed.value.type === 'collaboration-catch-up') {
        if (!await this.#authorize(socket.data, 'publication.posts.read')) { socket.close(1008, 'Authority changed'); return }
        const result = await this.#collaboration.catchUp(socket.data.scope, socket.data.resourceKind, socket.data.resourceId, parsed.value.afterSequence)
        socket.data.lastSequence = result.sequence
        this.#send(socket, { type: 'collaboration-catch-up', ...result })
        return
      }
      if (!await this.#authorize(socket.data, 'publication.posts.write')) { socket.close(1008, 'Authority changed'); return }
      if (parsed.value.command.resourceKind !== socket.data.resourceKind || parsed.value.command.resourceId !== socket.data.resourceId) { socket.close(1008, 'Target changed'); return }
      const result = await this.#collaboration.reconcile(socket.data.scope, parsed.value.command, { actorSessionId: socket.data.actorSessionId })
      if (result.outcome === 'accepted') {
        socket.data.lastSequence = Math.max(socket.data.lastSequence, result.receipt.sequence)
        this.#send(socket, { type: 'collaboration-accepted', replayed: result.replayed, receipt: result.receipt, document: result.document })
      } else {
        socket.data.lastSequence = Math.max(socket.data.lastSequence, result.sequence)
        this.#send(socket, { type: 'collaboration-rebase-required', mutationId: result.mutationId, sequence: result.sequence, document: result.document, operationsSinceBase: result.operationsSinceBase })
      }
    } catch {
      socket.close(1013, 'Collaboration unavailable')
    }
  }

  async #close(socket: CollaborationSocket): Promise<void> {
    const sockets = this.#rooms.get(socket.data.room)
    sockets?.delete(socket)
    if (sockets?.size === 0) {
      this.#rooms.delete(socket.data.room)
      const unsubscribe = this.#unsubscribes.get(socket.data.room)
      this.#unsubscribes.delete(socket.data.room)
      await unsubscribe?.()
    }
  }

  #send(socket: CollaborationSocket, message: CollaborationSocketServerMessage): void {
    if (socket.send(encode(message)) < 0) socket.close(1013, 'Backpressure')
  }

  #broadcast(room: string, message: CollaborationSocketServerMessage): void {
    const payload = encode(message)
    for (const socket of this.#rooms.get(room) ?? []) {
      if (message.type === 'collaboration-accepted') socket.data.lastSequence = Math.max(socket.data.lastSequence, message.receipt.sequence)
      if (socket.send(payload) < 0) socket.close(1013, 'Backpressure')
    }
  }
}
