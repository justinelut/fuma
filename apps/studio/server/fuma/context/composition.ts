import type { DbClient } from '../../db/client'
import { PostgresFumaRepositoryScopeOwnerKeyAuthority } from '../tenancy/ownerKeyAuthority'
import {
  createFumaScopedRouteBoundaryFactory,
  type FumaScopedRouteBoundaryDependencies,
  type FumaScopedRouteBoundaryFactory,
} from './middleware'

export type PostgresFumaScopedRouteBoundaryFactoryInput = Readonly<
  Omit<FumaScopedRouteBoundaryDependencies, 'ownerKeys'> & {
    db: DbClient
  }
>

/**
 * Production HTTP composition: PostgreSQL owns the stable tenant owner key,
 * while product modules inject and declare only their own route descendants.
 */
export function createPostgresFumaScopedRouteBoundaryFactory(
  input: PostgresFumaScopedRouteBoundaryFactoryInput,
): FumaScopedRouteBoundaryFactory {
  const { db, ...dependencies } = input
  return createFumaScopedRouteBoundaryFactory({
    ...dependencies,
    ownerKeys: new PostgresFumaRepositoryScopeOwnerKeyAuthority(db),
  })
}
