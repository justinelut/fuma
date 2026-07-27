import { Value } from '@core/utils/typeboxHelpers'
import { FumaRepositoryScopeSchema } from '../tenancy/repositoryScope'
import {
  assertObjectTenantScope,
  logicalObjectKey,
  physicalObjectKey,
  tenantObjectPrefix,
} from './keyPolicy'
import type { ObjectTenantScope } from './types'

export interface FumaScopedObjectKeyFactory {
  readonly scope: ObjectTenantScope
  readonly prefix: string
  physicalKey(logicalKey: string): string
  logicalKey(physicalKey: string): string
}

/** Uniform denial prevents malformed scope details from becoming a tenant oracle. */
export class FumaScopedObjectKeyResolutionError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Scoped object-key authority denied.')
    this.name = 'FumaScopedObjectKeyResolutionError'
  }
}

function deny(): never {
  throw new FumaScopedObjectKeyResolutionError()
}

function isDeepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false
  return Object.values(value).every((nested) => (
    !nested || typeof nested !== 'object' || isDeepFrozen(nested)
  ))
}

/**
 * Narrows one immutable, server-derived repository scope to FUMA-008's
 * established organization/workspace/site object prefix. The returned factory
 * accepts no tenant coordinates, so a caller cannot substitute another scope.
 */
export function createFumaScopedObjectKeyFactory(
  repositoryScope: unknown,
): FumaScopedObjectKeyFactory {
  if (
    !Value.Check(FumaRepositoryScopeSchema, repositoryScope)
    || !isDeepFrozen(repositoryScope)
    || repositoryScope.state !== 'active'
    || repositoryScope.transferFence !== null
  ) {
    deny()
  }

  const scope = Object.freeze({
    organizationId: repositoryScope.organizationId,
    workspaceId: repositoryScope.workspaceId,
    siteId: repositoryScope.siteId,
  })
  try {
    assertObjectTenantScope(scope)
  } catch (_error) {
    deny()
  }

  return Object.freeze({
    scope,
    prefix: tenantObjectPrefix(scope),
    physicalKey(logicalKey: string) {
      return physicalObjectKey(scope, logicalKey)
    },
    logicalKey(candidate: string) {
      return logicalObjectKey(scope, candidate)
    },
  })
}
