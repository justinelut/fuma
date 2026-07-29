import { describe, expect, it } from "bun:test";
import {
  createAiCatalogFixture,
  customerAudience,
  enableModel,
} from "./aiCatalogTestFixture";

describe("FUMA-063 catalog service integration", () => {
  it("discovers models fail-closed, then enables exactly one without deployment", async () => {
    const fixture = await createAiCatalogFixture();
    const initial = await fixture.service.adminProjection(fixture.authority);
    expect(initial.providers[0]).toMatchObject({
      enabled: false,
      stale: false,
      credentialConfigured: true,
    });
    expect(
      initial.providers[0]!.models.map((model) => [
        model.modelId,
        model.enabled,
      ]),
    ).toEqual([
      ["model-a", false],
      ["model-b", false],
    ]);
    await enableModel(fixture, "model-a");
    const projected =
      await fixture.service.customerProjection(customerAudience);
    expect(
      projected.providers[0]!.models.map(({ modelId }) => modelId),
    ).toEqual(["model-a"]);
  });

  it("resolves exact site/workspace/organization/platform defaults from most specific to least", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture, "model-a");
    await enableModel(fixture, "model-b");
    await fixture.service.setDefault(fixture.authority, {
      profile: "website",
      target: { kind: "platform", scopeId: null },
      selection: { providerId: "provider-a", modelId: "model-a" },
      expectedVersion: null,
    });
    await fixture.service.setDefault(fixture.authority, {
      profile: "website",
      target: { kind: "site", scopeId: "site-a" },
      selection: { providerId: "provider-a", modelId: "model-b" },
      expectedVersion: null,
    });
    expect(
      (await fixture.service.customerProjection(customerAudience)).defaultModel
        ?.modelId,
    ).toBe("model-b");
    expect(
      (
        await fixture.service.customerProjection({
          ...customerAudience,
          siteId: "site-b",
        })
      ).defaultModel?.modelId,
    ).toBe("model-a");
  });

  it("applies a newer refresh atomically, keeps controls, and exposes immutable history", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture, "model-a");
    fixture.source.value = {
      sourceSequence: 2,
      sourceObservedAt: "2026-07-28T09:59:30.000Z",
      models: [
        {
          modelId: "model-a",
          displayName: "Model A v2",
          capabilities: {
            toolCalling: true,
            visionInput: true,
            toolResultImages: true,
            promptCache: false,
            streaming: true,
            jsonOutput: true,
          },
          contextWindowTokens: 256_000,
          inputMicrosPerMillion: 4_000_000,
          outputMicrosPerMillion: 8_000_000,
          markupBasisPoints: 1_000,
        },
      ],
    };
    expect(
      await fixture.service.refresh(fixture.authority, "provider-a", {
        refreshId: "refresh-2",
        idempotencyKey: "refresh-provider-a-2",
      }),
    ).toMatchObject({ state: "applied", sourceSequence: 2 });
    const admin = await fixture.service.adminProjection(fixture.authority);
    expect(
      admin.refreshes.map(({ refreshId, state }) => [refreshId, state]),
    ).toEqual([
      ["refresh-2", "applied"],
      ["refresh-1", "applied"],
    ]);
    expect(admin.providers[0]!.models[0]).toMatchObject({
      displayName: "Model A v2",
      enabled: true,
      contextWindowTokens: 256_000,
    });
    expect(
      (
        await fixture.service.quote(customerAudience, {
          providerId: "provider-a",
          modelId: "model-a",
          inputTokens: 1_000_000,
          outputTokens: 0,
        })
      ).chargeMicros,
    ).toBe(4_400_000);
  });

  it("applies model and provider kill switches immediately", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture);
    expect(
      (await fixture.service.customerProjection(customerAudience)).providers,
    ).toHaveLength(1);
    await fixture.service.controlModel(
      fixture.authority,
      "provider-a",
      "model-a",
      {
        enabled: false,
        expectedVersion: 2,
      },
    );
    expect(
      (await fixture.service.customerProjection(customerAudience)).providers,
    ).toHaveLength(0);
    await fixture.service.controlModel(
      fixture.authority,
      "provider-a",
      "model-a",
      {
        enabled: true,
        expectedVersion: 3,
      },
    );
    const provider = (await fixture.repository.snapshot()).providers[0]!;
    await fixture.service.controlProvider(fixture.authority, "provider-a", {
      enabled: false,
      expectedVersion: provider.version,
    });
    expect(
      (await fixture.service.customerProjection(customerAudience)).providers,
    ).toHaveLength(0);
  });

  it("version-fences provider, model, and default administration", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture);
    await expect(
      fixture.service.controlModel(fixture.authority, "provider-a", "model-a", {
        included: true,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await fixture.service.setDefault(fixture.authority, {
      profile: "website",
      target: { kind: "platform", scopeId: null },
      selection: { providerId: "provider-a", modelId: "model-a" },
      expectedVersion: null,
    });
    await expect(
      fixture.service.setDefault(fixture.authority, {
        profile: "website",
        target: { kind: "platform", scopeId: null },
        selection: { providerId: "provider-a", modelId: "model-a" },
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
