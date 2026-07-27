import type { PublicationCollaborationSocketData, PublicationCollaborationSocketHub } from './collaborationSocket'
import type { PublicationPresenceSocketData, PublicationPresenceSocketHub } from './presenceSocket'

export type PublicationSocketData = PublicationPresenceSocketData | PublicationCollaborationSocketData

/** Routes Bun's single WebSocket callback surface to independent presence and collaboration channels. */
export class PublicationSocketHub {
  readonly handler: Bun.WebSocketHandler<PublicationSocketData>
  readonly #presence: PublicationPresenceSocketHub
  readonly #collaboration: PublicationCollaborationSocketHub

  constructor(input: Readonly<{ presence: PublicationPresenceSocketHub; collaboration: PublicationCollaborationSocketHub }>) {
    this.#presence = input.presence
    this.#collaboration = input.collaboration
    this.handler = {
      maxPayloadLength: 65_536,
      backpressureLimit: 65_536,
      closeOnBackpressureLimit: true,
      open: (socket) => this.#handler(socket.data).open?.(socket as never),
      message: (socket, message) => this.#handler(socket.data).message(socket as never, message),
      close: (socket, code, reason) => this.#handler(socket.data).close?.(socket as never, code, reason),
    }
  }

  handles(request: Request): boolean { return this.#presence.handles(request) || this.#collaboration.handles(request) }

  async upgrade(request: Request, server: Bun.Server<PublicationSocketData>): Promise<Response | undefined | null> {
    if (this.#presence.handles(request)) return await this.#presence.upgrade(request, server as never)
    if (this.#collaboration.handles(request)) return await this.#collaboration.upgrade(request, server as never)
    return null
  }

  async close(): Promise<void> { await Promise.all([this.#presence.close(), this.#collaboration.close()]) }

  #handler(data: PublicationSocketData): Bun.WebSocketHandler<PublicationSocketData> {
    return (data.channel === 'presence' ? this.#presence.handler : this.#collaboration.handler) as Bun.WebSocketHandler<PublicationSocketData>
  }
}
