import { describe, expect, it } from "bun:test";
import {
  aiCatalogAuthority,
  createAiCatalogFixture,
  customerAudience,
  enableModel,
  publicAudience,
} from "./aiCatalogTestFixture";

describe("FUMA-063 catalog security and visibility", () => {
  it("requires non-impersonated protected platform settings authority for administration", async () => {
    const fixture = await createAiCatalogFixture();
    const customerAdmin = aiCatalogAuthority({
      allow: ["site.settings.write"],
    });
    await expect(
      fixture.service.controlProvider(customerAdmin, "provider-a", {
        enabled: false,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      fixture.service.adminProjection(customerAdmin),
    ).rejects.toMatchObject({ code: "unauthorized" });
    const impersonated = aiCatalogAuthority({ impersonator: "support-user" });
    await expect(
      fixture.service.controlProvider(impersonated, "provider-a", {
        enabled: false,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("enforces public, customer, and platform model visibility exactly", async () => {
    const fixture = await createAiCatalogFixture({
      models: [
        { modelId: "public-model" },
        { modelId: "customer-model" },
        { modelId: "platform-model" },
      ],
    });
    await enableModel(fixture, "public-model", { visibility: "public" });
    await enableModel(fixture, "customer-model", { visibility: "customer" });
    await enableModel(fixture, "platform-model", { visibility: "platform" });
    const ids = async (audience: unknown) =>
      (await fixture.service.customerProjection(audience)).providers.flatMap(
        (provider) => provider.models.map((model) => model.modelId),
      );
    await expect(ids(publicAudience)).resolves.toEqual(["public-model"]);
    await expect(ids(customerAudience)).resolves.toEqual([
      "customer-model",
      "public-model",
    ]);
    await expect(
      ids({ ...customerAudience, kind: "platform-admin" }),
    ).rejects.toMatchObject({ code: "not-visible" });
    expect(
      (
        await fixture.service.adminProjection(fixture.authority)
      ).providers[0]!.models.map((model) => model.modelId),
    ).toEqual(["customer-model", "platform-model", "public-model"]);
  });

  it("never projects credential authority or secret-shaped fields, including to platform admins", async () => {
    const fixture = await createAiCatalogFixture({
      credentialAuthorityId: "secrets/platform/provider-a/key-7",
    });
    await enableModel(fixture, "model-a", { visibility: "public" });
    const serialized = JSON.stringify({
      public: await fixture.service.customerProjection(publicAudience),
      customer: await fixture.service.customerProjection(customerAudience),
      admin: await fixture.service.adminProjection(fixture.authority),
    });
    expect(serialized).not.toContain("secrets/platform/provider-a/key-7");
    expect(serialized).not.toMatch(
      /credentialAuthorityId|ciphertext|apiKey|secretKey/i,
    );
    expect(JSON.parse(serialized).admin.providers[0].credentialConfigured).toBe(
      true,
    );
  });

  it("denies platform and ancestry substitution without leaking catalog existence", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture);
    await expect(
      fixture.service.customerProjection({
        ...customerAudience,
        platformId: "other-platform",
      }),
    ).rejects.toMatchObject({ code: "not-visible" });
    await expect(
      fixture.service.customerProjection({
        ...customerAudience,
        organizationId: null,
        workspaceId: "workspace-a",
      }),
    ).rejects.toMatchObject({ code: "not-visible" });
    await expect(
      fixture.service.customerProjection({
        ...customerAudience,
        kind: "customer",
        siteId: null,
      }),
    ).rejects.toMatchObject({ code: "not-visible" });
  });

  it("rejects malformed default scopes and platform-only defaults", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture, "model-a", { visibility: "platform" });
    await expect(
      fixture.service.setDefault(fixture.authority, {
        profile: "website",
        target: { kind: "platform", scopeId: "caller-platform" },
        selection: { providerId: "provider-a", modelId: "model-a" },
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      fixture.service.setDefault(fixture.authority, {
        profile: "website",
        target: { kind: "site", scopeId: null },
        selection: { providerId: "provider-a", modelId: "model-a" },
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      fixture.service.setDefault(fixture.authority, {
        profile: "website",
        target: { kind: "platform", scopeId: null },
        selection: { providerId: "provider-a", modelId: "model-a" },
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: "disabled" });
  });

  it("uses the same visibility gate for quoting as for listing", async () => {
    const fixture = await createAiCatalogFixture();
    await enableModel(fixture, "model-a", { visibility: "customer" });
    await expect(
      fixture.service.quote(publicAudience, {
        providerId: "provider-a",
        modelId: "model-a",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "not-visible" });
    await expect(
      fixture.service.quote(customerAudience, {
        providerId: "provider-a",
        modelId: "missing",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "not-visible" });
  });
});
