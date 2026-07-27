import type { HostedAuthDelivery } from './auth'

export type HostedAuthMessageKind = 'verification' | 'password-reset'

export type HostedAuthMessage = Readonly<{
  id: string
  kind: HostedAuthMessageKind
  email: string
  name: string
  url: string
  createdAt: string
}>

export interface HostedAuthFakeInbox extends HostedAuthDelivery {
  messagesFor(email: string): readonly HostedAuthMessage[]
  latest(email: string, kind: HostedAuthMessageKind): HostedAuthMessage | null
  clear(): void
}

/**
 * Deterministic delivery seam for focused integration tests and local demos.
 * It is process-local and intentionally exposes no network endpoint.
 */
export function createHostedAuthFakeInbox(): HostedAuthFakeInbox {
  const messages: HostedAuthMessage[] = []

  function store(
    kind: HostedAuthMessageKind,
    message: Readonly<{ email: string; name: string; url: string }>,
  ): void {
    messages.push(Object.freeze({
      id: crypto.randomUUID(),
      kind,
      email: message.email.toLowerCase(),
      name: message.name,
      url: message.url,
      createdAt: new Date().toISOString(),
    }))
  }

  return {
    sendVerification: async (message) => store('verification', message),
    sendPasswordReset: async (message) => store('password-reset', message),
    messagesFor: (email) => messages.filter((message) => message.email === email.toLowerCase()),
    latest: (email, kind) => messages.findLast((message) => (
      message.email === email.toLowerCase() && message.kind === kind
    )) ?? null,
    clear: () => { messages.length = 0 },
  }
}
