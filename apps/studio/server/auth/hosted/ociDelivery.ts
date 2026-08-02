import { createHash } from 'node:crypto'
import type { FumaConfig } from '../../fuma/config'
import { OciEmailDeliveryAdapter } from '../../fuma/publication/ociEmailDelivery'
import { OciRsaRequestSigner } from '../../fuma/publication/ociRequestSigner'
import type { OciEmailDeliveryProvider } from '../../fuma/publication/servicePorts'
import type { HostedAuthDelivery } from './auth'

type AuthMessage = Readonly<{ email: string; name: string; url: string }>
type AuthMessageKind = 'password-reset' | 'verification'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function safeUrl(value: string, linkHost: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== linkHost || url.port !== '' || url.username || url.password) {
    throw new TypeError('Hosted auth delivery URL must use the configured product HTTPS origin.')
  }
  return url.toString()
}

export function createHostedAuthOciDelivery(input: Readonly<{
  config: Pick<FumaConfig, 'environment' | 'hosts' | 'ociEmail'>
  now?: () => Date
  fetchImpl?: typeof fetch
  provider?: Pick<OciEmailDeliveryProvider, 'submit'>
  linkHost?: string
  audience?: 'staff' | 'account'
}>): HostedAuthDelivery {
  if (input.config.environment !== 'production') throw new TypeError('OCI hosted auth delivery is production-only.')
  const now = input.now ?? (() => new Date())
  const linkHost = input.linkHost ?? input.config.hosts.product
  const parsedLinkOrigin = new URL(`https://${linkHost}`)
  if (parsedLinkOrigin.hostname !== linkHost || parsedLinkOrigin.host !== linkHost || parsedLinkOrigin.pathname !== '/') {
    throw new TypeError('Hosted auth delivery link host is invalid.')
  }
  const audience = input.audience ?? 'staff'
  const provider = input.provider ?? new OciEmailDeliveryAdapter({
    region: input.config.ociEmail.region,
    compartmentId: input.config.ociEmail.compartmentId,
    approvedSender: input.config.ociEmail.approvedSender,
    signer: new OciRsaRequestSigner({ ...input.config.ociEmail, now }),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  })

  const send = async (kind: AuthMessageKind, message: AuthMessage): Promise<void> => {
    const url = safeUrl(message.url, linkHost)
    const reset = kind === 'password-reset'
    const action = reset ? 'Reset password' : 'Verify email'
    const subjectAudience = audience === 'staff' ? 'staff' : 'account'
    const subject = reset ? `Reset your Fuma ${subjectAudience} password` : `Verify your Fuma ${subjectAudience} email`
    const greeting = message.name.trim() ? `Hello ${message.name.trim()},` : 'Hello,'
    const text = `${greeting}\n\n${action}: ${url}\n\nIf you did not request this, do not use the link.`
    const html = `<p>${escapeHtml(greeting)}</p><p><a href="${escapeHtml(url)}">${action}</a></p><p>If you did not request this, do not use the link.</p>`
    await provider.submit({
      idempotencyKey: createHash('sha256').update(JSON.stringify([kind, message.email.trim().toLowerCase(), url])).digest('hex'),
      recipient: message.email,
      senderEmail: input.config.ociEmail.approvedSender,
      senderName: 'Fuma',
      replyToEmail: input.config.ociEmail.approvedSender,
      subject,
      html,
      text,
      headers: { 'X-Fuma-Auth-Message': kind },
    })
  }

  return Object.freeze({
    sendVerification: async (message) => await send('verification', message),
    sendPasswordReset: async (message) => await send('password-reset', message),
  })
}
