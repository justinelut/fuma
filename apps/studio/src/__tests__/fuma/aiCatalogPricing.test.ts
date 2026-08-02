import { describe, expect, it } from "bun:test";
import {
  AiCatalogCapabilitiesSchema,
  AiCatalogQuoteRequestSchema,
  parseAiCatalogContract,
} from "../../../server/fuma/aiCatalog";
import {
  createAiCatalogFixture,
  customerAudience,
  enableModel,
} from "./aiCatalogTestFixture";

describe("FUMA-063 strict catalog contracts and exact pricing", () => {
  it("rejects unknown fields at strict TypeBox boundaries", () => {
    expect(() =>
      parseAiCatalogContract(
        AiCatalogCapabilitiesSchema,
        {
          toolCalling: true,
          visionInput: false,
          toolResultImages: false,
          promptCache: true,
          streaming: true,
          jsonOutput: true,
          undeclared: true,
        },
        "test.capabilities",
      ),
    ).toThrow("test.capabilities");
    expect(() =>
      parseAiCatalogContract(
        AiCatalogQuoteRequestSchema,
        {
          providerId: "provider-a",
          modelId: "model-a",
          inputTokens: 1,
          outputTokens: 1,
          currency: "USD",
        },
        "test.quote",
      ),
    ).toThrow("test.quote");
  });

  it("preserves explicit capabilities and context through the customer projection", async () => {
    const fixture = await createAiCatalogFixture({
      models: [
        {
          modelId: "model-a",
          contextWindowTokens: 987_654,
          capabilities: {
            toolCalling: false,
            visionInput: true,
            toolResultImages: true,
            promptCache: false,
            streaming: true,
            jsonOutput: false,
          },
        },
      ],
    });
    await enableModel(fixture);
    const model = (await fixture.service.customerProjection(customerAudience))
      .providers[0]!.models[0]!;
    expect(model.contextWindowTokens).toBe(987_654);
    expect(model.capabilities).toEqual({
      toolCalling: false,
      visionInput: true,
      toolResultImages: true,
      promptCache: false,
      streaming: true,
      jsonOutput: false,
    });
  });

  it("prices provider cost and markup in exact integer micros with ceiling rules", async () => {
    const fixture = await createAiCatalogFixture({
      models: [
        {
          modelId: "model-a",
          inputMicrosPerMillion: 1,
          outputMicrosPerMillion: 0,
          markupBasisPoints: 2_500,
        },
      ],
    });
    await enableModel(fixture);
    const quote = await fixture.service.quote(customerAudience, {
      providerId: "provider-a",
      modelId: "model-a",
      inputTokens: 1,
      outputTokens: 0,
    });
    expect(quote).toMatchObject({
      providerCostMicros: 1,
      markupMicros: 1,
      chargeMicros: 2,
      included: false,
    });
  });

  it("computes the canonical one-million-token paid quote without floating point", async () => {
    const fixture = await createAiCatalogFixture({
      models: [
        {
          modelId: "model-a",
          inputMicrosPerMillion: 1_000_000,
          outputMicrosPerMillion: 2_000_000,
          markupBasisPoints: 2_500,
        },
      ],
    });
    await enableModel(fixture);
    expect(
      await fixture.service.quote(customerAudience, {
        providerId: "provider-a",
        modelId: "model-a",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toMatchObject({
      providerCostMicros: 3_000_000,
      markupMicros: 750_000,
      chargeMicros: 3_750_000,
    });
  });

  it("retains provider cost evidence but charges zero for included models", async () => {
    const fixture = await createAiCatalogFixture({
      models: [{ modelId: "model-a" }],
    });
    await enableModel(fixture, "model-a", { included: true });
    expect(
      await fixture.service.quote(customerAudience, {
        providerId: "provider-a",
        modelId: "model-a",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toMatchObject({
      providerCostMicros: 1_000_000,
      markupMicros: 250_000,
      chargeMicros: 0,
      included: true,
    });
  });

  it("fails closed rather than losing precision outside the safe money range", async () => {
    const fixture = await createAiCatalogFixture({
      models: [
        {
          modelId: "model-a",
          inputMicrosPerMillion: Number.MAX_SAFE_INTEGER,
          outputMicrosPerMillion: 0,
          markupBasisPoints: 0,
        },
      ],
    });
    await enableModel(fixture);
    await expect(
      fixture.service.quote(customerAudience, {
        providerId: "provider-a",
        modelId: "model-a",
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
      }),
    ).rejects.toMatchObject({ code: "money-overflow" });
  });
});
