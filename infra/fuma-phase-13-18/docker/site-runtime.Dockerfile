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
COPY apps/site-runtime apps/site-runtime
COPY apps/web apps/web
COPY packages packages
COPY tooling/site-runtime tooling/site-runtime
RUN bun run build:site-runtime

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_SHA
ARG LOCK_HASH_SHA256
ARG MIGRATION_HIGH_WATER_MARK
RUN printf '%s' "${SOURCE_SHA}" | grep -Eq '^[a-f0-9]{40}([a-f0-9]{24})?$' \
 && printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^[a-f0-9]{64}$' \
 && ! printf '%s' "${LOCK_HASH_SHA256}" | grep -Eq '^0{64}$' \
 && printf '%s' "${MIGRATION_HIGH_WATER_MARK}" | grep -Eq '^000[0-9]{3}_[a-z0-9_]+$'
LABEL org.opencontainers.image.title="Fuma site runtime" \
      org.opencontainers.image.source="https://github.com/corebunch/instatic" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      ke.co.fuma.lock-hash-sha256="${LOCK_HASH_SHA256}" \
      ke.co.fuma.migration-high-water="${MIGRATION_HIGH_WATER_MARK}"
ENV NODE_ENV=production PORT=3003 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=10002:10002 /workspace/apps/site-runtime/.next/standalone ./
USER 10002:10002
EXPOSE 3003
CMD ["node", "apps/site-runtime/server.js"]
