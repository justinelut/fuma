import { describe, expect, it } from "bun:test";
import { runAiCatalogDemo } from "../../../server/fuma/aiCatalog";

describe("FUMA-063 deterministic catalog demo", () => {
  it("enables one paid model, disables another, and emits secret-free evidence without deployment", async () => {
    const evidence = await runAiCatalogDemo();
    expect(evidence).toEqual({
      enabledModelIds: ["paid-model"],
      disabledModelIds: ["disabled-model"],
      defaultModelId: "paid-model",
      paidChargeMicros: 3_750_000,
      refreshStates: ["applied"],
      secretFree: true,
    });
    process.stdout.write(
      `[FUMA-063 demo] enabled=${evidence.enabledModelIds.join(",")} disabled=${evidence.disabledModelIds.join(",")} paidMicros=${evidence.paidChargeMicros} secretFree=${evidence.secretFree}\n`,
    );
  });
});
