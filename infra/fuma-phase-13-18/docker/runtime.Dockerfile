# syntax=docker/dockerfile:1.7
ARG BUN_IMAGE

FROM ${BUN_IMAGE} AS workspace-deps
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/control-surfaces/package.json apps/control-surfaces/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/public-contracts/package.json packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json packages/fuma-governance-launch/package.json
COPY vendor vendor
RUN bun install --frozen-lockfile

FROM ${BUN_IMAGE} AS production-deps
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/control-surfaces/package.json apps/control-surfaces/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/public-contracts/package.json packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json packages/fuma-governance-launch/package.json
COPY vendor vendor
RUN bun install --frozen-lockfile --production --filter @fuma/studio

FROM ${BUN_IMAGE} AS runtime-base
ARG SOURCE_SHA
ARG LOCK_HASH_SHA256
ARG MIGRATION_HIGH_WATER_MARK
RUN printf '%s' "${SOURCE_SHA}" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' \
 && printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^[a-f0-9]{64}$' \
 && ! printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^0{64}$' \
 && printf '%s' "${MIGRATION_HIGH_WATER_MARK}" | grep -Eq '^000[0-9]{3}_[a-z0-9_]+$'
LABEL org.opencontainers.image.title="Fuma runtime" \
      org.opencontainers.image.source="https://github.com/justinelut/fuma" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      ke.co.fuma.lock-hash-sha256="${LOCK_HASH_SHA256}" \
      ke.co.fuma.migration-high-water="${MIGRATION_HIGH_WATER_MARK}"
ENV NODE_ENV=production FUMA_ENV=production FUMA_HOSTED=true
WORKDIR /workspace
COPY --from=production-deps --chown=bun:bun /workspace/node_modules ./node_modules
COPY --from=production-deps --chown=bun:bun /workspace/apps/studio/node_modules ./apps/studio/node_modules
# Workspace package sources resolve external dependencies from /workspace/node_modules,
# while Bun's filtered production install links TypeBox only below the Studio app.
RUN test -d node_modules/.bun/@sinclair+typebox@0.34.49/node_modules/@sinclair/typebox \
 && mkdir -p node_modules/@sinclair \
 && ln -s ../.bun/@sinclair+typebox@0.34.49/node_modules/@sinclair/typebox node_modules/@sinclair/typebox
COPY --chown=bun:bun package.json bun.lock tsconfig.base.json ./
COPY --chown=bun:bun apps/studio/package.json apps/studio/tsconfig*.json ./apps/studio/
COPY --chown=bun:bun apps/studio/server ./apps/studio/server
COPY --chown=bun:bun apps/studio/scripts/fuma-migrate.ts ./apps/studio/scripts/fuma-migrate.ts
COPY --chown=bun:bun apps/studio/src ./apps/studio/src
COPY --chown=bun:bun packages ./packages
COPY --chmod=0555 infra/fuma-phase-13-18/docker/runtime-entrypoint.sh /usr/local/bin/fuma-runtime
USER bun
EXPOSE 3101 3102 3103
ENTRYPOINT ["/usr/local/bin/fuma-runtime"]
CMD ["web"]

FROM runtime-base AS runtime

# CI-only target retaining the exact root-lock dev dependency graph needed by
# the FUMA-041 compatibility probe. It is never the published runtime target.
FROM runtime-base AS compatibility
USER root
COPY --from=workspace-deps --chown=bun:bun /workspace/node_modules ./node_modules
COPY --from=workspace-deps --chown=bun:bun /workspace/apps/studio/node_modules ./apps/studio/node_modules
USER bun
