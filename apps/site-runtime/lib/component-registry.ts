import { LAWYER_SOURCE_COMPONENTS } from '../components/lawyer-components'
import type {
  ComponentReference,
  ComponentRegistryEntry,
  RuntimeRouteArtifact,
} from './contracts'

export function componentKey(reference: ComponentReference): string {
  return `${reference.namespace}:${reference.componentId}@${reference.exactVersion}`
}

export type OfficialComponentDefinition = Readonly<{
  componentId: string
  exactVersion: string
  client: boolean
  capabilities?: Readonly<ComponentRegistryEntry['capabilities']>
}>

const FIRST_PARTY_COMPONENTS: readonly OfficialComponentDefinition[] = Object.freeze([
  { componentId: 'layout.section', exactVersion: '1.0.0', client: false },
  { componentId: 'base.body', exactVersion: '2.0.0', client: false },
  { componentId: 'base.container', exactVersion: '2.0.0', client: false },
  { componentId: 'base.text', exactVersion: '2.0.0', client: false },
  { componentId: 'base.image', exactVersion: '4.0.0', client: false },
  { componentId: 'base.link', exactVersion: '2.0.0', client: false },
  { componentId: 'base.button', exactVersion: '2.0.0', client: false },
  { componentId: 'base.list', exactVersion: '2.0.0', client: false },
  { componentId: 'base.svg', exactVersion: '1.0.0', client: false },
  { componentId: 'base.video', exactVersion: '4.0.0', client: false },
  { componentId: 'base.form', exactVersion: '1.0.0', client: false },
  { componentId: 'base.label', exactVersion: '1.0.0', client: false },
  { componentId: 'base.input', exactVersion: '1.0.0', client: false },
  { componentId: 'base.textarea', exactVersion: '1.0.0', client: false },
  { componentId: 'base.select', exactVersion: '1.0.0', client: false },
  { componentId: 'base.option', exactVersion: '1.0.0', client: false },
  { componentId: 'base.option-group', exactVersion: '1.0.0', client: false },
  { componentId: 'base.checkbox', exactVersion: '1.0.0', client: false },
  { componentId: 'base.radio', exactVersion: '1.0.0', client: false },
  { componentId: 'base.submit', exactVersion: '1.0.0', client: false },
  { componentId: 'base.form-message', exactVersion: '1.0.0', client: false },
  { componentId: 'base.outlet', exactVersion: '1.0.0', client: false },
  { componentId: 'base.loop', exactVersion: '1.0.0', client: false },
  { componentId: 'base.slot-instance', exactVersion: '1.0.0', client: false },
  { componentId: 'base.slot-outlet', exactVersion: '1.0.0', client: false },
  { componentId: 'base.visual-component-ref', exactVersion: '1.0.0', client: false },
  { componentId: 'application.member-status', exactVersion: '1.0.0', client: true, capabilities: ['interaction.local-state'] },
  { componentId: 'application.cart-action', exactVersion: '1.0.0', client: true, capabilities: ['interaction.local-state'] },
  { componentId: 'application.booking-action', exactVersion: '1.0.0', client: true, capabilities: ['interaction.local-state'] },
  ...LAWYER_SOURCE_COMPONENTS,
])

export class RuntimeRegistryError extends Error {
  constructor(readonly code: 'duplicate' | 'unknown' | 'version' | 'scope' | 'trust' | 'capability' | 'artifact', message: string) {
    super(message)
    this.name = 'RuntimeRegistryError'
  }
}

export class ExactRuntimeRegistry {
  readonly #official = new Map<string, OfficialComponentDefinition>()
  readonly #entries = new Map<string, ComponentRegistryEntry>()
  readonly #artifactPaths: ReadonlySet<string>
  readonly #ownerKey: string
  readonly #siteId: string

  constructor(
    route: RuntimeRouteArtifact,
    scope: Readonly<{ ownerKey: string; siteId: string }>,
    additions: readonly OfficialComponentDefinition[] = [],
  ) {
    this.#ownerKey = scope.ownerKey
    this.#siteId = scope.siteId
    for (const definition of [...FIRST_PARTY_COMPONENTS, ...additions]) this.registerOfficial(definition)
    this.#artifactPaths = new Set(route.artifactReferences.map(({ logicalPath }) => logicalPath))
    for (const entry of route.components) {
      const key = componentKey(entry.reference)
      if (this.#entries.has(key)) throw new RuntimeRegistryError('duplicate', `Duplicate exact component ${key}.`)
      this.#assertEntry(entry)
      this.#entries.set(key, entry)
    }
  }

  registerOfficial(definition: OfficialComponentDefinition): void {
    const key = `fuma.official:${definition.componentId}@${definition.exactVersion}`
    if (this.#official.has(key)) throw new RuntimeRegistryError('duplicate', `Duplicate compiled component ${key}.`)
    this.#official.set(key, Object.freeze({ ...definition, ...(definition.capabilities ? { capabilities: Object.freeze([...definition.capabilities]) } : {}) }))
  }

  resolve(reference: ComponentReference, requiredCapabilities: readonly string[] = []): ComponentRegistryEntry {
    const key = componentKey(reference)
    const entry = this.#entries.get(key)
    if (!entry) throw new RuntimeRegistryError('unknown', `Unknown exact component ${key}.`)
    const available = new Set(entry.capabilities)
    if (requiredCapabilities.some((capability) => !available.has(capability as never))) {
      throw new RuntimeRegistryError('capability', `${key} requests undeclared runtime capabilities.`)
    }
    return entry
  }

  #assertEntry(entry: ComponentRegistryEntry): void {
    const key = componentKey(entry.reference)
    if (entry.dynamicTenantServerImport || entry.persistedExecutableJsx) {
      throw new RuntimeRegistryError('trust', `${key} carries forbidden executable tenant source.`)
    }
    if (entry.source.kind === 'official') {
      const compiled = this.#official.get(key)
      if (!compiled) throw new RuntimeRegistryError('version', `${key} is not compiled into this deployment.`)
      if (entry.trust.tier !== 'official' || entry.definition !== null || entry.parameters.length !== 0) {
        throw new RuntimeRegistryError('trust', `${key} has invalid official trust metadata.`)
      }
      const execution = compiled.client ? 'official-client' : 'official-server'
      if (entry.execution !== execution) throw new RuntimeRegistryError('trust', `${key} changed its compiled execution boundary.`)
      if (compiled.capabilities) {
        const declared = [...entry.capabilities].toSorted()
        const allowed = [...compiled.capabilities].toSorted()
        if (declared.length !== allowed.length || declared.some((capability, index) => capability !== allowed[index])) {
          throw new RuntimeRegistryError('capability', `${key} changed its compiled capability boundary.`)
        }
      }
      return
    }
    if (entry.source.ownerKey !== this.#ownerKey || entry.source.siteId !== this.#siteId) {
      throw new RuntimeRegistryError('scope', `${key} belongs to another owner or site.`)
    }
    if (entry.execution === 'private-declarative') {
      if (entry.trust.tier !== 'owner-private-declarative' || entry.definition === null || entry.artifactPaths.length !== 0) {
        throw new RuntimeRegistryError('trust', `${key} is not a private declarative component.`)
      }
      return
    }
    if (entry.execution !== 'restricted-client' || entry.trust.tier !== 'owner-private-restricted-client' || entry.definition !== null) {
      throw new RuntimeRegistryError('trust', `${key} cannot execute in the tenant runtime.`)
    }
    if (entry.artifactPaths.length === 0 || entry.artifactPaths.some((path) => !this.#artifactPaths.has(path))) {
      throw new RuntimeRegistryError('artifact', `${key} is not bound to complete immutable client artifacts.`)
    }
    if (!entry.artifactPaths.some((path) => /^\/runtime\/components\/[a-f0-9]{64}\.js$/.test(path))) {
      throw new RuntimeRegistryError('artifact', `${key} has no content-addressed validated client bundle.`)
    }
  }
}
