import type { FumaRedisCapability } from './contracts'

const SAFE_NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,62}$/
const MAX_LOGICAL_KEY_BYTES = 512

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertLogicalKey(value: string, label: string): void {
  if (!value || byteLength(value) > MAX_LOGICAL_KEY_BYTES) {
    throw new RangeError(`${label} must contain 1-${MAX_LOGICAL_KEY_BYTES} UTF-8 bytes.`)
  }
}

function segment(value: string): string {
  assertLogicalKey(value, 'Redis key segment')
  return Buffer.from(value).toString('base64url')
}

/** Deployment-level keyspace. Tenant context is added by FUMA-026 rather than inferred here. */
export class FumaRedisKeyspace {
  readonly #prefix: string

  constructor(namespace: string) {
    if (!SAFE_NAMESPACE.test(namespace)) {
      throw new RangeError('Redis namespace must be a lowercase deployment identifier of at most 63 characters.')
    }
    this.#prefix = `fuma:v1:${namespace}`
  }

  key(capability: Exclude<FumaRedisCapability, 'pubsub'>, logicalKey: string): string {
    return `${this.#prefix}:${capability}:${segment(logicalKey)}`
  }

  channel(logicalChannel: string): string {
    return `${this.#prefix}:pubsub:${segment(logicalChannel)}`
  }

  presence(room: string): Readonly<{ indexKey: string; payloadKey: string }> {
    const encodedRoom = segment(room)
    return {
      indexKey: `${this.#prefix}:presence:${encodedRoom}:expiry`,
      payloadKey: `${this.#prefix}:presence:${encodedRoom}:payload`,
    }
  }

  lease(resource: string): Readonly<{ leaseKey: string; fenceKey: string }> {
    const encodedResource = segment(resource)
    return {
      leaseKey: `${this.#prefix}:leases:${encodedResource}:owner`,
      fenceKey: `${this.#prefix}:leases:${encodedResource}:fence`,
    }
  }
}
