import { apiRequest, type FetchLike } from '@core/http'
import {
  DynamicPublicationLoopPageSchema,
  DynamicPublicationTemplateSchema,
  type DynamicPublicationLoopPage,
  type DynamicPublicationTarget,
  type DynamicPublicationTemplate,
} from '@core/fuma/publication/dynamicPublication'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { PublicationClientTarget } from './client'

const TargetSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
  profileId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })
const TemplateListSchema = Type.Object({ templates: Type.Array(DynamicPublicationTemplateSchema, { maxItems: 10_000 }) }, { additionalProperties: false })
const PreviewSchema = Type.Object({ template: DynamicPublicationTemplateSchema, page: DynamicPublicationLoopPageSchema, html: Type.String({ minLength: 1, maxLength: 2_000_000 }) }, { additionalProperties: false })
export type DynamicPublicationPreview = Readonly<{ template: DynamicPublicationTemplate; page: DynamicPublicationLoopPage; html: string }>

export interface DynamicPublicationTemplateClientPort {
  templates(): Promise<readonly DynamicPublicationTemplate[]>
  saveTemplate(template: DynamicPublicationTemplate, expectedVersion: number | null): Promise<DynamicPublicationTemplate>
  preview(target: DynamicPublicationTarget, page?: number, pageSize?: number, asOf?: string): Promise<DynamicPublicationPreview>
}

export class DynamicPublicationHttpClient implements DynamicPublicationTemplateClientPort {
  readonly target: PublicationClientTarget
  readonly #fetch: FetchLike
  readonly #base: string
  constructor(target: PublicationClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    const parsed = safeParseValue(TargetSchema, target)
    if (!parsed.ok) throw new TypeError('Dynamic Publication client target is invalid.')
    this.target = Object.freeze(structuredClone(parsed.value))
    this.#fetch = fetchImpl
    this.#base = `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/publication`
  }
  async #request<T extends TSchema>(method: string, suffix: string, schema: T, body?: unknown): Promise<Static<T>> {
    return apiRequest(`${this.#base}${suffix}`, { method, body, schema, fallbackMessage: 'Dynamic Publication request failed', fetchImpl: this.#fetch })
  }
  async templates(): Promise<readonly DynamicPublicationTemplate[]> { return (await this.#request('GET', '/dynamic-templates', TemplateListSchema)).templates }
  saveTemplate(template: DynamicPublicationTemplate, expectedVersion: number | null): Promise<DynamicPublicationTemplate> {
    return this.#request('POST', '/dynamic-templates', DynamicPublicationTemplateSchema, { template, expectedVersion })
  }
  preview(target: DynamicPublicationTarget, page = 1, pageSize = 20, asOf = new Date().toISOString()): Promise<DynamicPublicationPreview> {
    const query = new URLSearchParams({ kind: target.kind, targetId: target.targetId ?? '', page: String(page), pageSize: String(pageSize), asOf })
    return this.#request('GET', `/dynamic-preview?${query}`, PreviewSchema)
  }
}
