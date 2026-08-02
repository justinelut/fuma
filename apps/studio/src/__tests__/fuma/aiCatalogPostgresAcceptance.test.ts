import { describe, expect, it } from "bun:test";
import { createPostgresClient } from "../../../server/db/postgres";
import {
  AiCatalogService,
  PostgresAiCatalogRepository,
} from "../../../server/fuma/aiCatalog";
import { aiCatalogAuthorityMigration } from "../../../server/fuma/db/migrations/000063_ai_catalog_authority";
import {
  aiCatalogAuthority,
  customerAudience,
  defaultCapabilities,
} from "./aiCatalogTestFixture";

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL;
const NOW = new Date("2026-07-28T10:00:00.000Z");

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error("Unsafe PostgreSQL schema identifier.");
  return `"${value}"`;
}
function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return url.toString();
}

describe("FUMA-063 optional live PostgreSQL acceptance", () => {
  it.skipIf(postgresUrl === undefined)(
    "persists controls, exact pricing, idempotent refresh, and immutable history",
    async () => {
      if (!postgresUrl) throw new Error("FUMA_TEST_POSTGRES_URL is required.");
      const admin = createPostgresClient(postgresUrl);
      const schema = `fuma_ai_catalog_${process.pid}_${Date.now()}`;
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`);
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema));
      try {
        await db.unsafe(aiCatalogAuthorityMigration.sql);
        let sequence = 1;
        const service = new AiCatalogService({
          repository: new PostgresAiCatalogRepository(db),
          sources: {
            exact: () => ({
              snapshot: async () => ({
                sourceSequence: sequence,
                sourceObservedAt: "2026-07-28T09:59:00.000Z",
                models: [
                  {
                    modelId: "model-a",
                    displayName: "Model A",
                    capabilities: defaultCapabilities,
                    contextWindowTokens: 128_000,
                    inputMicrosPerMillion: 1_000_000,
                    outputMicrosPerMillion: 2_000_000,
                    markupBasisPoints: 2_500,
                  },
                ],
              }),
            }),
          },
          platformId: "fuma",
          now: () => NOW,
        });
        const authority = aiCatalogAuthority();
        await service.createProvider(authority, {
          providerId: "provider-a",
          displayName: "Provider A",
          credentialAuthorityId: "secret-authority-a",
          staleAfterSeconds: 3_600,
        });
        await service.refresh(authority, "provider-a", {
          refreshId: "refresh-1",
          idempotencyKey: "refresh-provider-a-1",
        });
        await service.controlModel(authority, "provider-a", "model-a", {
          enabled: true,
          visibility: "customer",
          allowedProfiles: ["website"],
          expectedVersion: 1,
        });
        await service.controlProvider(authority, "provider-a", {
          enabled: true,
          expectedVersion: 2,
        });
        expect(
          await service.quote(customerAudience, {
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

        sequence = 2;
        const replayed = await Promise.all(
          Array.from({ length: 6 }, () =>
            service.refresh(authority, "provider-a", {
              refreshId: "refresh-2",
              idempotencyKey: "refresh-provider-a-2",
            }),
          ),
        );
        expect(new Set(replayed.map(({ refreshId }) => refreshId))).toEqual(
          new Set(["refresh-2"]),
        );
        const adminView = await service.adminProjection(authority);
        expect(adminView.refreshes).toHaveLength(2);
        expect(JSON.stringify(adminView)).not.toContain("secret-authority-a");
        await expect(
          db.unsafe(
            "update fuma_ai_catalog_refreshes_v2 set actor_id='tampered' where refresh_id='refresh-1'",
          ),
        ).rejects.toThrow("append-only");
      } finally {
        await admin.unsafe(
          `drop schema if exists ${quotedIdentifier(schema)} cascade`,
        );
      }
    },
    30_000,
  );
});
