import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  RegistrarPurchaseReceiptWireSchema,
  RegistrarQuoteWireSchema,
  RegistrarRegistrationsWireSchema,
  RegistrarRenewalReceiptWireSchema,
  type RegistrarHttpClient,
} from './contracts'

type ClientMethod = keyof RegistrarHttpClient
const paths: Record<ClientMethod, string> = {
  search: '/settings/domains/registrar/search',
  purchase: '/settings/domains/registrar/purchase',
  renew: '/settings/domains/registrar/renew',
  registrations: '/settings/domains/registrar/registrations',
}

export function createRegistrarHttpClient(scopedApiBase: string, request: typeof fetch = fetch): RegistrarHttpClient {
  async function call<T extends TSchema>(schema: T, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Static<T>> {
    const response = await request(`${scopedApiBase}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      const message = value !== null && typeof value === 'object' && 'error' in value
        && typeof value.error === 'string' ? value.error : 'Registrar request failed.'
      throw new Error(message)
    }
    const parsed = safeParseValue(schema, value)
    if (!parsed.ok) throw new Error('Registrar response failed its strict contract.')
    return structuredClone(parsed.value)
  }
  return Object.freeze({
    search: async (input: Parameters<RegistrarHttpClient['search']>[0]) => await call(RegistrarQuoteWireSchema, 'POST', paths.search, input),
    purchase: async (input: Parameters<RegistrarHttpClient['purchase']>[0]) => await call(RegistrarPurchaseReceiptWireSchema, 'POST', paths.purchase, input),
    renew: async (input: Parameters<RegistrarHttpClient['renew']>[0]) => await call(RegistrarRenewalReceiptWireSchema, 'POST', paths.renew, input),
    registrations: async () => await call(RegistrarRegistrationsWireSchema, 'GET', paths.registrations),
  })
}
