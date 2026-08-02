import type { DbClient } from "../../db/client";
import {
  AiCatalogDefaultSchema,
  AiCatalogModelControlSchema,
  AiCatalogModelVersionSchema,
  AiCatalogProviderSchema,
  AiCatalogRefreshRecordSchema,
  parseAiCatalogContract,
  type AiCatalogDefault,
  type AiCatalogModelControl,
  type AiCatalogModelVersion,
  type AiCatalogProvider,
  type AiCatalogRefreshRecord,
  type AiCatalogScopeTarget,
} from "./contracts";
import {
  AiCatalogRepositoryError,
  type AiCatalogRefreshCommit,
  type AiCatalogRepository,
  type AiCatalogRepositorySnapshot,
} from "./repository";

type ProviderRow = {
  provider_id: string;
  display_name: string;
  enabled: boolean;
  credential_authority_id: string | null;
  stale_after_seconds: number | string;
  current_refresh_id: string | null;
  control_version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};
type ControlRow = {
  provider_id: string;
  model_id: string;
  enabled: boolean;
  included: boolean;
  visibility: string;
  allowed_profiles_json: unknown;
  control_version: number | string;
  updated_at: Date | string;
};
type VersionRow = {
  provider_id: string;
  model_id: string;
  refresh_id: string;
  display_name: string;
  capabilities_json: unknown;
  context_window_tokens: number | string;
  input_micros_per_million: number | string;
  output_micros_per_million: number | string;
  markup_basis_points: number | string;
  source_observed_at: Date | string;
};
type RefreshRow = {
  refresh_id: string;
  provider_id: string;
  idempotency_key: string;
  source_sequence: number | string | null;
  source_observed_at: Date | string | null;
  catalog_hash_sha256: string | null;
  state: string;
  model_count: number | string;
  error_code: string | null;
  actor_id: string;
  completed_at: Date | string;
};
type DefaultRow = {
  profile_id: string;
  target_kind: string;
  target_scope_id: string;
  provider_id: string;
  model_id: string;
  selection_version: number | string;
  updated_at: Date | string;
};

export class PostgresAiCatalogRepository implements AiCatalogRepository {
  readonly #db: DbClient;

  constructor(db: DbClient) {
    if (db.dialect !== "postgres")
      throw new TypeError("Platform AI catalog authority requires PostgreSQL.");
    this.#db = db;
  }

  async snapshot(): Promise<AiCatalogRepositorySnapshot> {
    const [providers, controls, versions, refreshes, defaults] =
      await Promise.all([
        this
          .#db<ProviderRow>`select provider_id, display_name, enabled, credential_authority_id,
        stale_after_seconds, current_refresh_id, control_version, created_at, updated_at
        from fuma_ai_catalog_providers_v2`,
        this
          .#db<ControlRow>`select provider_id, model_id, enabled, included, visibility,
        allowed_profiles_json, control_version, updated_at from fuma_ai_catalog_model_controls_v2`,
        this
          .#db<VersionRow>`select provider_id, model_id, refresh_id, display_name, capabilities_json,
        context_window_tokens, input_micros_per_million, output_micros_per_million,
        markup_basis_points, source_observed_at from fuma_ai_catalog_model_versions_v2`,
        this
          .#db<RefreshRow>`select refresh_id, provider_id, idempotency_key, source_sequence,
        source_observed_at, catalog_hash_sha256, state, model_count, error_code, actor_id, completed_at
        from fuma_ai_catalog_refreshes_v2`,
        this
          .#db<DefaultRow>`select profile_id, target_kind, target_scope_id, provider_id, model_id,
        selection_version, updated_at from fuma_ai_catalog_defaults_v2`,
      ]);
    return Object.freeze({
      providers: Object.freeze(providers.rows.map(providerFrom)),
      controls: Object.freeze(controls.rows.map(controlFrom)),
      versions: Object.freeze(versions.rows.map(versionFrom)),
      refreshes: Object.freeze(refreshes.rows.map(refreshFrom)),
      defaults: Object.freeze(defaults.rows.map(defaultFrom)),
    });
  }

  async createProvider(
    provider: AiCatalogProvider,
  ): Promise<AiCatalogProvider> {
    const value = parseAiCatalogContract(
      AiCatalogProviderSchema,
      provider,
      "aiCatalog.postgres.provider",
    );
    return this.#db.transaction(async (db) => {
      await db`insert into fuma_ai_catalog_providers_v2 (
        provider_id, display_name, enabled, credential_authority_id, stale_after_seconds,
        current_refresh_id, control_version, created_at, updated_at
      ) values (${value.providerId}, ${value.displayName}, ${value.enabled},
        ${value.credentialAuthorityId}, ${value.staleAfterSeconds}, ${value.currentRefreshId},
        ${value.version}, ${value.createdAt}, ${value.updatedAt}) on conflict do nothing`;
      const result = await providerById(db, value.providerId, true);
      if (!result)
        throw new AiCatalogRepositoryError(
          "not-found",
          "Provider insert did not persist.",
        );
      if (!same(result, value))
        throw new AiCatalogRepositoryError(
          "duplicate-mismatch",
          "Provider identity already exists with different evidence.",
        );
      return result;
    });
  }

  async updateProvider(
    provider: AiCatalogProvider,
    expectedVersion: number,
  ): Promise<AiCatalogProvider> {
    const value = parseAiCatalogContract(
      AiCatalogProviderSchema,
      provider,
      "aiCatalog.postgres.providerUpdate",
    );
    const result = await this
      .#db<ProviderRow>`update fuma_ai_catalog_providers_v2 set
      display_name=${value.displayName}, enabled=${value.enabled},
      credential_authority_id=${value.credentialAuthorityId}, stale_after_seconds=${value.staleAfterSeconds},
      current_refresh_id=${value.currentRefreshId}, control_version=${value.version}, updated_at=${value.updatedAt}
      where provider_id=${value.providerId} and control_version=${expectedVersion}
      returning provider_id, display_name, enabled, credential_authority_id, stale_after_seconds,
        current_refresh_id, control_version, created_at, updated_at`;
    if (!result.rows[0])
      throw await conflictOrMissing(
        this.#db,
        "fuma_ai_catalog_providers_v2",
        "provider_id",
        value.providerId,
        "Provider",
      );
    return providerFrom(result.rows[0]);
  }

  async updateModelControl(
    control: AiCatalogModelControl,
    expectedVersion: number,
  ): Promise<AiCatalogModelControl> {
    const value = parseAiCatalogContract(
      AiCatalogModelControlSchema,
      control,
      "aiCatalog.postgres.modelControl",
    );
    const result = await this
      .#db<ControlRow>`update fuma_ai_catalog_model_controls_v2 set
      enabled=${value.enabled}, included=${value.included}, visibility=${value.visibility},
      allowed_profiles_json=${JSON.stringify(value.allowedProfiles)}::text::jsonb, control_version=${value.version},
      updated_at=${value.updatedAt}
      where provider_id=${value.providerId} and model_id=${value.modelId} and control_version=${expectedVersion}
      returning provider_id, model_id, enabled, included, visibility, allowed_profiles_json,
        control_version, updated_at`;
    if (!result.rows[0])
      throw new AiCatalogRepositoryError(
        "conflict",
        "Model control version changed or model is absent.",
      );
    return controlFrom(result.rows[0]);
  }

  async putDefault(
    value: AiCatalogDefault,
    expectedVersion: number | null,
  ): Promise<AiCatalogDefault> {
    const next = parseAiCatalogContract(
      AiCatalogDefaultSchema,
      value,
      "aiCatalog.postgres.default",
    );
    return this.#db.transaction(async (db) => {
      const scopeId = targetScopeId(next.target);
      const prior = await defaultByTarget(
        db,
        next.profile,
        next.target.kind,
        scopeId,
        true,
      );
      if (
        expectedVersion === null
          ? prior !== null
          : prior?.version !== expectedVersion
      ) {
        throw new AiCatalogRepositoryError(
          "conflict",
          "Default selection version changed concurrently.",
        );
      }
      const result = prior
        ? await db<DefaultRow>`update fuma_ai_catalog_defaults_v2 set provider_id=${next.providerId},
            model_id=${next.modelId}, selection_version=${next.version}, updated_at=${next.updatedAt}
            where profile_id=${next.profile} and target_kind=${next.target.kind}
              and target_scope_id=${scopeId} and selection_version=${expectedVersion}
            returning profile_id, target_kind, target_scope_id, provider_id, model_id, selection_version, updated_at`
        : await db<DefaultRow>`insert into fuma_ai_catalog_defaults_v2 (
            profile_id, target_kind, target_scope_id, provider_id, model_id, selection_version, updated_at
          ) values (${next.profile}, ${next.target.kind}, ${scopeId}, ${next.providerId}, ${next.modelId},
            ${next.version}, ${next.updatedAt})
            returning profile_id, target_kind, target_scope_id, provider_id, model_id, selection_version, updated_at`;
      if (!result.rows[0])
        throw new AiCatalogRepositoryError(
          "conflict",
          "Default selection version changed concurrently.",
        );
      return defaultFrom(result.rows[0]);
    });
  }

  async clearDefault(
    profile: AiCatalogDefault["profile"],
    target: AiCatalogScopeTarget,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.#db`delete from fuma_ai_catalog_defaults_v2
      where profile_id=${profile} and target_kind=${target.kind} and target_scope_id=${targetScopeId(target)}
        and selection_version=${expectedVersion}`;
    if (result.rowCount !== 1)
      throw new AiCatalogRepositoryError(
        "conflict",
        "Default selection version changed or selection is absent.",
      );
  }

  async commitRefresh(
    input: AiCatalogRefreshCommit,
  ): Promise<AiCatalogRefreshRecord> {
    return this.#db.transaction(async (db) => {
      await lockRefreshIdentity(
        db,
        input.record.providerId,
        input.record.refreshId,
        input.record.idempotencyKey,
      );
      const duplicateResult =
        await db<RefreshRow>`select refresh_id, provider_id, idempotency_key,
        source_sequence, source_observed_at, catalog_hash_sha256, state, model_count, error_code,
        actor_id, completed_at from fuma_ai_catalog_refreshes_v2
        where refresh_id=${input.record.refreshId}
          or (provider_id=${input.record.providerId} and idempotency_key=${input.record.idempotencyKey})
        for update`;
      if (duplicateResult.rows[0]) {
        const duplicate = refreshFrom(duplicateResult.rows[0]);
        const comparable =
          duplicate.state === "failed"
            ? null
            : { ...duplicate, state: "applied" as const };
        if (!comparable || !same(comparable, input.record)) {
          throw new AiCatalogRepositoryError(
            "duplicate-mismatch",
            "Refresh identity was reused with different evidence.",
          );
        }
        return duplicate;
      }
      const provider = await providerById(db, input.record.providerId, true);
      if (!provider)
        throw new AiCatalogRepositoryError(
          "not-found",
          "Provider does not exist.",
        );
      let currentSequence = 0;
      if (provider.currentRefreshId) {
        const current = await refreshById(db, provider.currentRefreshId);
        currentSequence = current?.sourceSequence ?? 0;
      }
      const stale = input.record.sourceSequence <= currentSequence;
      const record: AiCatalogRefreshRecord = stale
        ? { ...input.record, state: "rejected-stale" }
        : input.record;
      await insertRefresh(db, record);
      if (stale) return record;
      for (const version of input.versions) await insertVersion(db, version);
      for (const control of input.initialControls)
        await insertInitialControl(db, control);
      await db`update fuma_ai_catalog_providers_v2 set current_refresh_id=${record.refreshId},
        control_version=control_version+1, updated_at=${record.completedAt}
        where provider_id=${record.providerId}`;
      return record;
    });
  }

  async recordRefreshFailure(
    record: Extract<AiCatalogRefreshRecord, { state: "failed" }>,
  ): Promise<AiCatalogRefreshRecord> {
    return this.#db.transaction(async (db) => {
      await lockRefreshIdentity(
        db,
        record.providerId,
        record.refreshId,
        record.idempotencyKey,
      );
      const duplicate =
        await db<RefreshRow>`select refresh_id, provider_id, idempotency_key,
        source_sequence, source_observed_at, catalog_hash_sha256, state, model_count, error_code,
        actor_id, completed_at from fuma_ai_catalog_refreshes_v2
        where refresh_id=${record.refreshId}
          or (provider_id=${record.providerId} and idempotency_key=${record.idempotencyKey}) for update`;
      if (duplicate.rows[0]) {
        const value = refreshFrom(duplicate.rows[0]);
        if (!same(value, record))
          throw new AiCatalogRepositoryError(
            "duplicate-mismatch",
            "Failed refresh identity was reused with different evidence.",
          );
        return value;
      }
      if (!(await providerById(db, record.providerId, true)))
        throw new AiCatalogRepositoryError(
          "not-found",
          "Provider does not exist.",
        );
      await insertRefresh(db, record);
      return record;
    });
  }
}

async function lockRefreshIdentity(
  db: DbClient,
  providerId: string,
  refreshId: string,
  idempotencyKey: string,
): Promise<void> {
  const identities = [
    `fuma-ai-catalog-refresh-id:${refreshId}`,
    `fuma-ai-catalog-refresh-key:${providerId}:${idempotencyKey}`,
  ].sort();
  for (const identity of identities) {
    await db`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;
  }
}

async function providerById(
  db: DbClient,
  providerId: string,
  lock: boolean,
): Promise<AiCatalogProvider | null> {
  const result = lock
    ? await db<ProviderRow>`select provider_id, display_name, enabled, credential_authority_id,
        stale_after_seconds, current_refresh_id, control_version, created_at, updated_at
        from fuma_ai_catalog_providers_v2 where provider_id=${providerId} for update`
    : await db<ProviderRow>`select provider_id, display_name, enabled, credential_authority_id,
        stale_after_seconds, current_refresh_id, control_version, created_at, updated_at
        from fuma_ai_catalog_providers_v2 where provider_id=${providerId}`;
  return result.rows[0] ? providerFrom(result.rows[0]) : null;
}
async function refreshById(
  db: DbClient,
  refreshId: string,
): Promise<AiCatalogRefreshRecord | null> {
  const result =
    await db<RefreshRow>`select refresh_id, provider_id, idempotency_key, source_sequence,
    source_observed_at, catalog_hash_sha256, state, model_count, error_code, actor_id, completed_at
    from fuma_ai_catalog_refreshes_v2 where refresh_id=${refreshId}`;
  return result.rows[0] ? refreshFrom(result.rows[0]) : null;
}
async function defaultByTarget(
  db: DbClient,
  profile: string,
  kind: string,
  scopeId: string,
  lock: boolean,
): Promise<AiCatalogDefault | null> {
  const result = lock
    ? await db<DefaultRow>`select profile_id, target_kind, target_scope_id, provider_id, model_id,
        selection_version, updated_at from fuma_ai_catalog_defaults_v2 where profile_id=${profile}
        and target_kind=${kind} and target_scope_id=${scopeId} for update`
    : await db<DefaultRow>`select profile_id, target_kind, target_scope_id, provider_id, model_id,
        selection_version, updated_at from fuma_ai_catalog_defaults_v2 where profile_id=${profile}
        and target_kind=${kind} and target_scope_id=${scopeId}`;
  return result.rows[0] ? defaultFrom(result.rows[0]) : null;
}
async function insertRefresh(
  db: DbClient,
  value: AiCatalogRefreshRecord,
): Promise<void> {
  await db`insert into fuma_ai_catalog_refreshes_v2 (refresh_id, provider_id, idempotency_key,
    source_sequence, source_observed_at, catalog_hash_sha256, state, model_count, error_code,
    actor_id, completed_at) values (${value.refreshId}, ${value.providerId}, ${value.idempotencyKey},
    ${value.sourceSequence}, ${value.sourceObservedAt}, ${value.catalogHashSha256}, ${value.state},
    ${value.modelCount}, ${value.errorCode}, ${value.actorId}, ${value.completedAt})`;
}
async function insertVersion(
  db: DbClient,
  value: AiCatalogModelVersion,
): Promise<void> {
  await db`insert into fuma_ai_catalog_model_versions_v2 (provider_id, model_id, refresh_id,
    display_name, capabilities_json, context_window_tokens, input_micros_per_million,
    output_micros_per_million, markup_basis_points, source_observed_at) values (
    ${value.providerId}, ${value.modelId}, ${value.refreshId}, ${value.displayName},
    ${JSON.stringify(value.capabilities)}::text::jsonb, ${value.contextWindowTokens},
    ${value.inputMicrosPerMillion}, ${value.outputMicrosPerMillion},
    ${value.markupBasisPoints}, ${value.sourceObservedAt})`;
}
async function insertInitialControl(
  db: DbClient,
  value: AiCatalogModelControl,
): Promise<void> {
  await db`insert into fuma_ai_catalog_model_controls_v2 (provider_id, model_id, enabled,
    included, visibility, allowed_profiles_json, control_version, updated_at) values (
    ${value.providerId}, ${value.modelId}, ${value.enabled}, ${value.included}, ${value.visibility},
    ${JSON.stringify(value.allowedProfiles)}::text::jsonb, ${value.version}, ${value.updatedAt}) on conflict do nothing`;
}
async function conflictOrMissing(
  db: DbClient,
  table: string,
  column: string,
  id: string,
  label: string,
): Promise<AiCatalogRepositoryError> {
  if (table !== "fuma_ai_catalog_providers_v2" || column !== "provider_id")
    return new AiCatalogRepositoryError(
      "conflict",
      `${label} changed concurrently.`,
    );
  return (await providerById(db, id, false))
    ? new AiCatalogRepositoryError(
        "conflict",
        `${label} version changed concurrently.`,
      )
    : new AiCatalogRepositoryError("not-found", `${label} does not exist.`);
}
function providerFrom(row: ProviderRow): AiCatalogProvider {
  return parseAiCatalogContract(
    AiCatalogProviderSchema,
    {
      providerId: row.provider_id,
      displayName: row.display_name,
      enabled: row.enabled,
      credentialAuthorityId: row.credential_authority_id,
      staleAfterSeconds: integer(row.stale_after_seconds),
      currentRefreshId: row.current_refresh_id,
      version: integer(row.control_version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    },
    "aiCatalog.postgres.providerRow",
  );
}
function controlFrom(row: ControlRow): AiCatalogModelControl {
  return parseAiCatalogContract(
    AiCatalogModelControlSchema,
    {
      providerId: row.provider_id,
      modelId: row.model_id,
      enabled: row.enabled,
      included: row.included,
      visibility: row.visibility,
      allowedProfiles: json(row.allowed_profiles_json),
      version: integer(row.control_version),
      updatedAt: iso(row.updated_at),
    },
    "aiCatalog.postgres.controlRow",
  );
}
function versionFrom(row: VersionRow): AiCatalogModelVersion {
  return parseAiCatalogContract(
    AiCatalogModelVersionSchema,
    {
      providerId: row.provider_id,
      modelId: row.model_id,
      refreshId: row.refresh_id,
      displayName: row.display_name,
      capabilities: json(row.capabilities_json),
      contextWindowTokens: integer(row.context_window_tokens),
      inputMicrosPerMillion: integer(row.input_micros_per_million),
      outputMicrosPerMillion: integer(row.output_micros_per_million),
      markupBasisPoints: integer(row.markup_basis_points),
      sourceObservedAt: iso(row.source_observed_at),
    },
    "aiCatalog.postgres.versionRow",
  );
}
function refreshFrom(row: RefreshRow): AiCatalogRefreshRecord {
  return parseAiCatalogContract(
    AiCatalogRefreshRecordSchema,
    {
      refreshId: row.refresh_id,
      providerId: row.provider_id,
      idempotencyKey: row.idempotency_key,
      sourceSequence:
        row.source_sequence === null ? null : integer(row.source_sequence),
      sourceObservedAt:
        row.source_observed_at === null ? null : iso(row.source_observed_at),
      catalogHashSha256: row.catalog_hash_sha256,
      state: row.state,
      modelCount: integer(row.model_count),
      errorCode: row.error_code,
      actorId: row.actor_id,
      completedAt: iso(row.completed_at),
    },
    "aiCatalog.postgres.refreshRow",
  );
}
function defaultFrom(row: DefaultRow): AiCatalogDefault {
  return parseAiCatalogContract(
    AiCatalogDefaultSchema,
    {
      profile: row.profile_id,
      target: {
        kind: row.target_kind,
        scopeId: row.target_kind === "platform" ? null : row.target_scope_id,
      },
      providerId: row.provider_id,
      modelId: row.model_id,
      version: integer(row.selection_version),
      updatedAt: iso(row.updated_at),
    },
    "aiCatalog.postgres.defaultRow",
  );
}
function integer(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new AiCatalogRepositoryError(
      "conflict",
      "Stored AI catalog integer is unsafe.",
    );
  return result;
}
function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AiCatalogRepositoryError(
      "conflict",
      "Stored AI catalog JSON is invalid.",
    );
  }
}
function targetScopeId(target: AiCatalogScopeTarget): string {
  return target.kind === "platform" ? "" : (target.scopeId ?? "");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
