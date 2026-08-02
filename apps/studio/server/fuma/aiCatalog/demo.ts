import type { FumaRequestContext } from "../context/contracts";
import { MemoryAiCatalogRepository } from "./memory";
import {
  AiCatalogService,
  type AiCatalogRefreshSourceRegistry,
} from "./service";

const NOW = new Date("2026-07-28T10:00:00.000Z");

function platformAuthority(): FumaRequestContext {
  return Object.freeze({
    requestId: "request-ai-catalog-demo",
    source: {
      kind: "staff-session",
      correlationId: "request-ai-catalog-demo",
      userId: "platform-owner",
      sessionId: "session-ai-catalog-demo",
      impersonatedBy: null,
    },
    actor: {
      kind: "staff",
      userId: "platform-owner",
      sessionId: "session-ai-catalog-demo",
      impersonator: null,
    },
    scope: {
      platform: { id: "fuma", status: "active" },
      organization: { id: "internal", platformId: "fuma", status: "active" },
      workspace: {
        id: "control",
        platformId: "fuma",
        organizationId: "internal",
        status: "active",
      },
      site: {
        id: "admin",
        platformId: "fuma",
        organizationId: "internal",
        workspaceId: "control",
        profileId: "website",
        status: "active",
      },
    },
    profile: { id: "website", status: "active" },
    capabilities: [],
    permissions: {
      subjectId: "platform-owner",
      allow: ["platform.settings.read", "platform.settings.write"],
      deny: [],
    },
  } satisfies FumaRequestContext);
}

export type AiCatalogDemoEvidence = Readonly<{
  enabledModelIds: readonly string[];
  disabledModelIds: readonly string[];
  defaultModelId: string | null;
  paidChargeMicros: number;
  refreshStates: readonly string[];
  secretFree: boolean;
}>;

/** Deterministic FUMA-063 acceptance fixture; it never performs network/provider calls. */
export async function runAiCatalogDemo(): Promise<AiCatalogDemoEvidence> {
  const repository = new MemoryAiCatalogRepository();
  const sources: AiCatalogRefreshSourceRegistry = {
    exact: (providerId) =>
      providerId === "fixture-provider"
        ? {
            snapshot: async () => ({
              sourceSequence: 1,
              sourceObservedAt: "2026-07-28T09:59:00.000Z",
              models: [
                {
                  modelId: "paid-model",
                  displayName: "Paid model",
                  capabilities: {
                    toolCalling: true,
                    visionInput: true,
                    toolResultImages: true,
                    promptCache: true,
                    streaming: true,
                    jsonOutput: true,
                  },
                  contextWindowTokens: 200_000,
                  inputMicrosPerMillion: 1_000_000,
                  outputMicrosPerMillion: 2_000_000,
                  markupBasisPoints: 2_500,
                },
                {
                  modelId: "disabled-model",
                  displayName: "Disabled model",
                  capabilities: {
                    toolCalling: false,
                    visionInput: false,
                    toolResultImages: false,
                    promptCache: false,
                    streaming: true,
                    jsonOutput: false,
                  },
                  contextWindowTokens: 32_000,
                  inputMicrosPerMillion: 100_000,
                  outputMicrosPerMillion: 200_000,
                  markupBasisPoints: 1_000,
                },
              ],
            }),
          }
        : null,
  };
  const service = new AiCatalogService({
    repository,
    sources,
    platformId: "fuma",
    now: () => NOW,
  });
  const authority = platformAuthority();
  await service.createProvider(authority, {
    providerId: "fixture-provider",
    displayName: "Fixture Provider",
    credentialAuthorityId: "secret-ref-fixture-provider",
    staleAfterSeconds: 3_600,
  });
  await service.refresh(authority, "fixture-provider", {
    refreshId: "refresh-1",
    idempotencyKey: "refresh-fixture-provider-1",
  });
  await service.controlModel(authority, "fixture-provider", "paid-model", {
    enabled: true,
    visibility: "customer",
    allowedProfiles: ["website"],
    expectedVersion: 1,
  });
  await service.controlModel(authority, "fixture-provider", "disabled-model", {
    enabled: false,
    visibility: "customer",
    allowedProfiles: ["website"],
    expectedVersion: 1,
  });
  await service.controlProvider(authority, "fixture-provider", {
    enabled: true,
    expectedVersion: 2,
  });
  await service.setDefault(authority, {
    profile: "website",
    target: { kind: "platform", scopeId: null },
    selection: { providerId: "fixture-provider", modelId: "paid-model" },
    expectedVersion: null,
  });
  const audience = {
    kind: "customer",
    platformId: "fuma",
    organizationId: "customer-org",
    workspaceId: "customer-workspace",
    siteId: "customer-site",
    profile: "website",
  };
  const projection = await service.customerProjection(audience);
  const quote = await service.quote(audience, {
    providerId: "fixture-provider",
    modelId: "paid-model",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  const admin = await service.adminProjection(authority);
  const enabledModelIds = projection.providers.flatMap((provider) =>
    provider.models.map((model) => model.modelId),
  );
  const disabledModelIds = admin.providers.flatMap((provider) =>
    provider.models
      .filter((model) => !model.enabled)
      .map((model) => model.modelId),
  );
  const serialized = JSON.stringify({ projection, admin });
  return Object.freeze({
    enabledModelIds: Object.freeze(enabledModelIds),
    disabledModelIds: Object.freeze(disabledModelIds),
    defaultModelId: projection.defaultModel?.modelId ?? null,
    paidChargeMicros: quote.chargeMicros,
    refreshStates: Object.freeze(
      admin.refreshes.map((refresh) => refresh.state),
    ),
    secretFree: !/secret-ref|credentialAuthorityId|ciphertext|apiKey/i.test(
      serialized,
    ),
  });
}
