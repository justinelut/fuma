import type { FumaRequestContext } from "../context/contracts";
import { assertFumaRequestContext } from "../context/contracts";
import {
  AiCatalogAdminProjectionSchema,
  AiCatalogCreateProviderCommandSchema,
  AiCatalogCustomerProjectionSchema,
  AiCatalogDefaultCommandSchema,
  AiCatalogDefaultSchema,
  AiCatalogModelControlCommandSchema,
  AiCatalogModelControlSchema,
  AiCatalogModelVersionSchema,
  AiCatalogProviderControlCommandSchema,
  AiCatalogProviderSchema,
  AiCatalogQuoteRequestSchema,
  AiCatalogQuoteSchema,
  AiCatalogRefreshCommandSchema,
  AiCatalogRefreshRecordSchema,
  AiCatalogRefreshSnapshotSchema,
  AiCatalogTrustedAudienceSchema,
  parseAiCatalogContract,
  type AiCatalogAdminProjection,
  type AiCatalogCustomerProjection,
  type AiCatalogDefault,
  type AiCatalogDefaultCommand,
  type AiCatalogModelControl,
  type AiCatalogModelVersion,
  type AiCatalogProvider,
  type AiCatalogProviderControlCommand,
  type AiCatalogQuote,
  type AiCatalogQuoteRequest,
  type AiCatalogRefreshCommand,
  type AiCatalogRefreshRecord,
  type AiCatalogRefreshSnapshot,
  type AiCatalogTrustedAudience,
} from "./contracts";
import { AiCatalogRepositoryError, type AiCatalogRepository, type AiCatalogRepositorySnapshot } from "./repository";

const MILLION = 1_000_000n;
const BASIS_POINTS = 10_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const READ_PERMISSION = "platform.settings.read";
const WRITE_PERMISSION = "platform.settings.write";

export type AiCatalogServiceErrorCode =
  "unauthorized" | "invalid" | "not-found" | "conflict" | "disabled" | "stale" | "not-visible" | "money-overflow" | "refresh-failed";

export class AiCatalogServiceError extends Error {
  override readonly name = "AiCatalogServiceError";
  readonly code: AiCatalogServiceErrorCode;

  constructor(
    code: AiCatalogServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

/** Injected discovery boundary. FUMA-063 defines no provider transport and performs no provider call itself. */
export interface AiCatalogRefreshSource {
  snapshot(signal?: AbortSignal): Promise<unknown>;
}

export interface AiCatalogRefreshSourceRegistry {
  exact(providerId: string): AiCatalogRefreshSource | null;
}

type CurrentRow = Readonly<{
  provider: AiCatalogProvider;
  control: AiCatalogModelControl;
  version: AiCatalogModelVersion;
  refreshedAt: string;
}>;

export class AiCatalogService {
  readonly #repository: AiCatalogRepository;
  readonly #sources: AiCatalogRefreshSourceRegistry;
  readonly #platformId: string;
  readonly #now: () => Date;

  constructor(
    input: Readonly<{
      repository: AiCatalogRepository;
      sources: AiCatalogRefreshSourceRegistry;
      platformId: string;
      now?: () => Date;
    }>,
  ) {
    if (!input.platformId) throw new TypeError("AI catalog platform identity is required.");
    this.#repository = input.repository;
    this.#sources = input.sources;
    this.#platformId = input.platformId;
    this.#now = input.now ?? (() => new Date());
  }

  async createProvider(authority: FumaRequestContext, raw: unknown): Promise<AiCatalogProvider> {
    const actorId = this.#platformAdmin(authority, "write");
    const command = parseAiCatalogContract(AiCatalogCreateProviderCommandSchema, raw, "aiCatalog.createProvider");
    const at = validNow(this.#now);
    const provider = parseAiCatalogContract(
      AiCatalogProviderSchema,
      {
        ...command,
        enabled: false,
        currentRefreshId: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      },
      "aiCatalog.provider",
    );
    void actorId;
    try {
      return await this.#repository.createProvider(provider);
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  async controlProvider(authority: FumaRequestContext, providerId: string, raw: unknown): Promise<AiCatalogProvider> {
    this.#platformAdmin(authority, "write");
    const command = parseAiCatalogContract(AiCatalogProviderControlCommandSchema, raw, "aiCatalog.controlProvider");
    const snapshot = await this.#snapshot();
    const current = requiredProvider(snapshot, providerId);
    const next = parseAiCatalogContract(
      AiCatalogProviderSchema,
      {
        ...current,
        ...definedProviderPatch(command),
        version: current.version + 1,
        updatedAt: validNow(this.#now),
      },
      "aiCatalog.provider.next",
    );
    if (next.enabled) this.#assertProviderFresh(next, snapshot);
    try {
      return await this.#repository.updateProvider(next, command.expectedVersion);
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  async controlModel(authority: FumaRequestContext, providerId: string, modelId: string, raw: unknown): Promise<AiCatalogModelControl> {
    this.#platformAdmin(authority, "write");
    const command = parseAiCatalogContract(AiCatalogModelControlCommandSchema, raw, "aiCatalog.controlModel");
    const snapshot = await this.#snapshot();
    const current = requiredControl(snapshot, providerId, modelId);
    const version = currentVersion(snapshot, providerId, modelId);
    if (!version) throw new AiCatalogServiceError("not-found", "AI model has no current catalog version.");
    const next = parseAiCatalogContract(
      AiCatalogModelControlSchema,
      {
        ...current,
        ...definedModelPatch(command),
        version: current.version + 1,
        updatedAt: validNow(this.#now),
      },
      "aiCatalog.modelControl.next",
    );
    try {
      return await this.#repository.updateModelControl(next, command.expectedVersion);
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  async setDefault(authority: FumaRequestContext, raw: unknown): Promise<AiCatalogDefault | null> {
    this.#platformAdmin(authority, "write");
    const command = parseAiCatalogContract(AiCatalogDefaultCommandSchema, raw, "aiCatalog.setDefault");
    assertDefaultTarget(command);
    const snapshot = await this.#snapshot();
    const existing = snapshot.defaults.find((value) => defaultIdentity(value, command));
    if (command.selection === null) {
      if (command.expectedVersion === null) {
        if (existing) throw new AiCatalogServiceError("conflict", "Default selection already exists.");
        return null;
      }
      try {
        await this.#repository.clearDefault(command.profile, command.target, command.expectedVersion);
        return null;
      } catch (error) {
        throw repositoryFailure(error);
      }
    }
    const provider = requiredProvider(snapshot, command.selection.providerId);
    const control = requiredControl(snapshot, command.selection.providerId, command.selection.modelId);
    if (!provider.enabled || !control.enabled || control.visibility === "platform" || !control.allowedProfiles.includes(command.profile)) {
      throw new AiCatalogServiceError("disabled", "Default selection must be enabled and customer-visible for its profile.");
    }
    this.#assertProviderFresh(provider, snapshot);
    const value = parseAiCatalogContract(
      AiCatalogDefaultSchema,
      {
        profile: command.profile,
        target: command.target,
        providerId: command.selection.providerId,
        modelId: command.selection.modelId,
        version: (existing?.version ?? 0) + 1,
        updatedAt: validNow(this.#now),
      },
      "aiCatalog.default",
    );
    try {
      return await this.#repository.putDefault(value, command.expectedVersion);
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  async refresh(authority: FumaRequestContext, providerId: string, raw: unknown, signal?: AbortSignal): Promise<AiCatalogRefreshRecord> {
    const actorId = this.#platformAdmin(authority, "write");
    const command = parseAiCatalogContract(AiCatalogRefreshCommandSchema, raw, "aiCatalog.refresh");
    const before = await this.#snapshot();
    requiredProvider(before, providerId);
    const duplicate = matchingRefresh(before, providerId, command);
    if (duplicate) return duplicate;
    const source = this.#sources.exact(providerId);
    if (!source) return this.#recordRefreshFailure(providerId, command, actorId, "source-unavailable");

    let snapshot: AiCatalogRefreshSnapshot;
    try {
      const rawSnapshot = await source.snapshot(signal);
      snapshot = parseAiCatalogContract(AiCatalogRefreshSnapshotSchema, rawSnapshot, "aiCatalog.refreshSnapshot");
      assertRefreshSnapshot(snapshot, validNow(this.#now));
    } catch (error) {
      const errorCode = error instanceof AiCatalogServiceError ? "invalid-snapshot" : "source-unavailable";
      return this.#recordRefreshFailure(providerId, command, actorId, errorCode);
    }

    const completedAt = validNow(this.#now);
    const record = parseAiCatalogContract(
      AiCatalogRefreshRecordSchema,
      {
        refreshId: command.refreshId,
        providerId,
        idempotencyKey: command.idempotencyKey,
        sourceSequence: snapshot.sourceSequence,
        sourceObservedAt: snapshot.sourceObservedAt,
        catalogHashSha256: sha256(snapshot),
        state: "applied",
        modelCount: snapshot.models.length,
        errorCode: null,
        actorId,
        completedAt,
      },
      "aiCatalog.refreshRecord",
    ) as Extract<AiCatalogRefreshRecord, { state: "applied" }>;
    const versions = snapshot.models.map((model) =>
      parseAiCatalogContract(
        AiCatalogModelVersionSchema,
        {
          providerId,
          modelId: model.modelId,
          refreshId: command.refreshId,
          displayName: model.displayName,
          capabilities: model.capabilities,
          contextWindowTokens: model.contextWindowTokens,
          inputMicrosPerMillion: model.inputMicrosPerMillion,
          outputMicrosPerMillion: model.outputMicrosPerMillion,
          markupBasisPoints: model.markupBasisPoints,
          sourceObservedAt: snapshot.sourceObservedAt,
        },
        "aiCatalog.modelVersion",
      ),
    );
    const knownControls = new Set(before.controls.filter((value) => value.providerId === providerId).map((value) => value.modelId));
    const initialControls = versions
      .filter((value) => !knownControls.has(value.modelId))
      .map((value) =>
        parseAiCatalogContract(
          AiCatalogModelControlSchema,
          {
            providerId,
            modelId: value.modelId,
            enabled: false,
            included: false,
            visibility: "platform",
            allowedProfiles: ["website", "publication"],
            version: 1,
            updatedAt: completedAt,
          },
          "aiCatalog.initialModelControl",
        ),
      );
    try {
      return await this.#repository.commitRefresh({
        record,
        versions,
        initialControls,
      });
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  async customerProjection(rawAudience: unknown): Promise<AiCatalogCustomerProjection> {
    const audience = this.#audience(rawAudience);
    const snapshot = await this.#snapshot();
    const rows = this.#visibleRows(snapshot, audience);
    const selectedDefault = resolveDefault(snapshot.defaults, audience, rows);
    const grouped = new Map<string, CurrentRow[]>();
    for (const row of rows) grouped.set(row.provider.providerId, [...(grouped.get(row.provider.providerId) ?? []), row]);
    const providers = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => ({
        providerId: values[0]!.provider.providerId,
        displayName: values[0]!.provider.displayName,
        refreshedAt: values[0]!.refreshedAt,
        models: values
          .sort((left, right) => left.version.modelId.localeCompare(right.version.modelId))
          .map((row) => ({
            providerId: row.provider.providerId,
            modelId: row.version.modelId,
            displayName: row.version.displayName,
            capabilities: row.version.capabilities,
            contextWindowTokens: row.version.contextWindowTokens,
            inputMicrosPerMillion: row.version.inputMicrosPerMillion,
            outputMicrosPerMillion: row.version.outputMicrosPerMillion,
            markupBasisPoints: row.version.markupBasisPoints,
            included: row.control.included,
            visibility: row.control.visibility,
            isDefault: selectedDefault?.providerId === row.provider.providerId && selectedDefault.modelId === row.version.modelId,
          })),
      }));
    return parseAiCatalogContract(
      AiCatalogCustomerProjectionSchema,
      {
        generatedAt: validNow(this.#now),
        profile: audience.profile,
        providers,
        defaultModel: selectedDefault
          ? {
              providerId: selectedDefault.providerId,
              modelId: selectedDefault.modelId,
            }
          : null,
      },
      "aiCatalog.customerProjection",
    );
  }

  async adminProjection(authority: FumaRequestContext): Promise<AiCatalogAdminProjection> {
    this.#platformAdmin(authority, "read");
    const snapshot = await this.#snapshot();
    const providers = snapshot.providers
      .slice()
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map((provider) => {
        const current = currentRefresh(snapshot, provider);
        const rows = currentRows(snapshot).filter((row) => row.provider.providerId === provider.providerId);
        return {
          providerId: provider.providerId,
          displayName: provider.displayName,
          enabled: provider.enabled,
          credentialConfigured: provider.credentialAuthorityId !== null,
          stale: !current || isStale(provider, current.sourceObservedAt, this.#now()),
          staleAfterSeconds: provider.staleAfterSeconds,
          currentRefreshId: provider.currentRefreshId,
          refreshedAt: current?.sourceObservedAt ?? null,
          controlVersion: provider.version,
          models: rows
            .sort((left, right) => left.version.modelId.localeCompare(right.version.modelId))
            .map((row) => ({
              providerId: provider.providerId,
              modelId: row.version.modelId,
              displayName: row.version.displayName,
              capabilities: row.version.capabilities,
              contextWindowTokens: row.version.contextWindowTokens,
              inputMicrosPerMillion: row.version.inputMicrosPerMillion,
              outputMicrosPerMillion: row.version.outputMicrosPerMillion,
              markupBasisPoints: row.version.markupBasisPoints,
              included: row.control.included,
              visibility: row.control.visibility,
              isDefault: snapshot.defaults.some(
                (value) => value.providerId === provider.providerId && value.modelId === row.version.modelId,
              ),
              enabled: row.control.enabled,
              controlVersion: row.control.version,
              refreshId: row.version.refreshId,
            })),
        };
      });
    return parseAiCatalogContract(
      AiCatalogAdminProjectionSchema,
      {
        generatedAt: validNow(this.#now),
        providers,
        refreshes: snapshot.refreshes
          .slice()
          .sort(
            (left, right) =>
              right.completedAt.localeCompare(left.completedAt) ||
              (right.sourceSequence ?? 0) - (left.sourceSequence ?? 0) ||
              right.refreshId.localeCompare(left.refreshId),
          )
          .slice(0, 1_000),
        defaults: snapshot.defaults.slice().sort(defaultOrder),
      },
      "aiCatalog.adminProjection",
    );
  }

  async quote(rawAudience: unknown, rawRequest: unknown): Promise<AiCatalogQuote> {
    const audience = this.#audience(rawAudience);
    const request = parseAiCatalogContract(AiCatalogQuoteRequestSchema, rawRequest, "aiCatalog.quoteRequest");
    const snapshot = await this.#snapshot();
    const row = this.#visibleRows(snapshot, audience).find(
      (value) => value.provider.providerId === request.providerId && value.version.modelId === request.modelId,
    );
    if (!row) throw new AiCatalogServiceError("not-visible", "AI model is unavailable.");
    const providerCostMicros = exactTokenCost(request, row.version);
    const markupMicros = exactMarkup(providerCostMicros, row.version.markupBasisPoints);
    const chargeMicros = row.control.included ? 0 : checkedNumber(BigInt(providerCostMicros) + BigInt(markupMicros));
    return parseAiCatalogContract(
      AiCatalogQuoteSchema,
      {
        ...request,
        providerCostMicros,
        markupMicros,
        chargeMicros,
        included: row.control.included,
      },
      "aiCatalog.quote",
    );
  }

  async #recordRefreshFailure(
    providerId: string,
    command: AiCatalogRefreshCommand,
    actorId: string,
    errorCode: string,
  ): Promise<AiCatalogRefreshRecord> {
    const record = parseAiCatalogContract(
      AiCatalogRefreshRecordSchema,
      {
        refreshId: command.refreshId,
        providerId,
        idempotencyKey: command.idempotencyKey,
        sourceSequence: null,
        sourceObservedAt: null,
        catalogHashSha256: null,
        state: "failed",
        modelCount: 0,
        errorCode,
        actorId,
        completedAt: validNow(this.#now),
      },
      "aiCatalog.failedRefresh",
    ) as Extract<AiCatalogRefreshRecord, { state: "failed" }>;
    try {
      return await this.#repository.recordRefreshFailure(record);
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  #platformAdmin(authority: FumaRequestContext, access: "read" | "write"): string {
    try {
      assertFumaRequestContext(authority);
    } catch {
      throw new AiCatalogServiceError("unauthorized", "Platform AI catalog authority denied.");
    }
    const permission = access === "write" ? WRITE_PERMISSION : READ_PERMISSION;
    const allowed = authority.permissions.allow.includes(permission) && !authority.permissions.deny.includes(permission);
    if (
      authority.actor.kind !== "staff" ||
      authority.actor.impersonator !== null ||
      authority.scope.platform.id !== this.#platformId ||
      !allowed
    ) {
      throw new AiCatalogServiceError("unauthorized", "Platform AI catalog authority denied.");
    }
    return authority.actor.userId;
  }

  #audience(raw: unknown): AiCatalogTrustedAudience {
    const audience = parseAiCatalogContract(AiCatalogTrustedAudienceSchema, raw, "aiCatalog.audience");
    if (audience.platformId !== this.#platformId || audience.kind === "platform-admin") {
      throw new AiCatalogServiceError("not-visible", "AI catalog is unavailable.");
    }
    assertAudienceHierarchy(audience);
    return audience;
  }

  #visibleRows(snapshot: AiCatalogRepositorySnapshot, audience: AiCatalogTrustedAudience): CurrentRow[] {
    const enabled = snapshot.providers.filter((provider) => provider.enabled);
    for (const provider of enabled) this.#assertProviderFresh(provider, snapshot);
    const allowedVisibility =
      audience.kind === "platform-admin"
        ? new Set(["public", "customer", "platform"])
        : audience.kind === "customer"
          ? new Set(["public", "customer"])
          : new Set(["public"]);
    return currentRows(snapshot).filter(
      (row) =>
        row.provider.enabled &&
        row.control.enabled &&
        row.control.allowedProfiles.includes(audience.profile) &&
        allowedVisibility.has(row.control.visibility),
    );
  }

  #assertProviderFresh(provider: AiCatalogProvider, snapshot: AiCatalogRepositorySnapshot): void {
    const refresh = currentRefresh(snapshot, provider);
    if (!refresh || isStale(provider, refresh.sourceObservedAt, this.#now())) {
      throw new AiCatalogServiceError("stale", "Enabled AI catalog is stale or has no applied refresh.");
    }
  }

  async #snapshot(): Promise<AiCatalogRepositorySnapshot> {
    const value = await this.#repository.snapshot();
    return Object.freeze({
      providers: Object.freeze(
        value.providers.map((item) => parseAiCatalogContract(AiCatalogProviderSchema, item, "aiCatalog.repository.provider")),
      ),
      controls: Object.freeze(
        value.controls.map((item) => parseAiCatalogContract(AiCatalogModelControlSchema, item, "aiCatalog.repository.control")),
      ),
      versions: Object.freeze(
        value.versions.map((item) => parseAiCatalogContract(AiCatalogModelVersionSchema, item, "aiCatalog.repository.version")),
      ),
      refreshes: Object.freeze(
        value.refreshes.map((item) => parseAiCatalogContract(AiCatalogRefreshRecordSchema, item, "aiCatalog.repository.refresh")),
      ),
      defaults: Object.freeze(
        value.defaults.map((item) => parseAiCatalogContract(AiCatalogDefaultSchema, item, "aiCatalog.repository.default")),
      ),
    });
  }
}

function definedProviderPatch(command: AiCatalogProviderControlCommand): Partial<AiCatalogProvider> {
  return Object.fromEntries(Object.entries(command).filter(([key, value]) => key !== "expectedVersion" && value !== undefined));
}
function definedModelPatch(command: Record<string, unknown>): Partial<AiCatalogModelControl> {
  return Object.fromEntries(Object.entries(command).filter(([key, value]) => key !== "expectedVersion" && value !== undefined));
}
function validNow(now: () => Date): string {
  const value = now().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new AiCatalogServiceError("invalid", "Clock returned an invalid timestamp.");
  return value;
}
function requiredProvider(snapshot: AiCatalogRepositorySnapshot, providerId: string): AiCatalogProvider {
  const value = snapshot.providers.find((provider) => provider.providerId === providerId);
  if (!value) throw new AiCatalogServiceError("not-found", "AI provider does not exist.");
  return value;
}
function requiredControl(snapshot: AiCatalogRepositorySnapshot, providerId: string, modelId: string): AiCatalogModelControl {
  const value = snapshot.controls.find((control) => control.providerId === providerId && control.modelId === modelId);
  if (!value) throw new AiCatalogServiceError("not-found", "AI model control does not exist.");
  return value;
}
function currentRefresh(
  snapshot: AiCatalogRepositorySnapshot,
  provider: AiCatalogProvider,
): Extract<AiCatalogRefreshRecord, { state: "applied" }> | null {
  if (!provider.currentRefreshId) return null;
  const value = snapshot.refreshes.find((refresh) => refresh.refreshId === provider.currentRefreshId);
  return value?.state === "applied" ? value : null;
}
function currentVersion(snapshot: AiCatalogRepositorySnapshot, providerId: string, modelId: string): AiCatalogModelVersion | null {
  const provider = snapshot.providers.find((value) => value.providerId === providerId);
  if (!provider?.currentRefreshId) return null;
  return (
    snapshot.versions.find(
      (value) => value.providerId === providerId && value.modelId === modelId && value.refreshId === provider.currentRefreshId,
    ) ?? null
  );
}
function currentRows(snapshot: AiCatalogRepositorySnapshot): CurrentRow[] {
  const rows: CurrentRow[] = [];
  for (const provider of snapshot.providers) {
    const refresh = currentRefresh(snapshot, provider);
    if (!refresh) continue;
    for (const control of snapshot.controls.filter((value) => value.providerId === provider.providerId)) {
      const version = currentVersion(snapshot, provider.providerId, control.modelId);
      if (version)
        rows.push({
          provider,
          control,
          version,
          refreshedAt: refresh.sourceObservedAt,
        });
    }
  }
  return rows;
}
function isStale(provider: AiCatalogProvider, observedAt: string, now: Date): boolean {
  const observed = Date.parse(observedAt);
  const current = now.getTime();
  return !Number.isFinite(observed) || observed > current || current - observed > provider.staleAfterSeconds * 1_000;
}
function matchingRefresh(
  snapshot: AiCatalogRepositorySnapshot,
  providerId: string,
  command: AiCatalogRefreshCommand,
): AiCatalogRefreshRecord | null {
  const byId = snapshot.refreshes.find((value) => value.refreshId === command.refreshId);
  const byKey = snapshot.refreshes.find((value) => value.providerId === providerId && value.idempotencyKey === command.idempotencyKey);
  if (!byId && !byKey) return null;
  if (
    byId &&
    byKey &&
    byId.refreshId === byKey.refreshId &&
    byId.providerId === providerId &&
    byId.idempotencyKey === command.idempotencyKey
  )
    return byId;
  throw new AiCatalogServiceError("conflict", "Refresh identity was reused with different evidence.");
}
function assertRefreshSnapshot(snapshot: AiCatalogRefreshSnapshot, now: string): void {
  if (Date.parse(snapshot.sourceObservedAt) > Date.parse(now))
    throw new AiCatalogServiceError("invalid", "Refresh observation cannot be in the future.");
  const ids = snapshot.models.map((model) => model.modelId);
  if (new Set(ids).size !== ids.length) throw new AiCatalogServiceError("invalid", "Refresh snapshot contains duplicate model identities.");
}
function assertAudienceHierarchy(audience: AiCatalogTrustedAudience): void {
  const values = [audience.organizationId, audience.workspaceId, audience.siteId];
  let missing = false;
  for (const value of values) {
    if (value === null) missing = true;
    else if (missing) throw new AiCatalogServiceError("not-visible", "AI catalog scope is unavailable.");
  }
  if (audience.kind !== "public" && audience.siteId === null) {
    throw new AiCatalogServiceError("not-visible", "AI catalog scope is unavailable.");
  }
}
function assertDefaultTarget(command: AiCatalogDefaultCommand): void {
  const valid = command.target.kind === "platform" ? command.target.scopeId === null : command.target.scopeId !== null;
  if (!valid) throw new AiCatalogServiceError("invalid", "Default target scope is malformed.");
}
function defaultIdentity(value: AiCatalogDefault, command: AiCatalogDefaultCommand): boolean {
  return value.profile === command.profile && value.target.kind === command.target.kind && value.target.scopeId === command.target.scopeId;
}
function resolveDefault(
  defaults: readonly AiCatalogDefault[],
  audience: AiCatalogTrustedAudience,
  rows: readonly CurrentRow[],
): AiCatalogDefault | null {
  const targets: Array<readonly [AiCatalogDefault["target"]["kind"], string | null]> = [];
  if (audience.siteId) targets.push(["site", audience.siteId]);
  if (audience.workspaceId) targets.push(["workspace", audience.workspaceId]);
  if (audience.organizationId) targets.push(["organization", audience.organizationId]);
  targets.push(["platform", null]);
  for (const [kind, scopeId] of targets) {
    const value = defaults.find(
      (candidate) => candidate.profile === audience.profile && candidate.target.kind === kind && candidate.target.scopeId === scopeId,
    );
    if (value && rows.some((row) => row.provider.providerId === value.providerId && row.version.modelId === value.modelId)) return value;
  }
  return null;
}
function defaultOrder(left: AiCatalogDefault, right: AiCatalogDefault): number {
  return `${left.profile}:${left.target.kind}:${left.target.scopeId ?? ""}`.localeCompare(
    `${right.profile}:${right.target.kind}:${right.target.scopeId ?? ""}`,
  );
}
function exactTokenCost(request: AiCatalogQuoteRequest, version: AiCatalogModelVersion): number {
  const numerator =
    BigInt(request.inputTokens) * BigInt(version.inputMicrosPerMillion) +
    BigInt(request.outputTokens) * BigInt(version.outputMicrosPerMillion);
  return checkedNumber(ceilDivide(numerator, MILLION));
}
function exactMarkup(providerCostMicros: number, basisPoints: number): number {
  return checkedNumber(ceilDivide(BigInt(providerCostMicros) * BigInt(basisPoints), BASIS_POINTS));
}
function ceilDivide(value: bigint, divisor: bigint): bigint {
  return value === 0n ? 0n : (value + divisor - 1n) / divisor;
}
function checkedNumber(value: bigint): number {
  if (value < 0n || value > MAX_SAFE) throw new AiCatalogServiceError("money-overflow", "AI quote exceeds exact integer money range.");
  return Number(value);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(",")}}`;
}
function sha256(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(canonical(value)).digest("hex");
}
function repositoryFailure(error: unknown): AiCatalogServiceError {
  if (error instanceof AiCatalogServiceError) return error;
  if (error instanceof AiCatalogRepositoryError) {
    const code = error.code === "not-found" ? "not-found" : "conflict";
    return new AiCatalogServiceError(code, error.message);
  }
  return new AiCatalogServiceError("refresh-failed", "AI catalog authority failed safely.");
}
