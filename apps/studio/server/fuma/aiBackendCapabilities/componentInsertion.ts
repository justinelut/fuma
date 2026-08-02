import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { ComponentCatalogService } from '../componentCatalog/service'
import type { ComponentCatalogScope } from '../componentCatalog/contracts'
import type { ReviewedBackendCapability } from './registry'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const Coordinate = Type.String({
  minLength: 7,
  maxLength: 320,
  pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)+/[a-z0-9][a-z0-9-]*@[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$',
})
const SafeJson = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: 8_192 }),
  Type.Array(Self, { maxItems: 128 }),
  Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Self, { maxProperties: 128 }),
]))

export const InsertDataBackedSectionInputSchema = Type.Object({
  coordinate: Coordinate,
  componentId: Id,
  usageId: Id,
  kind: Type.Union([
    Type.Literal('page-node'),
    Type.Literal('visual-component'),
    Type.Literal('template'),
  ]),
  resourceId: Id,
  parentNodeId: Id,
  variantId: Type.Union([Id, Type.Null()]),
  props: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), SafeJson, { maxProperties: 128 }),
}, Strict)

export const InsertDataBackedSectionOutputSchema = Type.Object({
  usage: Type.Object({
    usageId: Id,
    coordinate: Coordinate,
    kind: Type.Union([
      Type.Literal('page-node'),
      Type.Literal('visual-component'),
      Type.Literal('template'),
    ]),
    resourceId: Id,
    nodeId: Id,
    variantId: Type.Union([Id, Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  }, Strict),
  insertion: Type.Object({
    moduleId: Type.Literal('fuma.component'),
    component: Type.Object({
      coordinate: Coordinate,
      componentId: Id,
      variantId: Type.Union([Id, Type.Null()]),
    }, Strict),
    props: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), SafeJson, { maxProperties: 128 }),
    parentNodeId: Id,
  }, Strict),
}, Strict)

export const INSERT_DATA_BACKED_SECTION_CAPABILITY = Object.freeze({
  id: 'site.component-usage.insert',
  version: '1.0.0',
} as const)

type RawComponentResult = Readonly<{
  usage: Readonly<{
    scope: ComponentCatalogScope
    usageId: string
    coordinate: string
    kind: 'page-node' | 'visual-component' | 'template' | 'retained-release'
    resourceId: string
    nodeId: string | null
    variantId: string | null
    createdAt: string
  }>
  insertion: unknown
}>

/** One concrete data-backed mutation proving Site AI/MCP share one reviewed implementation. */
export function createInsertDataBackedSectionCapability(
  service: Pick<ComponentCatalogService, 'execute'>,
): ReviewedBackendCapability {
  return Object.freeze({
    metadata: Object.freeze({
      ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
      title: 'Insert an exact reviewed component section',
      description: 'Records one exact-owner component usage and returns a minimized editor insertion descriptor.',
      class: 'mutate',
      profiles: ['website', 'publication'] as ('website' | 'publication')[],
      channels: ['site-ai', 'mcp'] as ('site-ai' | 'mcp')[],
      requiredPermission: 'site.structure.edit',
      grants: {
        siteAi: 'ai.tools.write',
        mcp: 'component.mutate',
        importedRuntime: null,
        exportAdapter: null,
      },
      dataClassification: 'internal',
      confirmation: 'none',
      limits: {
        inputBytes: 65_536,
        outputBytes: 131_072,
        resultItems: 1,
        requestsPerMinute: 60,
        timeoutMs: 10_000,
      },
      metering: { kind: 'ai' as const, logicalCredits: 1, providerCredits: 1 },
      exportAdapter: { id: 'fuma.adapter.component-usage', version: '1.0.0' },
      state: 'active',
    }),
    inputSchema: InsertDataBackedSectionInputSchema,
    outputSchema: InsertDataBackedSectionOutputSchema,
    async execute(raw, context) {
      const parsed = safeParseValue(InsertDataBackedSectionInputSchema, raw)
      if (!parsed.ok) throw new TypeError('Component capability input is invalid.')
      if (context.signal.aborted) throw new Error('Component capability was aborted.')
      const scope: ComponentCatalogScope = Object.freeze({
        platformId: context.authority.scope.platformId,
        organizationId: context.authority.scope.organizationId,
        workspaceId: context.authority.scope.workspaceId,
        siteId: context.authority.scope.siteId,
        ownerKey: context.authority.scope.ownerKey,
        ownerGeneration: context.authority.scope.ownerGeneration,
        profileId: context.authority.scope.profileId,
      })
      const result = await service.execute({
        scope,
        actorId: context.authority.actor.actorId,
        operationId: context.authority.operationId,
      }, 'insert', parsed.value) as RawComponentResult
      if (result.usage.kind === 'retained-release' || result.usage.nodeId === null) {
        throw new TypeError('Component capability returned an unsupported usage shape.')
      }
      return {
        usage: {
          usageId: result.usage.usageId,
          coordinate: result.usage.coordinate,
          kind: result.usage.kind,
          resourceId: result.usage.resourceId,
          nodeId: result.usage.nodeId,
          variantId: result.usage.variantId,
          createdAt: result.usage.createdAt,
        },
        insertion: result.insertion,
      }
    },
  })
}
