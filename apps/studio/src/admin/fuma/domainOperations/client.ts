import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  DomainDiagnosticReportWireSchema,
  DomainOperationsViewSchema,
  RegistrarTransferViewSchema,
  type DomainOperationsClient,
} from './contracts'

function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const result = safeParseValue(schema, value)
  if (!result.ok) throw new Error('Domain operations response failed its strict contract.')
  return result.value
}

export function createDomainOperationsClient(
  scopedApiBase: string,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): DomainOperationsClient {
  async function call<T extends TSchema>(schema: T, method: string, path: string, body?: unknown): Promise<Static<T> | null> {
    const response = await request(`${scopedApiBase}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let value: unknown
    try { value = await response.json() } catch { throw new Error('Domain operations returned invalid JSON.') }
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) {
      const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error : 'Domain operation failed.'
      throw new Error(message)
    }
    return parse(schema, value)
  }
  return Object.freeze({
    async exact(domainId: string) { return await call(DomainOperationsViewSchema, 'GET', `/settings/domains/${encodeURIComponent(domainId)}/operations`) },
    async diagnose(domainId: string) {
      const value = await call(DomainDiagnosticReportWireSchema, 'POST', `/settings/domains/${encodeURIComponent(domainId)}/diagnose`, {})
      if (!value) throw new Error('Domain diagnostics were unavailable.')
      return value.diagnostics
    },
    async startInbound(input: Parameters<DomainOperationsClient['startInbound']>[0]) {
      const value = await call(RegistrarTransferViewSchema, 'POST', '/settings/domains/transfers/inbound', {
        transferOperationId: `inbound:${crypto.randomUUID()}`,
        ...input,
      })
      if (!value) throw new Error('Inbound transfer was unavailable.')
      return value
    },
    async startOutbound(input: Parameters<DomainOperationsClient['startOutbound']>[0]) {
      const value = await call(RegistrarTransferViewSchema, 'POST', '/settings/domains/transfers/outbound', {
        transferOperationId: `outbound:${crypto.randomUUID()}`,
        ...input,
      })
      if (!value) throw new Error('Outbound transfer was unavailable.')
      return value
    },
    async resume(id: string) {
      const value = await call(RegistrarTransferViewSchema, 'POST', `/settings/domains/transfers/${encodeURIComponent(id)}/resume`, {})
      if (!value) throw new Error('Registrar transfer was unavailable.')
      return value
    },
    async choose() { throw new Error('Site-transfer domain outcomes are available from the paid handoff workflow.') },
  })
}
