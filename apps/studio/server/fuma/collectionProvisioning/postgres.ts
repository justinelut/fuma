/**
 * Postgres-backed collection store.
 *
 * A thin adapter over the existing data-table repository. It adds no SQL of its
 * own: provisioning reuses `createDataTable`/`updateDataTable` so table creation
 * keeps exactly one implementation.
 */
import type { DbClient } from '../../db/client'
import type { DataField, DataTable } from '@core/data/schemas'
import {
  createDataTable,
  getDataTableBySlug,
  listDataTables,
  updateDataTable,
} from '../../repositories/data/tables'
import type { CollectionStore } from './service'

export class PostgresCollectionStore implements CollectionStore {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  async listCollections(): Promise<readonly DataTable[]> {
    return await listDataTables(this.#db)
  }

  async getCollectionBySlug(slug: string): Promise<DataTable | null> {
    return await getDataTableBySlug(this.#db, slug)
  }

  async createCollection(input: Parameters<CollectionStore['createCollection']>[0]): Promise<DataTable> {
    return await createDataTable(this.#db, {
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      routeBase: input.routeBase,
      singularLabel: input.singularLabel,
      pluralLabel: input.pluralLabel,
      primaryFieldId: input.primaryFieldId,
      fields: [...input.fields],
    })
  }

  async updateCollectionFields(
    collectionId: string,
    fields: readonly DataField[],
  ): Promise<DataTable | null> {
    return await updateDataTable(this.#db, collectionId, { fields: [...fields] })
  }
}
