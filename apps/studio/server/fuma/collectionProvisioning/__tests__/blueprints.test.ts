import { describe, expect, it } from 'bun:test'
import type { DataField, DataTable } from '@core/data/schemas'
import {
  ReviewedBackendCapabilityRegistry,
  assertStrictCapabilitySchema,
  type BackendCapabilityEvidencePort,
  type TrustedBackendCapabilityAuthority,
} from '../../aiBackendCapabilities'
import {
  COLLECTION_BLUEPRINTS,
  blueprintByKey,
  blueprintProvisionOrder,
  blueprintsForFamily,
} from '../blueprints'
import {
  COLLECTION_CAPABILITY_IDS,
  collectionBlockingDiagnostic,
  createCollectionCapabilities,
  registerCollectionCapabilities,
} from '../capabilities'
import { ProvisionCollectionInputSchema } from '../contracts'
import { CollectionProvisioningService, type CollectionStore } from '../service'
import { safeParseValue } from '@core/utils/typeboxHelpers'

class MemoryCollectionStore implements CollectionStore {
  readonly tables = new Map<string, DataTable>()
  #next = 0
  async listCollections(): Promise<readonly DataTable[]> { return [...this.tables.values()] }
  async getCollectionBySlug(slug: string): Promise<DataTable | null> { return this.tables.get(slug) ?? null }
  async createCollection(input: Parameters<CollectionStore['createCollection']>[0]): Promise<DataTable> {
    this.#next += 1
    const created = {
      id: `tbl_${this.#next}`,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      routeBase: input.routeBase,
      singularLabel: input.singularLabel,
      pluralLabel: input.pluralLabel,
      primaryFieldId: input.primaryFieldId,
      fields: [...input.fields] as DataField[],
      system: false,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    } as DataTable
    this.tables.set(created.slug, created)
    return created
  }
  async updateCollectionFields(collectionId: string, fields: readonly DataField[]): Promise<DataTable | null> {
    for (const [slug, entry] of this.tables) {
      if (entry.id !== collectionId) continue
      const updated = { ...entry, fields: [...fields] } as DataTable
      this.tables.set(slug, updated)
      return updated
    }
    return null
  }
}

function evidence(): BackendCapabilityEvidencePort {
  return { async admit() {}, async record() { return { metered: true as const, audited: true as const } } }
}

function authority(capabilityId?: string): TrustedBackendCapabilityAuthority {
  return {
    channel: 'site-ai',
    operationId: 'op_1',
    outerReceiptId: 'rcp_1',
    reservationId: 'rsv_1',
    scope: {
      platformId: 'platform',
      organizationId: 'org_a',
      workspaceId: 'wsp_a',
      siteId: 'site_a',
      ownerKey: 'owner_a',
      ownerGeneration: 2,
      profileId: 'website',
    },
    actor: { kind: 'staff', actorId: 'usr_1', sessionId: 'ses_1', impersonatorId: null },
    permissions: ['data.tables.read', 'data.tables.write'],
    grants: ['ai.chat', 'ai.tools.write'],
    authorityRevision: 2,
    state: 'active',
    resolvedAt: '2026-03-01T06:00:00.000Z',
    confirmation: capabilityId
      ? {
        confirmationId: 'cnf_1',
        actorId: 'usr_1',
        operationId: 'op_1',
        capabilityId,
        capabilityVersion: '1.0.0',
        ownerKey: 'owner_a',
        ownerGeneration: 2,
        confirmedAt: '2026-03-01T06:00:00.000Z',
      }
      : null,
  } as TrustedBackendCapabilityAuthority
}

describe('starter blueprints', () => {
  it('every blueprint satisfies the provisioning contract', () => {
    expect(COLLECTION_BLUEPRINTS.length).toBeGreaterThanOrEqual(12)
    for (const entry of COLLECTION_BLUEPRINTS) {
      const parsed = safeParseValue(ProvisionCollectionInputSchema, entry.definition)
      expect(parsed.ok).toBe(true)
      expect(entry.families.length).toBeGreaterThan(0)
      // The primary field must be one of the declared fields.
      expect(entry.definition.fields.some((field) => field.id === entry.definition.primaryFieldId)).toBe(true)
    }
  })

  it('uses unique keys and slugs', () => {
    const keys = COLLECTION_BLUEPRINTS.map((entry) => entry.key)
    const slugs = COLLECTION_BLUEPRINTS.map((entry) => entry.definition.slug)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('covers every launch family', () => {
    for (const family of ['business', 'agency', 'blog', 'events', 'hospitality'] as const) {
      const suited = blueprintsForFamily(family)
      if (family === 'blog') {
        // Blogging uses the existing built-in posts collection, so no blueprint is required.
        expect(suited).toHaveLength(0)
        continue
      }
      expect(suited.length).toBeGreaterThan(0)
    }
    expect(blueprintsForFamily('hospitality').map((entry) => entry.key))
      .toEqual(expect.arrayContaining(['rooms', 'tours', 'menu-items']))
    expect(blueprintsForFamily('events').map((entry) => entry.key))
      .toEqual(expect.arrayContaining(['events', 'speakers']))
  })

  it('never encodes capacity, inventory or checkout', () => {
    const forbidden = /(capacity|seatsAvailable|stock|inventory|checkout|cart|payNow|ticketsLeft)/i
    for (const entry of COLLECTION_BLUEPRINTS) {
      for (const field of entry.definition.fields) {
        expect(field.id).not.toMatch(forbidden)
      }
    }
  })

  it('orders relation targets before their dependants', () => {
    const order = blueprintProvisionOrder(['case-studies', 'services'])
    expect(order.indexOf('services')).toBeLessThan(order.indexOf('case-studies'))
    const hospitality = blueprintProvisionOrder(['rooms', 'locations', 'tours'])
    expect(hospitality.indexOf('locations')).toBeLessThan(hospitality.indexOf('rooms'))
    expect(hospitality.indexOf('locations')).toBeLessThan(hospitality.indexOf('tours'))
    const events = blueprintProvisionOrder(['speakers', 'events', 'locations'])
    expect(events.indexOf('locations')).toBeLessThan(events.indexOf('events'))
    expect(events.indexOf('events')).toBeLessThan(events.indexOf('speakers'))
  })

  it('resolves a blueprint by key', () => {
    expect(blueprintByKey('services')?.definition.slug).toBe('services')
    expect(blueprintByKey('nope')).toBeNull()
  })

  it('provisions every blueprint for real in dependency order', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const order = blueprintProvisionOrder(COLLECTION_BLUEPRINTS.map((entry) => entry.key))
    expect(order).toHaveLength(COLLECTION_BLUEPRINTS.length)
    for (const key of order) {
      const entry = blueprintByKey(key)
      if (!entry) throw new Error(`missing blueprint ${key}`)
      const result = await service.provision(entry.definition)
      expect(result.alreadyExisted).toBe(false)
    }
    expect(store.tables.size).toBe(COLLECTION_BLUEPRINTS.length)
    // Relations resolved to real ids rather than slugs.
    const caseStudies = store.tables.get('case-studies')
    const relation = caseStudies?.fields.find((field) => field.id === 'service')
    expect(relation).toMatchObject({ type: 'relation' })
    expect((relation as { targetTableId?: string }).targetTableId).toBe(store.tables.get('services')?.id)
  })

  it('re-provisioning the full set is idempotent', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const order = blueprintProvisionOrder(COLLECTION_BLUEPRINTS.map((entry) => entry.key))
    for (const pass of [1, 2]) {
      for (const key of order) {
        const entry = blueprintByKey(key)!
        const result = await service.provision(entry.definition)
        expect(result.alreadyExisted).toBe(pass === 2)
      }
    }
    expect(store.tables.size).toBe(COLLECTION_BLUEPRINTS.length)
  })
})

describe('collection capabilities', () => {
  function harness() {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const registry = registerCollectionCapabilities(new ReviewedBackendCapabilityRegistry(), service)
    return { store, registry }
  }

  it('registers describe, provision and extend with strict schemas', () => {
    const { registry } = harness()
    for (const id of Object.values(COLLECTION_CAPABILITY_IDS)) {
      expect(registry.definition(id, '1.0.0')).not.toBeNull()
      expect(id).toMatch(/^[a-z][a-z0-9.-]*$/)
    }
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    for (const capability of createCollectionCapabilities(service)) {
      expect(() => assertStrictCapabilitySchema(capability.inputSchema, 'in')).not.toThrow()
      expect(() => assertStrictCapabilitySchema(capability.outputSchema, 'out')).not.toThrow()
      expect(capability.metadata.profiles).toEqual(['website', 'publication'])
    }
  })

  it('requires owner confirmation for schema mutation but not for reading', () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    const byId = new Map(createCollectionCapabilities(service).map((c) => [c.metadata.id, c.metadata]))
    expect(byId.get(COLLECTION_CAPABILITY_IDS.describe)?.confirmation).toBe('none')
    expect(byId.get(COLLECTION_CAPABILITY_IDS.provision)?.confirmation).toBe('owner')
    expect(byId.get(COLLECTION_CAPABILITY_IDS.extend)?.confirmation).toBe('owner')
  })

  it('provisions through the capability with owner confirmation', async () => {
    const { store, registry } = harness()
    const result = await registry.invoke({
      id: COLLECTION_CAPABILITY_IDS.provision,
      version: '1.0.0',
      rawInput: blueprintByKey('team')!.definition,
      resolveAuthority: async () => authority(COLLECTION_CAPABILITY_IDS.provision),
      evidence: evidence(),
    })
    expect((result.output as { slug: string }).slug).toBe('team')
    expect(store.tables.has('team')).toBe(true)
    expect(result.receipt.audited).toBe(true)
  })

  it('refuses provisioning without owner confirmation', async () => {
    const { store, registry } = harness()
    await expect(registry.invoke({
      id: COLLECTION_CAPABILITY_IDS.provision,
      version: '1.0.0',
      rawInput: blueprintByKey('team')!.definition,
      resolveAuthority: async () => authority(),
      evidence: evidence(),
    })).rejects.toThrow(/owner confirmation is required/)
    expect(store.tables.size).toBe(0)
  })

  it('rejects hostile schema input before touching storage', async () => {
    const { store, registry } = harness()
    let resolved = 0
    await expect(registry.invoke({
      id: COLLECTION_CAPABILITY_IDS.provision,
      version: '1.0.0',
      rawInput: {
        ...blueprintByKey('team')!.definition,
        sql: 'drop table data_tables',
        system: true,
      },
      resolveAuthority: async () => { resolved += 1; return authority(COLLECTION_CAPABILITY_IDS.provision) },
      evidence: evidence(),
    })).rejects.toThrow(/input is invalid/)
    expect(resolved).toBe(0)
    expect(store.tables.size).toBe(0)
  })

  it('describes collections without owner confirmation', async () => {
    const { registry } = harness()
    await registry.invoke({
      id: COLLECTION_CAPABILITY_IDS.provision,
      version: '1.0.0',
      rawInput: blueprintByKey('faqs')!.definition,
      resolveAuthority: async () => authority(COLLECTION_CAPABILITY_IDS.provision),
      evidence: evidence(),
    })
    const described = await registry.invoke({
      id: COLLECTION_CAPABILITY_IDS.describe,
      version: '1.0.0',
      rawInput: { limit: 20 },
      resolveAuthority: async () => authority(),
      evidence: evidence(),
    })
    const collections = (described.output as { collections: { slug: string; editable: boolean }[] }).collections
    expect(collections.map((entry) => entry.slug)).toEqual(['faqs'])
    expect(collections[0]?.editable).toBe(true)
  })

  it('names an explicit reason for every withheld schema power', () => {
    expect(collectionBlockingDiagnostic('collections.drop')).toMatch(/destroy stored rows/)
    expect(collectionBlockingDiagnostic('collections.remove-field')).toMatch(/additive only/)
    expect(collectionBlockingDiagnostic('collections.retype-field')).toMatch(/reinterprets stored cells/)
    expect(collectionBlockingDiagnostic('collections.sql')).toMatch(/Direct SQL/)
    expect(collectionBlockingDiagnostic('collections.rename-slug')).toMatch(/published routes/)
    expect(collectionBlockingDiagnostic('collections.describe')).toBeNull()
  })
})
