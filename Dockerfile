# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS build
WORKDIR /app
# Every root-lock workspace manifest must exist before the frozen install. The
# legacy image still builds and runs Studio only.
COPY package.json bun.lock ./
COPY apps/studio/package.json ./apps/studio/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/control-surfaces/package.json ./apps/control-surfaces/package.json
COPY packages/brand/package.json ./packages/brand/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY packages/public-contracts/package.json ./packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json ./packages/fuma-governance-launch/package.json
COPY vendor ./vendor
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:studio

FROM oven/bun:1.3.14 AS production-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/studio/package.json ./apps/studio/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/control-surfaces/package.json ./apps/control-surfaces/package.json
COPY packages/brand/package.json ./packages/brand/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY packages/public-contracts/package.json ./packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json ./packages/fuma-governance-launch/package.json
COPY vendor ./vendor
RUN bun install --frozen-lockfile --production --filter @fuma/studio

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app/apps/studio

ARG INSTATIC_VERSION=dev
ARG INSTATIC_REVISION=unknown
ARG INSTATIC_CREATED=unknown

LABEL org.opencontainers.image.title="Instatic"
LABEL org.opencontainers.image.description="Self-hosted CMS with an integrated visual editor."
LABEL org.opencontainers.image.source="https://github.com/corebunch/instatic"
LABEL org.opencontainers.image.url="https://github.com/corebunch/instatic"
LABEL org.opencontainers.image.documentation="https://github.com/corebunch/instatic/tree/main/docs/deployment"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="${INSTATIC_VERSION}"
LABEL org.opencontainers.image.revision="${INSTATIC_REVISION}"
LABEL org.opencontainers.image.created="${INSTATIC_CREATED}"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV STATIC_DIR=/app/dist
ENV UPLOADS_DIR=/app/uploads

COPY --from=production-deps --chown=bun:bun /app/node_modules /app/node_modules
COPY --from=production-deps --chown=bun:bun /app/apps/studio/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps/studio/dist /app/dist
COPY --chown=bun:bun package.json bun.lock /app/
COPY --chown=bun:bun apps/studio/package.json ./
COPY --chown=bun:bun tsconfig.base.json /app/
COPY --chown=bun:bun apps/studio/tsconfig*.json ./
COPY --chown=bun:bun apps/studio/server ./server
COPY --chown=bun:bun apps/studio/src ./src

RUN mkdir -p /app/uploads /app/data && chown -R bun:bun /app

USER bun
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["bun", "run", "server/healthcheck.ts"]

CMD ["bun", "run", "server/index.ts"]
