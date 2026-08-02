import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from "@core/utils/typeboxHelpers";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const IdSchema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,158}[A-Za-z0-9])?$",
});
const LabelSchema = Type.String({ minLength: 1, maxLength: 160 });
const TimestampSchema = Type.String({ format: "date-time" });
const PositiveVersionSchema = Type.Integer({ minimum: 1, maximum: MAX_SAFE });
const ExactMicrosSchema = Type.Integer({ minimum: 0, maximum: MAX_SAFE });
const NullableIdSchema = Type.Union([IdSchema, Type.Null()]);

export const AiCatalogProfileSchema = Type.Union([
  Type.Literal("website"),
  Type.Literal("publication"),
]);
export const AiCatalogVisibilitySchema = Type.Union([
  Type.Literal("public"),
  Type.Literal("customer"),
  Type.Literal("platform"),
]);
export const AiCatalogAudienceKindSchema = Type.Union([
  Type.Literal("public"),
  Type.Literal("customer"),
  Type.Literal("platform-admin"),
]);
export const AiCatalogScopeKindSchema = Type.Union([
  Type.Literal("platform"),
  Type.Literal("organization"),
  Type.Literal("workspace"),
  Type.Literal("site"),
]);
export const AiCatalogCapabilitiesSchema = Type.Object(
  {
    toolCalling: Type.Boolean(),
    visionInput: Type.Boolean(),
    toolResultImages: Type.Boolean(),
    promptCache: Type.Boolean(),
    streaming: Type.Boolean(),
    jsonOutput: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AiCatalogProviderSchema = Type.Object(
  {
    providerId: IdSchema,
    displayName: LabelSchema,
    enabled: Type.Boolean(),
    credentialAuthorityId: NullableIdSchema,
    staleAfterSeconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }),
    currentRefreshId: NullableIdSchema,
    version: PositiveVersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogModelControlSchema = Type.Object(
  {
    providerId: IdSchema,
    modelId: IdSchema,
    enabled: Type.Boolean(),
    included: Type.Boolean(),
    visibility: AiCatalogVisibilitySchema,
    allowedProfiles: Type.Array(AiCatalogProfileSchema, {
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    }),
    version: PositiveVersionSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogModelVersionSchema = Type.Object(
  {
    providerId: IdSchema,
    modelId: IdSchema,
    refreshId: IdSchema,
    displayName: LabelSchema,
    capabilities: AiCatalogCapabilitiesSchema,
    contextWindowTokens: Type.Integer({ minimum: 1, maximum: 100_000_000 }),
    inputMicrosPerMillion: ExactMicrosSchema,
    outputMicrosPerMillion: ExactMicrosSchema,
    markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
    sourceObservedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogRefreshStateSchema = Type.Union([
  Type.Literal("applied"),
  Type.Literal("rejected-stale"),
  Type.Literal("failed"),
]);
const AiCatalogCompletedRefreshProperties = {
  refreshId: IdSchema,
  providerId: IdSchema,
  idempotencyKey: IdSchema,
  sourceSequence: PositiveVersionSchema,
  sourceObservedAt: TimestampSchema,
  catalogHashSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  modelCount: Type.Integer({ minimum: 0, maximum: 20_000 }),
  errorCode: Type.Null(),
  actorId: IdSchema,
  completedAt: TimestampSchema,
} as const;
export const AiCatalogRefreshRecordSchema = Type.Union([
  Type.Object(
    {
      ...AiCatalogCompletedRefreshProperties,
      state: Type.Literal("applied"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...AiCatalogCompletedRefreshProperties,
      state: Type.Literal("rejected-stale"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      refreshId: IdSchema,
      providerId: IdSchema,
      idempotencyKey: IdSchema,
      sourceSequence: Type.Null(),
      sourceObservedAt: Type.Null(),
      catalogHashSha256: Type.Null(),
      state: Type.Literal("failed"),
      modelCount: Type.Literal(0),
      errorCode: IdSchema,
      actorId: IdSchema,
      completedAt: TimestampSchema,
    },
    { additionalProperties: false },
  ),
]);

export const AiCatalogRefreshModelSchema = Type.Object(
  {
    modelId: IdSchema,
    displayName: LabelSchema,
    capabilities: AiCatalogCapabilitiesSchema,
    contextWindowTokens: Type.Integer({ minimum: 1, maximum: 100_000_000 }),
    inputMicrosPerMillion: ExactMicrosSchema,
    outputMicrosPerMillion: ExactMicrosSchema,
    markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
  },
  { additionalProperties: false },
);
export const AiCatalogRefreshSnapshotSchema = Type.Object(
  {
    sourceSequence: PositiveVersionSchema,
    sourceObservedAt: TimestampSchema,
    models: Type.Array(AiCatalogRefreshModelSchema, { maxItems: 20_000 }),
  },
  { additionalProperties: false },
);

export const AiCatalogCreateProviderCommandSchema = Type.Object(
  {
    providerId: IdSchema,
    displayName: LabelSchema,
    credentialAuthorityId: NullableIdSchema,
    staleAfterSeconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }),
  },
  { additionalProperties: false },
);
export const AiCatalogProviderControlCommandSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    displayName: Type.Optional(LabelSchema),
    credentialAuthorityId: Type.Optional(NullableIdSchema),
    staleAfterSeconds: Type.Optional(
      Type.Integer({ minimum: 60, maximum: 2_592_000 }),
    ),
    expectedVersion: PositiveVersionSchema,
  },
  { additionalProperties: false, minProperties: 2 },
);
export const AiCatalogModelControlCommandSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    included: Type.Optional(Type.Boolean()),
    visibility: Type.Optional(AiCatalogVisibilitySchema),
    allowedProfiles: Type.Optional(
      Type.Array(AiCatalogProfileSchema, {
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
      }),
    ),
    expectedVersion: PositiveVersionSchema,
  },
  { additionalProperties: false, minProperties: 2 },
);
export const AiCatalogRefreshCommandSchema = Type.Object(
  {
    refreshId: IdSchema,
    idempotencyKey: IdSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogScopeTargetSchema = Type.Object(
  {
    kind: AiCatalogScopeKindSchema,
    scopeId: Type.Union([IdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const AiCatalogDefaultSchema = Type.Object(
  {
    profile: AiCatalogProfileSchema,
    target: AiCatalogScopeTargetSchema,
    providerId: IdSchema,
    modelId: IdSchema,
    version: PositiveVersionSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export const AiCatalogDefaultCommandSchema = Type.Object(
  {
    profile: AiCatalogProfileSchema,
    target: AiCatalogScopeTargetSchema,
    selection: Type.Union([
      Type.Object(
        { providerId: IdSchema, modelId: IdSchema },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    expectedVersion: Type.Union([PositiveVersionSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const AiCatalogTrustedAudienceSchema = Type.Object(
  {
    kind: AiCatalogAudienceKindSchema,
    platformId: IdSchema,
    organizationId: Type.Union([IdSchema, Type.Null()]),
    workspaceId: Type.Union([IdSchema, Type.Null()]),
    siteId: Type.Union([IdSchema, Type.Null()]),
    profile: AiCatalogProfileSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogModelProjectionSchema = Type.Object(
  {
    providerId: IdSchema,
    modelId: IdSchema,
    displayName: LabelSchema,
    capabilities: AiCatalogCapabilitiesSchema,
    contextWindowTokens: Type.Integer({ minimum: 1, maximum: 100_000_000 }),
    inputMicrosPerMillion: ExactMicrosSchema,
    outputMicrosPerMillion: ExactMicrosSchema,
    markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
    included: Type.Boolean(),
    visibility: AiCatalogVisibilitySchema,
    isDefault: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const AiCatalogProviderProjectionSchema = Type.Object(
  {
    providerId: IdSchema,
    displayName: LabelSchema,
    refreshedAt: TimestampSchema,
    models: Type.Array(AiCatalogModelProjectionSchema, { maxItems: 20_000 }),
  },
  { additionalProperties: false },
);
export const AiCatalogCustomerProjectionSchema = Type.Object(
  {
    generatedAt: TimestampSchema,
    profile: AiCatalogProfileSchema,
    providers: Type.Array(AiCatalogProviderProjectionSchema, { maxItems: 100 }),
    defaultModel: Type.Union([
      Type.Object(
        { providerId: IdSchema, modelId: IdSchema },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const AiCatalogAdminModelProjectionSchema = Type.Object(
  {
    ...AiCatalogModelProjectionSchema.properties,
    enabled: Type.Boolean(),
    controlVersion: PositiveVersionSchema,
    refreshId: IdSchema,
  },
  { additionalProperties: false },
);
export const AiCatalogAdminProviderProjectionSchema = Type.Object(
  {
    providerId: IdSchema,
    displayName: LabelSchema,
    enabled: Type.Boolean(),
    credentialConfigured: Type.Boolean(),
    stale: Type.Boolean(),
    staleAfterSeconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }),
    currentRefreshId: NullableIdSchema,
    refreshedAt: Type.Union([TimestampSchema, Type.Null()]),
    controlVersion: PositiveVersionSchema,
    models: Type.Array(AiCatalogAdminModelProjectionSchema, {
      maxItems: 20_000,
    }),
  },
  { additionalProperties: false },
);
export const AiCatalogAdminProjectionSchema = Type.Object(
  {
    generatedAt: TimestampSchema,
    providers: Type.Array(AiCatalogAdminProviderProjectionSchema, {
      maxItems: 100,
    }),
    refreshes: Type.Array(AiCatalogRefreshRecordSchema, { maxItems: 1_000 }),
    defaults: Type.Array(AiCatalogDefaultSchema, { maxItems: 10_000 }),
  },
  { additionalProperties: false },
);

export const AiCatalogCurrentModelSchema = Type.Object(
  {
    provider: AiCatalogProviderSchema,
    control: AiCatalogModelControlSchema,
    version: AiCatalogModelVersionSchema,
  },
  { additionalProperties: false },
);

export const AiCatalogQuoteRequestSchema = Type.Object(
  {
    providerId: IdSchema,
    modelId: IdSchema,
    inputTokens: ExactMicrosSchema,
    outputTokens: ExactMicrosSchema,
  },
  { additionalProperties: false },
);
export const AiCatalogQuoteSchema = Type.Object(
  {
    providerId: IdSchema,
    modelId: IdSchema,
    inputTokens: ExactMicrosSchema,
    outputTokens: ExactMicrosSchema,
    providerCostMicros: ExactMicrosSchema,
    markupMicros: ExactMicrosSchema,
    chargeMicros: ExactMicrosSchema,
    included: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type AiCatalogProfile = Static<typeof AiCatalogProfileSchema>;
export type AiCatalogVisibility = Static<typeof AiCatalogVisibilitySchema>;
export type AiCatalogCapabilities = Static<typeof AiCatalogCapabilitiesSchema>;
export type AiCatalogProvider = Static<typeof AiCatalogProviderSchema>;
export type AiCatalogModelControl = Static<typeof AiCatalogModelControlSchema>;
export type AiCatalogModelVersion = Static<typeof AiCatalogModelVersionSchema>;
export type AiCatalogRefreshRecord = Static<
  typeof AiCatalogRefreshRecordSchema
>;
export type AiCatalogRefreshSnapshot = Static<
  typeof AiCatalogRefreshSnapshotSchema
>;
export type AiCatalogCreateProviderCommand = Static<
  typeof AiCatalogCreateProviderCommandSchema
>;
export type AiCatalogProviderControlCommand = Static<
  typeof AiCatalogProviderControlCommandSchema
>;
export type AiCatalogModelControlCommand = Static<
  typeof AiCatalogModelControlCommandSchema
>;
export type AiCatalogRefreshCommand = Static<
  typeof AiCatalogRefreshCommandSchema
>;
export type AiCatalogScopeTarget = Static<typeof AiCatalogScopeTargetSchema>;
export type AiCatalogDefault = Static<typeof AiCatalogDefaultSchema>;
export type AiCatalogDefaultCommand = Static<
  typeof AiCatalogDefaultCommandSchema
>;
export type AiCatalogTrustedAudience = Static<
  typeof AiCatalogTrustedAudienceSchema
>;
export type AiCatalogCustomerProjection = Static<
  typeof AiCatalogCustomerProjectionSchema
>;
export type AiCatalogAdminProjection = Static<
  typeof AiCatalogAdminProjectionSchema
>;
export type AiCatalogCurrentModel = Static<typeof AiCatalogCurrentModelSchema>;
export type AiCatalogQuoteRequest = Static<typeof AiCatalogQuoteRequestSchema>;
export type AiCatalogQuote = Static<typeof AiCatalogQuoteSchema>;

export class AiCatalogContractError extends Error {
  override readonly name = "AiCatalogContractError";
  readonly boundary: string;
  readonly detail: string;

  constructor(boundary: string, detail: string) {
    super(`${boundary}: ${detail}`);
    this.boundary = boundary;
    this.detail = detail;
  }
}

export function parseAiCatalogContract<T extends TSchema>(
  schema: T,
  value: unknown,
  boundary: string,
): Static<T> {
  const parsed = safeParseValue(schema, value);
  if (!parsed.ok)
    throw new AiCatalogContractError(
      boundary,
      parsed.errors[0]?.message ?? "invalid value",
    );
  return structuredClone(parsed.value);
}
