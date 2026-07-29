import { describe, expect, it } from "bun:test";
import { AiCatalogService } from "../../../server/fuma/aiCatalog";
import {
  createAiCatalogFixture,
  customerAudience,
  enableModel,
} from "./aiCatalogTestFixture";

describe("FUMA-063 catalog fault handling", () => {
  it("fails closed when an enabled provider becomes stale", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture);
    const later = new AiCatalogService({
      repository: fixture.repository,
      sources: { exact: () => null },
      platformId: "fuma",
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    await expect(
      later.customerProjection(customerAudience),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      later.quote(customerAudience, {
        providerId: "provider-a",
        modelId: "model-a",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("records an out-of-order refresh as rejected-stale and retains the current catalog", async () => {
    const fixture = await createAiCatalogFixture({ sourceSequence: 2 });
    fixture.source.value = {
      sourceSequence: 1,
      sourceObservedAt: "2026-07-28T09:59:30.000Z",
      models: [],
    };
    expect(
      await fixture.service.refresh(fixture.authority, "provider-a", {
        refreshId: "refresh-old",
        idempotencyKey: "refresh-provider-a-old",
      }),
    ).toMatchObject({ state: "rejected-stale", sourceSequence: 1 });
    const snapshot = await fixture.repository.snapshot();
    expect(snapshot.providers[0]!.currentRefreshId).toBe("refresh-1");
    expect(snapshot.refreshes.map(({ state }) => state)).toEqual([
      "applied",
      "rejected-stale",
    ]);
  });

  it("records a redacted failed refresh and never persists provider error text", async () => {
    const fixture = await createAiCatalogFixture();
    fixture.source.error = new Error(
      "upstream failed with sk_live_do_not_store",
    );
    expect(
      await fixture.service.refresh(fixture.authority, "provider-a", {
        refreshId: "refresh-failed",
        idempotencyKey: "refresh-provider-a-failed",
      }),
    ).toMatchObject({ state: "failed", errorCode: "source-unavailable" });
    expect(JSON.stringify(await fixture.repository.snapshot())).not.toContain(
      "sk_live_do_not_store",
    );
  });

  it("makes refresh replay idempotent without calling discovery twice", async () => {
    const fixture = await createAiCatalogFixture();
    const before = fixture.source.calls;
    const replay = await fixture.service.refresh(
      fixture.authority,
      "provider-a",
      {
        refreshId: "refresh-1",
        idempotencyKey: "refresh-provider-a-1",
      },
    );
    expect(replay.state).toBe("applied");
    expect(fixture.source.calls).toBe(before);
    await expect(
      fixture.service.refresh(fixture.authority, "provider-a", {
        refreshId: "refresh-1",
        idempotencyKey: "changed-key",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects duplicate model identities as a failed snapshot with no partial versions", async () => {
    const fixture = await createAiCatalogFixture();
    const model = {
      modelId: "duplicate",
      displayName: "Duplicate",
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
      outputMicrosPerMillion: 1,
      markupBasisPoints: 0,
    };
    fixture.source.value = {
      sourceSequence: 2,
      sourceObservedAt: "2026-07-28T09:59:30.000Z",
      models: [model, model],
    };
    expect(
      await fixture.service.refresh(fixture.authority, "provider-a", {
        refreshId: "refresh-duplicates",
        idempotencyKey: "refresh-provider-a-duplicates",
      }),
    ).toMatchObject({ state: "failed", errorCode: "invalid-snapshot" });
    const snapshot = await fixture.repository.snapshot();
    expect(
      snapshot.versions.filter(
        ({ refreshId }) => refreshId === "refresh-duplicates",
      ),
    ).toHaveLength(0);
    expect(snapshot.providers[0]!.currentRefreshId).toBe("refresh-1");
  });

  it("allows only one concurrent version-fenced model control update", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture);
    const results = await Promise.allSettled([
      fixture.service.controlModel(fixture.authority, "provider-a", "model-a", {
        included: true,
        expectedVersion: 2,
      }),
      fixture.service.controlModel(fixture.authority, "provider-a", "model-a", {
        visibility: "public",
        expectedVersion: 2,
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });

  it("validates repository data on every read and fails closed on corruption", async () => {
    const fixture = await createAiCatalogFixture();
    const current = fixture.repository.controls.get("provider-a\u0000model-a")!;
    fixture.repository.controls.set("provider-a\u0000model-a", {
      ...current,
      visibility: "leaked" as typeof current.visibility,
    });
    await expect(
      fixture.service.adminProjection(fixture.authority),
    ).rejects.toThrow("aiCatalog.repository.control");
  });
});
