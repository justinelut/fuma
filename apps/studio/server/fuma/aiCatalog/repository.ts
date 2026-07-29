import type {
  AiCatalogDefault,
  AiCatalogModelControl,
  AiCatalogModelVersion,
  AiCatalogProvider,
  AiCatalogRefreshRecord,
} from "./contracts";

export type AiCatalogRefreshCommit = Readonly<{
  record: Extract<AiCatalogRefreshRecord, { state: "applied" }>;
  versions: readonly AiCatalogModelVersion[];
  initialControls: readonly AiCatalogModelControl[];
}>;

export type AiCatalogRepositorySnapshot = Readonly<{
  providers: readonly AiCatalogProvider[];
  controls: readonly AiCatalogModelControl[];
  versions: readonly AiCatalogModelVersion[];
  refreshes: readonly AiCatalogRefreshRecord[];
  defaults: readonly AiCatalogDefault[];
}>;

export interface AiCatalogRepository {
  snapshot(): Promise<AiCatalogRepositorySnapshot>;
  createProvider(provider: AiCatalogProvider): Promise<AiCatalogProvider>;
  updateProvider(
    provider: AiCatalogProvider,
    expectedVersion: number,
  ): Promise<AiCatalogProvider>;
  updateModelControl(
    control: AiCatalogModelControl,
    expectedVersion: number,
  ): Promise<AiCatalogModelControl>;
  putDefault(
    value: AiCatalogDefault,
    expectedVersion: number | null,
  ): Promise<AiCatalogDefault>;
  clearDefault(
    profile: AiCatalogDefault["profile"],
    target: AiCatalogDefault["target"],
    expectedVersion: number,
  ): Promise<void>;
  commitRefresh(input: AiCatalogRefreshCommit): Promise<AiCatalogRefreshRecord>;
  recordRefreshFailure(
    record: Extract<AiCatalogRefreshRecord, { state: "failed" }>,
  ): Promise<AiCatalogRefreshRecord>;
}

export class AiCatalogRepositoryError extends Error {
  override readonly name = "AiCatalogRepositoryError";
  readonly code: "conflict" | "duplicate-mismatch" | "not-found";

  constructor(
    code: "conflict" | "duplicate-mismatch" | "not-found",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}
