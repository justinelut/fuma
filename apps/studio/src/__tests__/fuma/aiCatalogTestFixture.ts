import type { FumaRequestContext } from "../../../server/fuma/context/contracts";
import {
  AiCatalogService,
  MemoryAiCatalogRepository,
  type AiCatalogRefreshSource,
  type AiCatalogRefreshSourceRegistry,
} from "../../../server/fuma/aiCatalog";

export const AI_CATALOG_NOW = new Date("2026-07-28T10:00:00.000Z");

export function aiCatalogAuthority(
  input: Readonly<{
    platformId?: string;
    userId?: string;
    impersonator?: string | null;
    allow?: readonly string[];
    deny?: readonly string[];
  }> = {},
): FumaRequestContext {
  const platformId = input.platformId ?? "fuma";
  const userId = input.userId ?? "platform-owner";
  const impersonator = input.impersonator ?? null;
  return {
    requestId: "request-ai-catalog-test",
    source: {
      kind: "staff-session",
      correlationId: "request-ai-catalog-test",
      userId,
      sessionId: "session-ai-catalog-test",
      impersonatedBy: impersonator,
    },
    actor: {
      kind: "staff",
      userId,
      sessionId: "session-ai-catalog-test",
      impersonator: impersonator ? { userId: impersonator } : null,
    },
    scope: {
      platform: { id: platformId, status: "active" },
      organization: { id: "internal", platformId, status: "active" },
      workspace: {
        id: "control",
        platformId,
        organizationId: "internal",
        status: "active",
      },
      site: {
        id: "admin",
        platformId,
        organizationId: "internal",
        workspaceId: "control",
        profileId: "website",
        status: "active",
      },
    },
    profile: { id: "website", status: "active" },
    capabilities: [],
    permissions: {
      subjectId: userId,
      allow: [
        ...(input.allow ?? [
          "platform.settings.read",
          "platform.settings.write",
        ]),
      ],
      deny: [...(input.deny ?? [])],
    },
  };
}

export const customerAudience = Object.freeze({
  kind: "customer" as const,
  platformId: "fuma",
  organizationId: "organization-a",
  workspaceId: "workspace-a",
  siteId: "site-a",
  profile: "website" as const,
});

export const publicAudience = Object.freeze({
  ...customerAudience,
  kind: "public" as const,
});

export const defaultCapabilities = Object.freeze({
  toolCalling: true,
  visionInput: false,
  toolResultImages: false,
  promptCache: true,
  streaming: true,
  jsonOutput: true,
});

export type FixtureModel = Readonly<{
  modelId: string;
  displayName?: string;
  capabilities?: typeof defaultCapabilities;
  contextWindowTokens?: number;
  inputMicrosPerMillion?: number;
  outputMicrosPerMillion?: number;
  markupBasisPoints?: number;
}>;

class MutableSource implements AiCatalogRefreshSource {
  value: unknown;
  error: Error | null = null;
  calls = 0;
  constructor(value: unknown) {
    this.value = value;
  }
  async snapshot(): Promise<unknown> {
    this.calls += 1;
    if (this.error) throw this.error;
    return structuredClone(this.value);
  }
}

export async function createAiCatalogFixture(
  input: Readonly<{
    models?: readonly FixtureModel[];
    sourceSequence?: number;
    sourceObservedAt?: string;
    staleAfterSeconds?: number;
    credentialAuthorityId?: string | null;
    now?: Date;
  }> = {},
) {
  const models = input.models ?? [
    { modelId: "model-a" },
    { modelId: "model-b" },
  ];
  const source = new MutableSource({
    sourceSequence: input.sourceSequence ?? 1,
    sourceObservedAt: input.sourceObservedAt ?? "2026-07-28T09:59:00.000Z",
    models: models.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName ?? model.modelId,
      capabilities: model.capabilities ?? defaultCapabilities,
      contextWindowTokens: model.contextWindowTokens ?? 128_000,
      inputMicrosPerMillion: model.inputMicrosPerMillion ?? 1_000_000,
      outputMicrosPerMillion: model.outputMicrosPerMillion ?? 2_000_000,
      markupBasisPoints: model.markupBasisPoints ?? 2_500,
    })),
  });
  const sources: AiCatalogRefreshSourceRegistry = {
    exact: (providerId) => (providerId === "provider-a" ? source : null),
  };
  const repository = new MemoryAiCatalogRepository();
  const service = new AiCatalogService({
    repository,
    sources,
    platformId: "fuma",
    now: () => input.now ?? AI_CATALOG_NOW,
  });
  const authority = aiCatalogAuthority();
  await service.createProvider(authority, {
    providerId: "provider-a",
    displayName: "Provider A",
    credentialAuthorityId: input.credentialAuthorityId ?? "secret-authority-a",
    staleAfterSeconds: input.staleAfterSeconds ?? 3_600,
  });
  await service.refresh(authority, "provider-a", {
    refreshId: "refresh-1",
    idempotencyKey: "refresh-provider-a-1",
  });
  return { repository, service, source, authority };
}

export async function enableModel(
  fixture: Awaited<ReturnType<typeof createAiCatalogFixture>>,
  modelId = "model-a",
  input: Readonly<{
    included?: boolean;
    visibility?: "public" | "customer" | "platform";
    profiles?: readonly ("website" | "publication")[];
  }> = {},
): Promise<void> {
  await fixture.service.controlModel(fixture.authority, "provider-a", modelId, {
    enabled: true,
    included: input.included ?? false,
    visibility: input.visibility ?? "customer",
    allowedProfiles: input.profiles ?? ["website"],
    expectedVersion: 1,
  });
  const provider = (await fixture.repository.snapshot()).providers[0]!;
  if (!provider.enabled) {
    await fixture.service.controlProvider(fixture.authority, "provider-a", {
      enabled: true,
      expectedVersion: provider.version,
    });
  }
}
