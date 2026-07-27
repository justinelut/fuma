import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  AUDIT_METADATA_MAX_ARRAY_ITEMS,
  AUDIT_METADATA_MAX_BYTES,
  AUDIT_METADATA_MAX_DEPTH,
  AUDIT_METADATA_MAX_NODES,
  AUDIT_METADATA_MAX_PROPERTIES,
  AUDIT_METADATA_MAX_STRING_LENGTH,
  AuditMetadataKeySchema,
  AuditMetadataSchema,
  type AuditMetadata,
} from './contracts'
import {
  getAuditEventCatalogEntry,
  normalizeAuditMetadataKey,
} from './catalog'

export const AUDIT_REDACTED_VALUE = '[REDACTED]'

export const AuditMetadataErrorCodeSchema = Type.Union([
  Type.Literal('invalid-metadata'),
  Type.Literal('circular-reference'),
  Type.Literal('maximum-depth'),
  Type.Literal('maximum-nodes'),
  Type.Literal('maximum-size'),
  Type.Literal('missing-required-metadata'),
])
export type AuditMetadataErrorCode = Static<typeof AuditMetadataErrorCodeSchema>

export class AuditMetadataError extends Error {
  readonly code: AuditMetadataErrorCode
  readonly path: string

  constructor(code: AuditMetadataErrorCode, message: string, path: string) {
    super(message)
    this.name = 'AuditMetadataError'
    this.code = code
    this.path = path
  }
}

const SENSITIVE_KEY_MARKERS = Object.freeze([
  'secret',
  'password',
  'passwd',
  'token',
  'apikey',
  'cookie',
  'authorization',
  'session',
  'otp',
  'mfa',
  'privatekey',
  'requestbody',
  'payload',
] as const)

export function isSensitiveAuditMetadataKey(key: string): boolean {
  const normalized = normalizeAuditMetadataKey(key)
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker))
}

function invalid(message: string, path: string): never {
  throw new AuditMetadataError('invalid-metadata', message, path)
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function propertyPath(parent: string, key: string): string {
  return `${parent}.${key}`
}

type TraversalState = {
  nodes: number
  bytes: number
  readonly ancestors: WeakSet<object>
  readonly encoder: TextEncoder
}

function addSerializedBytes(state: TraversalState, value: string, path: string): void {
  state.bytes += state.encoder.encode(value).byteLength
  if (state.bytes > AUDIT_METADATA_MAX_BYTES) {
    throw new AuditMetadataError(
      'maximum-size',
      `Audit metadata exceeds ${AUDIT_METADATA_MAX_BYTES} serialized bytes.`,
      path,
    )
  }
}

function enterValue(state: TraversalState, depth: number, path: string): void {
  if (depth > AUDIT_METADATA_MAX_DEPTH) {
    throw new AuditMetadataError(
      'maximum-depth',
      `Audit metadata exceeds maximum depth ${AUDIT_METADATA_MAX_DEPTH}.`,
      path,
    )
  }
  state.nodes += 1
  if (state.nodes > AUDIT_METADATA_MAX_NODES) {
    throw new AuditMetadataError(
      'maximum-nodes',
      `Audit metadata exceeds ${AUDIT_METADATA_MAX_NODES} values.`,
      path,
    )
  }
}

function assertDataProperty(
  owner: object,
  key: string,
  path: string,
): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key)
  if (
    !descriptor
    || !descriptor.enumerable
    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    invalid('Audit metadata may contain only enumerable data properties.', path)
  }
  return descriptor
}

function walkMetadataValue(
  value: unknown,
  depth: number,
  path: string,
  redactWholeValue: boolean,
  state: TraversalState,
): unknown {
  enterValue(state, depth, path)

  if (value === null || typeof value === 'boolean') {
    addSerializedBytes(state, JSON.stringify(value), path)
    return redactWholeValue ? AUDIT_REDACTED_VALUE : value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Audit metadata numbers must be finite.', path)
    addSerializedBytes(state, JSON.stringify(value), path)
    return redactWholeValue ? AUDIT_REDACTED_VALUE : value
  }
  if (typeof value === 'string') {
    if (value.length > AUDIT_METADATA_MAX_STRING_LENGTH) {
      invalid(
        `Audit metadata strings may not exceed ${AUDIT_METADATA_MAX_STRING_LENGTH} characters.`,
        path,
      )
    }
    addSerializedBytes(state, JSON.stringify(value), path)
    return redactWholeValue ? AUDIT_REDACTED_VALUE : value
  }
  if (typeof value !== 'object') {
    invalid(`Audit metadata cannot contain ${typeof value} values.`, path)
  }

  if (state.ancestors.has(value)) {
    throw new AuditMetadataError(
      'circular-reference',
      'Audit metadata cannot contain circular references.',
      path,
    )
  }
  state.ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      if (value.length > AUDIT_METADATA_MAX_ARRAY_ITEMS) {
        invalid(
          `Audit metadata arrays may not exceed ${AUDIT_METADATA_MAX_ARRAY_ITEMS} items.`,
          path,
        )
      }
      const ownKeys = Reflect.ownKeys(value)
      if (
        ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== value.length + 1
        || !ownKeys.includes('length')
        || Object.keys(value).length !== value.length
      ) {
        invalid('Audit metadata arrays must be dense and have no custom properties.', path)
      }

      addSerializedBytes(state, '[', path)
      const result: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}.${index}`
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          invalid('Audit metadata arrays must not contain holes.', itemPath)
        }
        const descriptor = assertDataProperty(value, String(index), itemPath)
        if (index > 0) addSerializedBytes(state, ',', itemPath)
        const item = walkMetadataValue(
          descriptor.value,
          depth + 1,
          itemPath,
          redactWholeValue,
          state,
        )
        if (!redactWholeValue) result.push(item)
      }
      addSerializedBytes(state, ']', path)
      return redactWholeValue ? AUDIT_REDACTED_VALUE : result
    }

    if (!isPlainRecord(value)) {
      invalid('Audit metadata objects must be plain records.', path)
    }
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      invalid('Audit metadata cannot contain symbol keys.', path)
    }
    const keys = Object.keys(value).sort()
    if (ownKeys.length !== keys.length) {
      invalid('Audit metadata may not contain hidden or accessor properties.', path)
    }
    if (keys.length > AUDIT_METADATA_MAX_PROPERTIES) {
      invalid(
        `Audit metadata objects may not exceed ${AUDIT_METADATA_MAX_PROPERTIES} properties.`,
        path,
      )
    }

    addSerializedBytes(state, '{', path)
    const result: Record<string, unknown> = {}
    for (const [index, key] of keys.entries()) {
      const childPath = propertyPath(path, key)
      if (!Value.Check(AuditMetadataKeySchema, key)) {
        invalid(`Audit metadata key "${key}" is invalid.`, childPath)
      }
      const descriptor = assertDataProperty(value, key, childPath)
      if (index > 0) addSerializedBytes(state, ',', childPath)
      addSerializedBytes(state, `${JSON.stringify(key)}:`, childPath)
      const sensitive = redactWholeValue || isSensitiveAuditMetadataKey(key)
      const child = walkMetadataValue(
        descriptor.value,
        depth + 1,
        childPath,
        sensitive,
        state,
      )
      if (!redactWholeValue) result[key] = sensitive ? AUDIT_REDACTED_VALUE : child
    }
    addSerializedBytes(state, '}', path)
    return redactWholeValue ? AUDIT_REDACTED_VALUE : result
  } finally {
    state.ancestors.delete(value)
  }
}

/**
 * Validates, bounds, clones, sorts, and redacts metadata before persistence.
 * Unknown actions and malformed metadata always fail closed.
 */
export function redactAuditMetadata(
  action: string,
  metadata: unknown,
): AuditMetadata {
  const catalogEntry = getAuditEventCatalogEntry(action)
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    invalid('Audit metadata must be a plain record.', 'metadata')
  }

  const redacted = walkMetadataValue(metadata, 0, 'metadata', false, {
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet<object>(),
    encoder: new TextEncoder(),
  })
  const parsed = safeParseValue(AuditMetadataSchema, redacted)
  if (!parsed.ok) {
    invalid('Redacted audit metadata does not match its TypeBox contract.', 'metadata')
  }

  for (const requiredKey of catalogEntry.requiredMetadataKeys) {
    if (!Object.prototype.hasOwnProperty.call(parsed.value, requiredKey)) {
      throw new AuditMetadataError(
        'missing-required-metadata',
        `Audit action "${action}" requires metadata key "${requiredKey}".`,
        `metadata.${requiredKey}`,
      )
    }
  }

  return immutable(parsed.value)
}
