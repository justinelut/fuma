# syntax=docker/dockerfile:1.7
ARG BUN_IMAGE
ARG NODE_IMAGE

FROM ${BUN_IMAGE} AS build
WORKDIR /workspace
COPY package.json bun.lock ./
COPY tsconfig.base.json ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/control-surfaces/package.json apps/control-surfaces/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/public-contracts/package.json packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json packages/fuma-governance-launch/package.json
COPY vendor vendor
RUN bun install --frozen-lockfile
COPY apps/web apps/web
COPY packages/brand packages/brand
COPY packages/design-tokens packages/design-tokens
COPY packages/public-contracts packages/public-contracts
COPY packages/fuma-governance-launch packages/fuma-governance-launch
RUN bun --cwd=apps/web run build

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_SHA
ARG LOCK_HASH_SHA256
ARG MIGRATION_HIGH_WATER_MARK
RUN printf '%s' "${SOURCE_SHA}" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' \
 && printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^[a-f0-9]{64}$' \
 && ! printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^0{64}$' \
 && printf '%s' "${MIGRATION_HIGH_WATER_MARK}" | grep -Eq '^000[0-9]{3}_[a-z0-9_]+$'
LABEL org.opencontainers.image.title="Fuma public web" \
      org.opencontainers.image.source="https://github.com/corebunch/instatic" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      ke.co.fuma.lock-hash-sha256="${LOCK_HASH_SHA256}" \
      ke.co.fuma.migration-high-water="${MIGRATION_HIGH_WATER_MARK}"
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next/static ./apps/web/.next/static
USER 10001:10001
EXPOSE 3002
CMD ["node", "apps/web/server.js"]
