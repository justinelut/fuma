import { ObjectStorageError, type ObjectTenantScope } from './types'

const SAFE_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/
export const OBJECT_METADATA_SUFFIX = '.__fuma_meta.json'
const RESERVED_LOGICAL_ROOTS = new Set(['organizations', '.fuma'])

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

function assertSegment(value: string, path: string): void {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new ObjectStorageError('invalid_scope', `Invalid object scope segment at ${path}.`, path)
  }
}

export function assertObjectTenantScope(scope: ObjectTenantScope): void {
  assertSegment(scope.organizationId, 'scope.organizationId')
  assertSegment(scope.workspaceId, 'scope.workspaceId')
  assertSegment(scope.siteId, 'scope.siteId')
}

export function tenantObjectPrefix(scope: ObjectTenantScope): string {
  assertObjectTenantScope(scope)
  return `organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/sites/${scope.siteId}/objects/`
}

export function assertLogicalObjectKey(key: string, allowEmpty = false): void {
  if (allowEmpty && key === '') return
  if (!key || key.startsWith('/') || key.endsWith('/') || key.endsWith(OBJECT_METADATA_SUFFIX) || key.includes('\\') || key.includes('%')) {
    throw new ObjectStorageError('invalid_key', 'Object key must be a canonical relative path.', 'key')
  }
  if (containsControlCharacter(key)) {
    throw new ObjectStorageError('invalid_key', 'Object key contains a control character.', 'key')
  }
  const segments = key.split('/')
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..')) {
    throw new ObjectStorageError('invalid_key', 'Object key contains an unsafe path segment.', 'key')
  }
  if (RESERVED_LOGICAL_ROOTS.has(segments[0])) {
    throw new ObjectStorageError('invalid_key', 'Object key uses a reserved tenant-prefix segment.', 'key')
  }
}

export function physicalObjectKey(scope: ObjectTenantScope, logicalKey: string): string {
  assertLogicalObjectKey(logicalKey)
  return `${tenantObjectPrefix(scope)}${logicalKey}`
}

export function logicalObjectKey(scope: ObjectTenantScope, physicalKey: string): string {
  const prefix = tenantObjectPrefix(scope)
  if (!physicalKey.startsWith(prefix)) {
    throw new ObjectStorageError('invalid_key', 'Object does not belong to the requested tenant prefix.', 'key')
  }
  const key = physicalKey.slice(prefix.length)
  assertLogicalObjectKey(key)
  return key
}
