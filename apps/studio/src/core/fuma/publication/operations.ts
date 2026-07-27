import {
  CollaborationOperationInputSchema,
  CollaborationOperationSchema,
  parsePublicationContract,
  type CollaborationOperation,
  type CollaborationOperationInput,
} from './contracts'

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key)

export class CollaborationOperationApplicationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollaborationOperationApplicationError'
  }
}

function invalid(message: string): never {
  throw new CollaborationOperationApplicationError(message)
}

function assertSafeJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Collaboration values must contain finite JSON numbers.')
    return
  }
  if (!value || typeof value !== 'object') invalid('Collaboration values must be JSON data.')
  if (seen.has(value)) invalid('Collaboration values cannot contain cycles.')
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJson(item, seen)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) invalid('Collaboration values must contain plain JSON objects.')
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_PATH_KEYS.has(key)) invalid('Prototype keys are forbidden in collaboration values.')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid('Collaboration values cannot contain accessors.')
      assertSafeJson(descriptor.value, seen)
    }
  }
  seen.delete(value)
}

function assertSafePath(path: readonly (string | number)[]): void {
  for (const part of path) {
    if (typeof part === 'string' && FORBIDDEN_PATH_KEYS.has(part)) invalid('Prototype paths are forbidden.')
  }
}

function parentAt(root: unknown, path: readonly (string | number)[]): { parent: Record<string, unknown> | unknown[]; key: string | number } {
  if (path.length === 0) invalid('Operation path is empty.')
  let current = root
  for (const part of path.slice(0, -1)) {
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length) invalid('Array path does not exist.')
      current = current[part]
    } else {
      if (!current || typeof current !== 'object' || Array.isArray(current) || !hasOwn(current, part)) invalid('Object path does not exist.')
      current = (current as Record<string, unknown>)[part]
    }
  }
  if (!current || typeof current !== 'object') invalid('Operation parent is not a container.')
  return { parent: current as Record<string, unknown> | unknown[], key: path[path.length - 1]! }
}

function parsedOperation(operation: CollaborationOperationInput | CollaborationOperation): CollaborationOperationInput | CollaborationOperation {
  try {
    return 'acceptedSequence' in operation
      ? parsePublicationContract('accepted collaboration operation', CollaborationOperationSchema, operation)
      : parsePublicationContract('collaboration operation', CollaborationOperationInputSchema, operation)
  } catch {
    return invalid('Collaboration operation failed its strict contract.')
  }
}

/** Applies one already-ordered batch without mutating the caller's tree. */
export function applyCollaborationOperationBatch(
  document: unknown,
  operations: readonly (CollaborationOperationInput | CollaborationOperation)[],
): unknown {
  assertSafeJson(document)
  const next = structuredClone(document)
  for (const candidate of operations) {
    const operation = parsedOperation(candidate)
    assertSafePath(operation.path)
    const { parent, key } = parentAt(next, operation.path)
    if (operation.kind === 'set') {
      assertSafeJson(operation.value)
      if (Array.isArray(parent)) {
        if (typeof key !== 'number' || key >= parent.length) invalid('Set array index is invalid.')
        parent[key] = structuredClone(operation.value)
      } else {
        if (typeof key !== 'string') invalid('Set object key is invalid.')
        parent[key] = structuredClone(operation.value)
      }
    } else if (operation.kind === 'insert') {
      assertSafeJson(operation.value)
      if (!Array.isArray(parent) || typeof key !== 'number' || key > parent.length) invalid('Insert requires a valid array index.')
      parent.splice(key, 0, structuredClone(operation.value))
    } else if (operation.kind === 'remove') {
      if (Array.isArray(parent)) {
        if (typeof key !== 'number' || key >= parent.length) invalid('Remove array index is invalid.')
        parent.splice(key, 1)
      } else {
        if (typeof key !== 'string' || !hasOwn(parent, key)) invalid('Remove object key is invalid.')
        delete parent[key]
      }
    } else {
      if (!Array.isArray(parent) || typeof key !== 'number' || key >= parent.length || operation.toIndex >= parent.length) invalid('Move index is invalid.')
      const [item] = parent.splice(key, 1)
      parent.splice(operation.toIndex, 0, item)
    }
  }
  assertSafeJson(next)
  return next
}
