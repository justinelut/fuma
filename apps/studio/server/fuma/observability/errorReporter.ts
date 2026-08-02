/**
 * Error reporting to a Sentry-compatible endpoint.
 *
 * Deliberately dependency-free: it posts the Sentry envelope over `fetch`
 * instead of adding an SDK, matching how Fuma treats AI providers (raw HTTP, no
 * vendor SDKs) and keeping the runtime image small.
 *
 * Safety properties:
 *  - **Inert without configuration.** No DSN means no network call at all, so
 *    development and tests never emit telemetry.
 *  - **Never throws into the caller.** Reporting failures are swallowed; an
 *    observability outage must not turn a handled 500 into a crash loop.
 *  - **Redacted by default.** Messages, stack frames and request context are
 *    scrubbed of tokens, passwords, cookies, connection strings, emails and
 *    phone numbers before leaving the process.
 *  - **Bounded.** Payload size, breadcrumb count and per-window event volume
 *    are capped so a hot loop cannot exhaust quota or bandwidth.
 */

const MAX_MESSAGE_LENGTH = 2_000
const MAX_FRAMES = 30
const MAX_EVENTS_PER_WINDOW = 30
const WINDOW_MS = 60_000

export type SentryDsn = Readonly<{
  origin: string
  projectId: string
  publicKey: string
}>

/**
 * Parses `https://<key>@<host>/<projectId>`. Returns null for anything
 * malformed so a bad value disables reporting instead of crashing boot.
 */
export function parseSentryDsn(raw: string | undefined | null): SentryDsn | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    const publicKey = url.username
    if (publicKey.length === 0 || url.password.length > 0) return null
    const projectId = url.pathname.replace(/^\/+/, '')
    if (!/^[0-9]+$/.test(projectId)) return null
    return Object.freeze({ origin: url.origin, projectId, publicKey })
  } catch {
    return null
  }
}

const REDACTIONS: readonly Readonly<{ pattern: RegExp; replacement: string }>[] = Object.freeze([
  // Connection strings first: they embed credentials.
  { pattern: /\b(postgres(?:ql)?|redis|amqp|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, replacement: '$1://[redacted]' },
  { pattern: /\b(?:bearer|token|api[_-]?key|secret|password|passwd|pwd|authorization)\b\s*[:=]\s*["']?[^\s"',;]+/gi, replacement: '$&'.replace(/.*/, '[redacted-credential]') },
  { pattern: /\bsk_(?:live|test)_[A-Za-z0-9]+/g, replacement: '[redacted-secret-key]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[redacted-jwt]' },
  { pattern: /\bcookie\b\s*[:=]\s*[^\n;]+/gi, replacement: 'cookie: [redacted]' },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[redacted-email]' },
  { pattern: /\+?\d[\d\s-]{8,}\d/g, replacement: '[redacted-phone]' },
])

/** Scrub secrets and personal data from any string leaving the process. */
export function redactErrorText(value: string): string {
  let output = value
  for (const { pattern, replacement } of REDACTIONS) output = output.replace(pattern, replacement)
  return output.length > MAX_MESSAGE_LENGTH ? `${output.slice(0, MAX_MESSAGE_LENGTH)}…` : output
}

export type ErrorReportContext = Readonly<{
  /** Route shape only, never a full URL with query values. */
  route?: string
  method?: string
  status?: number
  /** Low-cardinality tags only. */
  tags?: Readonly<Record<string, string>>
}>

export type ErrorReporterOptions = Readonly<{
  dsn?: string | null
  environment: string
  release?: string | null
  serverName?: string | null
  /** Injected for tests; defaults to global fetch. */
  transport?: (url: string, init: RequestInit) => Promise<unknown>
  now?: () => number
}>

export interface ErrorReporter {
  readonly enabled: boolean
  capture(error: unknown, context?: ErrorReportContext): void
  /** Resolves once queued deliveries settle; used by shutdown. */
  flush(): Promise<void>
}

function frames(stack: string | undefined): readonly string[] {
  if (!stack) return Object.freeze([])
  return Object.freeze(stack
    .split('\n')
    .slice(1, MAX_FRAMES + 1)
    .map((line) => redactErrorText(line.trim()))
    .filter((line) => line.length > 0))
}

function describe(error: unknown): Readonly<{ type: string; value: string; stack: readonly string[] }> {
  if (error instanceof Error) {
    return Object.freeze({
      type: error.name || 'Error',
      value: redactErrorText(error.message || 'Unknown error'),
      stack: frames(error.stack),
    })
  }
  return Object.freeze({
    type: 'UnknownError',
    value: redactErrorText(typeof error === 'string' ? error : JSON.stringify(error ?? null)),
    stack: Object.freeze([]),
  })
}

/** Disabled reporter used whenever no DSN is configured. */
const INERT: ErrorReporter = Object.freeze({
  enabled: false,
  capture: () => {},
  flush: async () => {},
})

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const dsn = parseSentryDsn(options.dsn)
  if (!dsn) return INERT

  const transport = options.transport ?? ((url, init) => fetch(url, init))
  const now = options.now ?? (() => Date.now())
  const endpoint = `${dsn.origin}/api/${dsn.projectId}/envelope/`
  const inFlight = new Set<Promise<unknown>>()
  let windowStartedAt = now()
  let windowCount = 0

  const withinBudget = (): boolean => {
    const current = now()
    if (current - windowStartedAt >= WINDOW_MS) {
      windowStartedAt = current
      windowCount = 0
    }
    if (windowCount >= MAX_EVENTS_PER_WINDOW) return false
    windowCount += 1
    return true
  }

  return Object.freeze({
    enabled: true,
    capture(error: unknown, context: ErrorReportContext = {}): void {
      if (!withinBudget()) return
      const detail = describe(error)
      const eventId = crypto.randomUUID().replaceAll('-', '')
      const timestamp = new Date(now()).toISOString()
      const event = {
        event_id: eventId,
        timestamp,
        platform: 'javascript',
        level: 'error',
        logger: 'fuma.server',
        environment: options.environment,
        ...(options.release ? { release: options.release } : {}),
        ...(options.serverName ? { server_name: options.serverName } : {}),
        transaction: context.route ? redactErrorText(context.route) : undefined,
        tags: {
          ...(context.method ? { method: context.method } : {}),
          ...(context.status ? { status: String(context.status) } : {}),
          ...(context.tags ?? {}),
        },
        exception: {
          values: [{
            type: detail.type,
            value: detail.value,
            stacktrace: { frames: detail.stack.map((line) => ({ filename: line })) },
          }],
        },
      }
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: `${dsn.origin.replace('https://', `https://${dsn.publicKey}@`)}/${dsn.projectId}` }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(event),
      ].join('\n')

      // Fire and forget: never await, never throw into the caller.
      const delivery = transport(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: envelope,
      }).catch(() => undefined).finally(() => { inFlight.delete(delivery) })
      inFlight.add(delivery)
    },
    async flush(): Promise<void> {
      await Promise.allSettled([...inFlight])
    },
  })
}
