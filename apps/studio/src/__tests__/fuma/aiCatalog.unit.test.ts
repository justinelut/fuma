import { describe, expect, it } from "bun:test";
import {
  AiCatalogRepositoryError,
  MemoryAiCatalogRepository,
  parseAiCatalogContract,
  AiCatalogRefreshRecordSchema,
} from "../../../server/fuma/aiCatalog";

const at = "2026-07-28T10:00:00.000Z";
const provider = {
  providerId: "provider-a",
  displayName: "Provider A",
  enabled: false,
  credentialAuthorityId: null,
  staleAfterSeconds: 3_600,
  currentRefreshId: null,
  version: 1,
  createdAt: at,
  updatedAt: at,
} as const;

describe("FUMA-063 memory catalog repository unit", () => {
  it("makes provider creation idempotent but rejects identity reuse with changed evidence", async () => {
    const repository = new MemoryAiCatalogRepository();
    expect(await repository.createProvider(provider)).toEqual(provider);
    expect(await repository.createProvider(provider)).toEqual(provider);
    await expect(
      repository.createProvider({ ...provider, displayName: "Changed" }),
    ).rejects.toBeInstanceOf(AiCatalogRepositoryError);
  });

  it("commits refresh versions and initial disabled controls atomically", async () => {
    const repository = new MemoryAiCatalogRepository();
    await repository.createProvider(provider);
    const record = {
      refreshId: "refresh-1",
      providerId: "provider-a",
      idempotencyKey: "key-1",
      sourceSequence: 1,
      sourceObservedAt: at,
      catalogHashSha256: "a".repeat(64),
      state: "applied" as const,
      modelCount: 1,
      errorCode: null,
      actorId: "actor-a",
      completedAt: at,
    };
    await repository.commitRefresh({
      record,
      versions: [
        {
          providerId: "provider-a",
          modelId: "model-a",
          refreshId: "refresh-1",
          displayName: "Model A",
          capabilities: {
            toolCalling: true,
            visionInput: false,
            toolResultImages: false,
            promptCache: false,
            streaming: true,
            jsonOutput: true,
          },
          contextWindowTokens: 10_000,
          inputMicrosPerMillion: 1,
          outputMicrosPerMillion: 2,
          markupBasisPoints: 0,
          sourceObservedAt: at,
        },
      ],
      initialControls: [
        {
          providerId: "provider-a",
          modelId: "model-a",
          enabled: false,
          included: false,
          visibility: "platform",
          allowedProfiles: ["website"],
          version: 1,
          updatedAt: at,
        },
      ],
    });
    const snapshot = await repository.snapshot();
    expect(snapshot.providers[0]).toMatchObject({
      currentRefreshId: "refresh-1",
      version: 2,
    });
    expect(snapshot.versions).toHaveLength(1);
    expect(snapshot.controls).toEqual([
      expect.objectContaining({ enabled: false, visibility: "platform" }),
    ]);
  });

  it("rejects stale optimistic versions for providers, models, and defaults", async () => {
    const repository = new MemoryAiCatalogRepository();
    await repository.createProvider(provider);
    await expect(
      repository.updateProvider(
        { ...provider, displayName: "Changed", version: 2 },
        2,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repository.updateModelControl(
        {
          providerId: "provider-a",
          modelId: "missing",
          enabled: false,
          included: false,
          visibility: "platform",
          allowedProfiles: ["website"],
          version: 2,
          updatedAt: at,
        },
        1,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      repository.clearDefault(
        "website",
        { kind: "platform", scopeId: null },
        1,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("enforces discriminated refresh evidence shapes at the contract boundary", () => {
    expect(() =>
      parseAiCatalogContract(
        AiCatalogRefreshRecordSchema,
        {
          refreshId: "refresh-bad",
          providerId: "provider-a",
          idempotencyKey: "key-bad",
          sourceSequence: null,
          sourceObservedAt: null,
          catalogHashSha256: null,
          state: "failed",
          modelCount: 1,
          errorCode: null,
          actorId: "actor-a",
          completedAt: at,
        },
        "test.refresh",
      ),
    ).toThrow("test.refresh");
  });
});
