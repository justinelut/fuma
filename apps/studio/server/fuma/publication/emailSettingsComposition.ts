import type { DbClient } from '../../db/client'
import { HierarchicalEmailSettingsService, type EmailSettingsVersionIdAuthority } from './emailSettings'
import { PostgresEmailSettingsVersionRepository } from './emailSettingsPostgres'
import { createEmailSettingsScopedRouteDeclarations } from './emailSettingsRoutes'

export type EmailSettingsCompositionInput = Readonly<{
  db: DbClient
  ids: EmailSettingsVersionIdAuthority
  now?: () => Date
}>

export function createEmailSettingsServiceGraph(input: EmailSettingsCompositionInput) {
  const repository = new PostgresEmailSettingsVersionRepository(input.db)
  const service = new HierarchicalEmailSettingsService(repository, input.ids, input.now)
  return Object.freeze({
    repository,
    service,
    scopedRoutes: createEmailSettingsScopedRouteDeclarations({ service }),
  })
}
