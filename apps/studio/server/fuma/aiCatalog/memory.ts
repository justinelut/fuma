import type {
  AiCatalogDefault,
  AiCatalogModelControl,
  AiCatalogProvider,
  AiCatalogRefreshRecord,
  AiCatalogScopeTarget,
} from "./contracts";
import {
  AiCatalogRepositoryError,
  type AiCatalogRefreshCommit,
  type AiCatalogRepository,
  type AiCatalogRepositorySnapshot,
} from "./repository";

function clone<T>(value: T): T {
  return structuredClone(value);
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function modelKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}
function defaultKey(
  profile: AiCatalogDefault["profile"],
  target: AiCatalogScopeTarget,
): string {
  return `${profile}\u0000${target.kind}\u0000${target.scopeId ?? ""}`;
}

export class MemoryAiCatalogRepository implements AiCatalogRepository {
  readonly providers = new Map<string, AiCatalogProvider>();
  readonly controls = new Map<string, AiCatalogModelControl>();
  readonly versions = new Map<
    string,
    AiCatalogRefreshCommit["versions"][number]
  >();
  readonly refreshes = new Map<string, AiCatalogRefreshRecord>();
  readonly defaults = new Map<string, AiCatalogDefault>();

  async snapshot(): Promise<AiCatalogRepositorySnapshot> {
    return Object.freeze({
      providers: Object.freeze([...this.providers.values()].map(clone)),
      controls: Object.freeze([...this.controls.values()].map(clone)),
      versions: Object.freeze([...this.versions.values()].map(clone)),
      refreshes: Object.freeze([...this.refreshes.values()].map(clone)),
      defaults: Object.freeze([...this.defaults.values()].map(clone)),
    });
  }

  async createProvider(
    provider: AiCatalogProvider,
  ): Promise<AiCatalogProvider> {
    const prior = this.providers.get(provider.providerId);
    if (prior) {
      if (!same(prior, provider))
        throw new AiCatalogRepositoryError(
          "duplicate-mismatch",
          "Provider identity already exists with different evidence.",
        );
      return clone(prior);
    }
    this.providers.set(provider.providerId, clone(provider));
    return clone(provider);
  }

  async updateProvider(
    provider: AiCatalogProvider,
    expectedVersion: number,
  ): Promise<AiCatalogProvider> {
    const prior = this.providers.get(provider.providerId);
    if (!prior)
      throw new AiCatalogRepositoryError(
        "not-found",
        "Provider does not exist.",
      );
    if (prior.version !== expectedVersion)
      throw new AiCatalogRepositoryError(
        "conflict",
        "Provider version changed concurrently.",
      );
    this.providers.set(provider.providerId, clone(provider));
    return clone(provider);
  }

  async updateModelControl(
    control: AiCatalogModelControl,
    expectedVersion: number,
  ): Promise<AiCatalogModelControl> {
    const key = modelKey(control.providerId, control.modelId);
    const prior = this.controls.get(key);
    if (!prior)
      throw new AiCatalogRepositoryError(
        "not-found",
        "Model control does not exist.",
      );
    if (prior.version !== expectedVersion)
      throw new AiCatalogRepositoryError(
        "conflict",
        "Model control version changed concurrently.",
      );
    this.controls.set(key, clone(control));
    return clone(control);
  }

  async putDefault(
    value: AiCatalogDefault,
    expectedVersion: number | null,
  ): Promise<AiCatalogDefault> {
    const key = defaultKey(value.profile, value.target);
    const prior = this.defaults.get(key);
    if (
      expectedVersion === null
        ? prior !== undefined
        : prior?.version !== expectedVersion
    ) {
      throw new AiCatalogRepositoryError(
        "conflict",
        "Default selection version changed concurrently.",
      );
    }
    this.defaults.set(key, clone(value));
    return clone(value);
  }

  async clearDefault(
    profile: AiCatalogDefault["profile"],
    target: AiCatalogScopeTarget,
    expectedVersion: number,
  ): Promise<void> {
    const key = defaultKey(profile, target);
    const prior = this.defaults.get(key);
    if (!prior)
      throw new AiCatalogRepositoryError(
        "not-found",
        "Default selection does not exist.",
      );
    if (prior.version !== expectedVersion)
      throw new AiCatalogRepositoryError(
        "conflict",
        "Default selection version changed concurrently.",
      );
    this.defaults.delete(key);
  }

  async commitRefresh(
    input: AiCatalogRefreshCommit,
  ): Promise<AiCatalogRefreshRecord> {
    const provider = this.providers.get(input.record.providerId);
    if (!provider)
      throw new AiCatalogRepositoryError(
        "not-found",
        "Provider does not exist.",
      );
    const duplicate = [...this.refreshes.values()].find(
      (value) =>
        value.refreshId === input.record.refreshId ||
        (value.providerId === input.record.providerId &&
          value.idempotencyKey === input.record.idempotencyKey),
    );
    if (duplicate) {
      const comparable =
        duplicate.state === "failed"
          ? null
          : { ...duplicate, state: "applied" };
      if (!comparable || !same(comparable, input.record))
        throw new AiCatalogRepositoryError(
          "duplicate-mismatch",
          "Refresh identity was reused with different evidence.",
        );
      return clone(duplicate);
    }
    const current = provider.currentRefreshId
      ? this.refreshes.get(provider.currentRefreshId)
      : null;
    const currentSequence = current?.sourceSequence ?? 0;
    const stale = input.record.sourceSequence <= currentSequence;
    const record: AiCatalogRefreshRecord = stale
      ? Object.freeze({ ...input.record, state: "rejected-stale" as const })
      : input.record;
    this.refreshes.set(record.refreshId, clone(record));
    if (!stale) {
      for (const version of input.versions)
        this.versions.set(
          `${modelKey(version.providerId, version.modelId)}\u0000${version.refreshId}`,
          clone(version),
        );
      for (const control of input.initialControls) {
        const key = modelKey(control.providerId, control.modelId);
        if (!this.controls.has(key)) this.controls.set(key, clone(control));
      }
      this.providers.set(
        provider.providerId,
        Object.freeze({
          ...provider,
          currentRefreshId: record.refreshId,
          version: provider.version + 1,
          updatedAt: record.completedAt,
        }),
      );
    }
    return clone(record);
  }

  async recordRefreshFailure(
    record: Extract<AiCatalogRefreshRecord, { state: "failed" }>,
  ): Promise<AiCatalogRefreshRecord> {
    const duplicate = [...this.refreshes.values()].find(
      (value) =>
        value.refreshId === record.refreshId ||
        (value.providerId === record.providerId &&
          value.idempotencyKey === record.idempotencyKey),
    );
    if (duplicate) {
      if (!same(duplicate, record))
        throw new AiCatalogRepositoryError(
          "duplicate-mismatch",
          "Failed refresh identity was reused with different evidence.",
        );
      return clone(duplicate);
    }
    if (!this.providers.has(record.providerId))
      throw new AiCatalogRepositoryError(
        "not-found",
        "Provider does not exist.",
      );
    this.refreshes.set(record.refreshId, clone(record));
    return clone(record);
  }
}
