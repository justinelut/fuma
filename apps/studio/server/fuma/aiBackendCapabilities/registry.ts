import {
  Type,
  safeParseValue,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import {
  BackendCapabilityMetadataSchema,
  BackendCapabilityReceiptSchema,
  TrustedBackendCapabilityAuthoritySchema,
  parseBackendCapability,
  type BackendCapabilityMetadata,
  type BackendCapabilityReceipt,
  type TrustedBackendCapabilityAuthority,
} from './contracts'

export type ReviewedBackendCapability = Readonly<{
  metadata: BackendCapabilityMetadata
  inputSchema: TSchema
  outputSchema: TSchema
  execute(input: unknown, context: Readonly<{
    authority: TrustedBackendCapabilityAuthority
    signal: AbortSignal
  }>): Promise<unknown>
}>

export interface BackendCapabilityEvidencePort {
  admit(input: Readonly<{
    metadata: BackendCapabilityMetadata
    authority: TrustedBackendCapabilityAuthority
  }>): Promise<void>
  record(input: Readonly<{
    metadata: BackendCapabilityMetadata
    authority: TrustedBackendCapabilityAuthority
    receipt: BackendCapabilityReceipt
  }>): Promise<Readonly<{ metered: true; audited: true }>>
}

export class BackendCapabilityError extends Error {
  override readonly name = 'BackendCapabilityError'
  readonly code:
    | 'invalid-contract'
    | 'duplicate'
    | 'unavailable'
    | 'denied'
    | 'revoked'
    | 'confirmation'
    | 'limit'
    | 'timeout'
    | 'unsafe-schema'

  constructor(code: BackendCapabilityError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(canonical(value)).byteLength
}

function schemaChildren(schema: TSchema): readonly TSchema[] {
  const value = schema as TSchema & {
    anyOf?: TSchema[]
    oneOf?: TSchema[]
    allOf?: TSchema[]
    items?: TSchema | TSchema[]
    properties?: Record<string, TSchema>
    patternProperties?: Record<string, TSchema>
    additionalProperties?: boolean | TSchema
  }
  const children: TSchema[] = [
    ...(value.anyOf ?? []),
    ...(value.oneOf ?? []),
    ...(value.allOf ?? []),
    ...Object.values(value.properties ?? {}),
    ...Object.values(value.patternProperties ?? {}),
  ]
  if (Array.isArray(value.items)) children.push(...value.items)
  else if (value.items && typeof value.items === 'object') children.push(value.items)
  if (value.additionalProperties && typeof value.additionalProperties === 'object') {
    children.push(value.additionalProperties)
  }
  return children
}

/** Reject permissive Any/Unknown and non-strict object schemas at registration. */
export function assertStrictCapabilitySchema(schema: TSchema, path: string): void {
  const seen = new Set<TSchema>()
  const visit = (value: TSchema, current: string): void => {
    if (seen.has(value)) return
    seen.add(value)
    const kind = String(((value as unknown) as Record<PropertyKey, unknown>)[Symbol.for('TypeBox.Kind')] ?? '')
    if (kind === 'Any' || kind === 'Unknown') {
      throw new BackendCapabilityError('unsafe-schema', `${current} cannot use ${kind}.`)
    }
    if (kind === 'Object' && (value as { additionalProperties?: unknown }).additionalProperties !== false) {
      throw new BackendCapabilityError('unsafe-schema', `${current} must set additionalProperties: false.`)
    }
    schemaChildren(value).forEach((child, index) => visit(child, `${current}.${index}`))
  }
  visit(schema, path)
}

function requiredGrant(metadata: BackendCapabilityMetadata, authority: TrustedBackendCapabilityAuthority): string | null {
  switch (authority.channel) {
    case 'site-ai': return metadata.grants.siteAi
    case 'mcp': return metadata.grants.mcp
    case 'imported-runtime': return metadata.grants.importedRuntime
    case 'export-adapter': return metadata.grants.exportAdapter
  }
}

function assertAuthority(metadata: BackendCapabilityMetadata, authority: TrustedBackendCapabilityAuthority): void {
  if (authority.state !== 'active') throw new BackendCapabilityError('revoked', 'Capability authority is revoked.')
  if (authority.authorityRevision !== authority.scope.ownerGeneration) {
    throw new BackendCapabilityError('revoked', 'Capability owner generation is stale.')
  }
  if (authority.actor.impersonatorId !== null) {
    throw new BackendCapabilityError('denied', 'Impersonated capability invocation is denied.')
  }
  if (!metadata.profiles.includes(authority.scope.profileId)
    || !metadata.channels.includes(authority.channel)) {
    throw new BackendCapabilityError('denied', 'Capability is unavailable for this site profile or channel.')
  }
  if (!authority.permissions.includes(metadata.requiredPermission)) {
    throw new BackendCapabilityError('denied', 'Required capability permission is unavailable.')
  }
  const grant = requiredGrant(metadata, authority)
  if (!grant || !authority.grants.includes(grant)) {
    throw new BackendCapabilityError('denied', 'Required capability grant is unavailable.')
  }
  if (metadata.confirmation === 'owner') {
    const confirmation = authority.confirmation
    const exact = confirmation
      && confirmation.actorId === authority.actor.actorId
      && confirmation.operationId === authority.operationId
      && confirmation.capabilityId === metadata.id
      && confirmation.capabilityVersion === metadata.version
      && confirmation.ownerKey === authority.scope.ownerKey
      && confirmation.ownerGeneration === authority.scope.ownerGeneration
    if (!exact) throw new BackendCapabilityError('confirmation', 'Exact owner confirmation is required.')
  } else if (authority.confirmation !== null) {
    throw new BackendCapabilityError('confirmation', 'Confirmation cannot widen an unprotected capability.')
  }
}

const InvocationOutputSchema = <T extends TSchema>(output: T) => Type.Object({
  output,
  receipt: BackendCapabilityReceiptSchema,
}, { additionalProperties: false })

export class ReviewedBackendCapabilityRegistry {
  readonly #definitions = new Map<string, ReviewedBackendCapability>()
  readonly #now: () => Date

  constructor(now: () => Date = () => new Date()) {
    this.#now = now
  }

  register(definition: ReviewedBackendCapability): this {
    const metadata = parseBackendCapability(
      BackendCapabilityMetadataSchema,
      definition.metadata,
      'backendCapability.metadata',
    ) as BackendCapabilityMetadata
    assertStrictCapabilitySchema(definition.inputSchema, `${metadata.id}.input`)
    assertStrictCapabilitySchema(definition.outputSchema, `${metadata.id}.output`)
    const key = `${metadata.id}@${metadata.version}`
    if (this.#definitions.has(key)) {
      throw new BackendCapabilityError('duplicate', `Capability ${key} is already registered.`)
    }
    this.#definitions.set(key, Object.freeze({ ...definition, metadata }))
    return this
  }

  definition(id: string, version: string): ReviewedBackendCapability | null {
    return this.#definitions.get(`${id}@${version}`) ?? null
  }

  async invoke(input: Readonly<{
    id: string
    version: string
    rawInput: unknown
    resolveAuthority(): Promise<TrustedBackendCapabilityAuthority>
    evidence: BackendCapabilityEvidencePort
    signal?: AbortSignal
  }>): Promise<Readonly<{ output: unknown; receipt: BackendCapabilityReceipt }>> {
    const definition = this.definition(input.id, input.version)
    if (!definition || definition.metadata.state !== 'active') {
      throw new BackendCapabilityError('unavailable', 'Reviewed backend capability is unavailable.')
    }

    // Validate and bound caller business input before authority resolution.
    // Hostile SQL/scope/credential fields therefore cannot trigger DB contact.
    const parsedInput = safeParseValue(definition.inputSchema, input.rawInput)
    if (!parsedInput.ok) throw new BackendCapabilityError('invalid-contract', 'Capability input is invalid.')
    const validatedInput = structuredClone(parsedInput.value)
    if (bytes(validatedInput) > definition.metadata.limits.inputBytes) {
      throw new BackendCapabilityError('limit', 'Capability input exceeds its bounded size.')
    }

    const authority = parseBackendCapability(
      TrustedBackendCapabilityAuthoritySchema,
      await input.resolveAuthority(),
      'backendCapability.authority',
    ) as TrustedBackendCapabilityAuthority
    assertAuthority(definition.metadata, authority)
    await input.evidence.admit({ metadata: definition.metadata, authority })

    const controller = new AbortController()
    const external = input.signal
    const abort = () => controller.abort(external?.reason)
    external?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort('capability-timeout'), definition.metadata.limits.timeoutMs)
    try {
      if (external?.aborted) abort()
      const rawOutput = await definition.execute(validatedInput, {
        authority,
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        throw new BackendCapabilityError('timeout', 'Capability execution exceeded its bounded time.')
      }
      const parsedOutput = safeParseValue(definition.outputSchema, rawOutput)
      if (!parsedOutput.ok) throw new BackendCapabilityError('invalid-contract', 'Capability output is invalid.')
      const output = structuredClone(parsedOutput.value)
      if (bytes(output) > definition.metadata.limits.outputBytes) {
        throw new BackendCapabilityError('limit', 'Capability output exceeds its bounded size.')
      }
      const occurredAt = this.#now().toISOString()
      const inputHashSha256 = await sha256(validatedInput)
      const outputHashSha256 = await sha256(output)
      const receiptBase = {
        capabilityId: definition.metadata.id,
        capabilityVersion: definition.metadata.version,
        channel: authority.channel,
        operationId: authority.operationId,
        outerReceiptId: authority.outerReceiptId,
        inputHashSha256,
        outputHashSha256,
        outcome: 'succeeded' as const,
        metered: true,
        audited: true,
        occurredAt,
      }
      const receipt = parseBackendCapability(BackendCapabilityReceiptSchema, {
        ...receiptBase,
        receiptId: await sha256(receiptBase),
      }, 'backendCapability.receipt') as BackendCapabilityReceipt
      await input.evidence.record({ metadata: definition.metadata, authority, receipt })
      return parseBackendCapability(
        InvocationOutputSchema(definition.outputSchema),
        { output, receipt },
        'backendCapability.result',
      ) as Readonly<{ output: unknown; receipt: BackendCapabilityReceipt }>
    } finally {
      clearTimeout(timeout)
      external?.removeEventListener('abort', abort)
    }
  }
}
