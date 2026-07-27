import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { OciEmailDeliveryProvider } from './servicePorts'

const OciSubmitResponseSchema = Type.Object({
  messageId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: true })

export interface OciRequestSigner {
  headers(input: Readonly<{ method: 'POST'; url: string; body: string; contentType: string }>): Promise<Readonly<Record<string, string>>>
}

export type OciEmailDeliveryOptions = Readonly<{
  region: string
  compartmentId: string
  approvedSender?: string
  signer: OciRequestSigner
  fetchImpl?: typeof fetch
}>

export class OciEmailDeliveryError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'OciEmailDeliveryError'
    this.status = status
  }
}

export class OciEmailDeliveryAdapter implements OciEmailDeliveryProvider {
  readonly kind = 'oci-email-delivery' as const
  readonly #endpoint: string
  readonly #compartmentId: string
  readonly #approvedSender: string | null
  readonly #signer: OciRequestSigner
  readonly #fetch: typeof fetch

  constructor(options: OciEmailDeliveryOptions) {
    if (!/^[a-z]{2}-[a-z]+-[1-9][0-9]*$/.test(options.region) && !options.region.startsWith('fake-local-')) throw new TypeError('OCI region is invalid.')
    if (!options.compartmentId.startsWith('ocid1.compartment.')) throw new TypeError('OCI compartment OCID is invalid.')
    this.#endpoint = `https://email.${options.region}.oci.oraclecloud.com/20220926/emails`
    this.#compartmentId = options.compartmentId
    this.#approvedSender = options.approvedSender?.trim().toLowerCase() ?? null
    this.#signer = options.signer
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async submit(input: Parameters<OciEmailDeliveryProvider['submit']>[0]): Promise<Readonly<{ providerMessageId: string }>> {
    if (this.#approvedSender !== null && input.senderEmail.trim().toLowerCase() !== this.#approvedSender) throw new OciEmailDeliveryError('OCI sender is not approved.')
    const body = JSON.stringify({
      compartmentId: this.#compartmentId,
      sender: { senderAddress: input.senderEmail, senderName: input.senderName },
      recipients: { to: [{ email: input.recipient }] },
      replyTo: [{ email: input.replyToEmail }],
      subject: input.subject,
      bodyHtml: input.html,
      bodyText: input.text,
      headers: { ...input.headers, 'X-Fuma-Idempotency-Key': input.idempotencyKey },
    })
    const signed = await this.#signer.headers({ method: 'POST', url: this.#endpoint, body, contentType: 'application/json' })
    const response = await this.#fetch(this.#endpoint, { method: 'POST', body, headers: { ...signed, 'content-type': 'application/json', 'opc-retry-token': input.idempotencyKey } })
    if (!response.ok) throw new OciEmailDeliveryError('OCI Email Delivery rejected the message.', response.status)
    let candidate: unknown
    try { candidate = await response.json() } catch { throw new OciEmailDeliveryError('OCI Email Delivery returned invalid JSON.', response.status) }
    const parsed = safeParseValue(OciSubmitResponseSchema, candidate)
    if (!parsed.ok) throw new OciEmailDeliveryError('OCI Email Delivery returned an invalid message envelope.', response.status)
    return Object.freeze({ providerMessageId: parsed.value.messageId })
  }
}
