import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assertHostedMigrationIsAdditive } from "../../../server/fuma/db/migrationPolicy";
import { aiCatalogAuthorityMigration } from "../../../server/fuma/db/migrations/000063_ai_catalog_authority";

const ROOT = join(import.meta.dir, "../../..");
const DIRECTORY = join(ROOT, "server/fuma/aiCatalog");
const source = (file: string) => readFileSync(join(DIRECTORY, file), "utf8");
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith(".ts"));
const all = files.map(source).join("\n");

describe("FUMA-063 AI catalog architecture", () => {
  it("uses strict TypeBox contracts without Zod, app imports, shared UI, or provider transports", () => {
    const contracts = source("contracts.ts");
    expect(contracts).toMatch(
      /from ["']@core\/utils\/typeboxHelpers["'];/,
    );
    expect(
      contracts.match(/additionalProperties: false/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(20);
    expect(all).not.toMatch(/\b(?:zod|z\.object)\b/i);
    expect(all).not.toMatch(/from ['"](?:\.\.\/)+\.\.\/apps\//);
    expect(all).not.toMatch(/@ui\/|shared-ui|components\/ui/);
    expect(all).not.toMatch(
      /\bfetch\s*\(|@anthropic|openai\/|openrouter\.ai|ollama/i,
    );
  });

  it("extends existing native AI policy without introducing a second runtime", () => {
    const nativeRuntime = readFileSync(
      join(ROOT, "server/ai/runtime/runner.ts"),
      "utf8",
    );
    const nativeDrivers = readFileSync(
      join(ROOT, "server/ai/drivers/types.ts"),
      "utf8",
    );
    expect(nativeRuntime).toContain("export async function runChat");
    expect(nativeDrivers).toContain("export interface AiProvider");
    expect(all).not.toMatch(
      /class\s+AiRunner|interface\s+AiProvider\s*\{|stream\s*\(req|chat completion|conversation store/i,
    );
    expect(all).not.toMatch(
      /AiCredit|Byok|McpConnector|SiteAiInvocation|ownerGeneration/i,
    );
  });

  it("has explicit repository, memory, PostgreSQL, platform-admin service, and deterministic demo seams", () => {
    expect(source("repository.ts")).toContain(
      "export interface AiCatalogRepository",
    );
    expect(source("memory.ts")).toContain("class MemoryAiCatalogRepository");
    expect(source("postgres.ts")).toContain(
      "class PostgresAiCatalogRepository",
    );
    expect(source("service.ts")).toContain("class AiCatalogService");
    expect(source("service.ts")).toMatch(
      /const WRITE_PERMISSION = ["']platform\.settings\.write["'];/,
    );
    expect(source("service.ts")).toContain("credentialConfigured");
    expect(source("demo.ts")).toContain("runAiCatalogDemo");
  });

  it("keeps credential authority internal and projections structurally secret-free", () => {
    const contracts = source("contracts.ts");
    const customerProjection = contracts.slice(
      contracts.indexOf("AiCatalogModelProjectionSchema"),
      contracts.indexOf("AiCatalogCurrentModelSchema"),
    );
    expect(customerProjection).not.toMatch(
      /credentialAuthorityId|ciphertext|apiKey|secret/i,
    );
    expect(all).not.toMatch(
      /console\.(?:log|error|warn)\([^)]*(?:credential|secret|snapshot)/i,
    );
  });

  it("ships a conductor-finalized additive migration with central registration", () => {
    expect(() =>
      assertHostedMigrationIsAdditive(aiCatalogAuthorityMigration),
    ).not.toThrow();
    const migration = readFileSync(
      join(ROOT, "server/fuma/db/migrations/000063_ai_catalog_authority.ts"),
      "utf8",
    );
    const index = readFileSync(
      join(ROOT, "server/fuma/db/migrations/index.ts"),
      "utf8",
    );
    expect(aiCatalogAuthorityMigration.id).toBe("000063_ai_catalog_authority");
    expect(migration).toContain("fuma_ai_catalog_refresh_history_immutable_v2");
    expect(migration).toContain(
      "state in ('applied','rejected-stale','failed')",
    );
    expect(index).toContain("000063_ai_catalog_authority");
    expect(index).toContain("aiCatalogAuthorityMigration");
  });

  it("keeps every production source under the repository ceiling", () => {
    for (const file of files) {
      expect(source(file).split("\n").length - 1, file).toBeLessThanOrEqual(
        700,
      );
    }
  });
});
