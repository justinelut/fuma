import {
  assertLogicalObjectKey,
  assertObjectTenantScope,
} from '../objectStorage/keyPolicy'
import {
  TENANT_OBJECT_CLASSES,
  TenantObjectContractError,
  TenantObjectInventoryItemSchema,
  TenantObjectInventorySchema,
  assertTenantObjectSchema,
  type TenantObjectClass,
  type TenantObjectInventory,
  type TenantObjectInventoryItem,
  type TenantObjectMetadata,
  type TenantObjectScope,
} from './contracts'

type MetadataKey = keyof TenantObjectMetadata

export type TenantObjectClassDefinition = Readonly<{
  objectClass: TenantObjectClass
  logicalRoot: string
  requiredMetadataKeys: readonly MetadataKey[]
}>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

const DEFINITIONS: readonly TenantObjectClassDefinition[] = [
  {
    objectClass: 'content-revision',
    logicalRoot: 'content/revisions/',
    requiredMetadataKeys: ['contentId', 'revisionId'],
  },
  {
    objectClass: 'form-attachment',
    logicalRoot: 'forms/attachments/',
    requiredMetadataKeys: ['formId'],
  },
  {
    objectClass: 'media',
    logicalRoot: 'media/',
    requiredMetadataKeys: ['mediaId'],
  },
  {
    objectClass: 'publish-release',
    logicalRoot: 'publish/releases/',
    requiredMetadataKeys: ['releaseId'],
  },
  {
    objectClass: 'plugin-artifact',
    logicalRoot: 'plugins/artifacts/',
    requiredMetadataKeys: ['pluginId'],
  },
  {
    objectClass: 'plugin-installation-artifact',
    logicalRoot: 'plugins/installations/',
    requiredMetadataKeys: ['pluginId', 'pluginInstallationId'],
  },
  {
    objectClass: 'import-artifact',
    logicalRoot: 'imports/',
    requiredMetadataKeys: ['importId'],
  },
  {
    objectClass: 'export-artifact',
    logicalRoot: 'exports/',
    requiredMetadataKeys: ['exportId'],
  },
  {
    objectClass: 'ai-artifact',
    logicalRoot: 'ai/artifacts/',
    requiredMetadataKeys: ['aiArtifactId'],
  },
  {
    objectClass: 'mcp-artifact',
    logicalRoot: 'mcp/artifacts/',
    requiredMetadataKeys: ['mcpArtifactId'],
  },
]

function freezeDefinition(definition: TenantObjectClassDefinition): TenantObjectClassDefinition {
  return Object.freeze({
    ...definition,
    requiredMetadataKeys: Object.freeze([...definition.requiredMetadataKeys]),
  })
}

export const TENANT_OBJECT_CLASS_INVENTORY = Object.freeze(
  DEFINITIONS.map(freezeDefinition),
)

const DEFINITION_BY_CLASS = new Map(
  TENANT_OBJECT_CLASS_INVENTORY.map((definition) => [definition.objectClass, definition]),
)
const SORTED_DEFINITIONS = [...TENANT_OBJECT_CLASS_INVENTORY]
  .sort((left, right) => right.logicalRoot.length - left.logicalRoot.length)

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /(?:^|[\s;,])Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /(?:^|[\s;,])(?:api[_-]?key|secret|password|private[_-]?key|session[_-]?token|authorization|cookie)\s*[:=]\s*\S+/i,
  /[?&](?:access[_-]?token|refresh[_-]?token|token|signature|x-amz-credential|x-amz-signature)=[^&\s]+/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
] as const

function assertValidScope(scope: TenantObjectScope, path: string): void {
  try {
    assertObjectTenantScope(scope)
  } catch (error) {
    throw new TenantObjectContractError(
      'invalid-scope',
      `${path} is not a valid FUMA-008 tenant object scope.`,
      path,
      error,
    )
  }
}

function assertSafeLogicalKey(logicalKey: string, path: string): void {
  try {
    assertLogicalObjectKey(logicalKey)
  } catch (error) {
    throw new TenantObjectContractError(
      'class-key-mismatch',
      `${path} is not a canonical FUMA-008 logical object key.`,
      path,
      error,
    )
  }
}

function assertNoSecretMetadata(metadata: TenantObjectMetadata, path: string): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new TenantObjectContractError(
        'secret-metadata',
        `Transfer metadata field "${key}" appears to contain secret material.`,
        `${path}.${key}`,
      )
    }
  }
}

export function getTenantObjectClassDefinition(
  objectClass: TenantObjectClass,
): TenantObjectClassDefinition {
  const definition = DEFINITION_BY_CLASS.get(objectClass)
  if (!definition) {
    throw new TenantObjectContractError(
      'unknown-object-class',
      `Unknown transferable object class "${objectClass}".`,
      'objectClass',
    )
  }
  return definition
}

export function classifyTenantObjectLogicalKey(logicalKey: string): TenantObjectClass {
  assertSafeLogicalKey(logicalKey, 'logicalKey')
  const definition = SORTED_DEFINITIONS.find(({ logicalRoot }) => (
    logicalKey.startsWith(logicalRoot) && logicalKey.length > logicalRoot.length
  ))
  if (!definition) {
    throw new TenantObjectContractError(
      'unknown-object-class',
      `Logical key "${logicalKey}" is outside the transferable object inventory.`,
      'logicalKey',
    )
  }
  return definition.objectClass
}

export function assertTenantObjectInventoryItem(
  value: unknown,
  path = 'inventoryItem',
): asserts value is TenantObjectInventoryItem {
  assertTenantObjectSchema(TenantObjectInventoryItemSchema, value, path)
  const item = value
  assertSafeLogicalKey(item.logicalKey, `${path}.logicalKey`)
  const classified = classifyTenantObjectLogicalKey(item.logicalKey)
  if (classified !== item.objectClass) {
    throw new TenantObjectContractError(
      'class-key-mismatch',
      `Object class "${item.objectClass}" cannot own logical key "${item.logicalKey}".`,
      `${path}.objectClass`,
    )
  }
  const definition = getTenantObjectClassDefinition(item.objectClass)
  for (const key of definition.requiredMetadataKeys) {
    if (item.metadata[key] === undefined) {
      throw new TenantObjectContractError(
        'class-key-mismatch',
        `Object class "${item.objectClass}" requires metadata field "${key}".`,
        `${path}.metadata.${key}`,
      )
    }
  }
  assertNoSecretMetadata(item.metadata, `${path}.metadata`)
}

export function createTenantObjectInventory(value: unknown): TenantObjectInventory {
  assertTenantObjectSchema(TenantObjectInventorySchema, value, 'inventory')
  const detached = value.map((item) => ({
    ...item,
    metadata: { ...item.metadata },
  }))
  for (const [index, item] of detached.entries()) {
    assertTenantObjectInventoryItem(item, `inventory[${index}]`)
  }
  detached.sort((left, right) => compareText(left.logicalKey, right.logicalKey))
  for (let index = 1; index < detached.length; index += 1) {
    if (detached[index - 1].logicalKey === detached[index].logicalKey) {
      throw new TenantObjectContractError(
        'duplicate-key',
        `Inventory contains duplicate logical key "${detached[index].logicalKey}".`,
        `inventory[${index}].logicalKey`,
      )
    }
  }
  for (const item of detached) {
    Object.freeze(item.metadata)
    Object.freeze(item)
  }
  return Object.freeze(detached)
}

export function assertTenantObjectScope(scope: TenantObjectScope, path = 'scope'): void {
  assertValidScope(scope, path)
}

if (TENANT_OBJECT_CLASS_INVENTORY.length !== TENANT_OBJECT_CLASSES.length
  || new Set(TENANT_OBJECT_CLASS_INVENTORY.map(({ objectClass }) => objectClass)).size
    !== TENANT_OBJECT_CLASSES.length
  || new Set(TENANT_OBJECT_CLASS_INVENTORY.map(({ logicalRoot }) => logicalRoot)).size
    !== TENANT_OBJECT_CLASSES.length) {
  throw new TenantObjectContractError(
    'unknown-object-class',
    'Transferable object class inventory must cover every class with one unique logical root.',
    'TENANT_OBJECT_CLASS_INVENTORY',
  )
}
