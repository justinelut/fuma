# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS build
ARG FUMA_DEPLOYMENT_ROOT_DOMAIN
ENV FUMA_DEPLOYMENT_ROOT_DOMAIN=${FUMA_DEPLOYMENT_ROOT_DOMAIN}
RUN test -n "$FUMA_DEPLOYMENT_ROOT_DOMAIN"
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
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
RUN bun run build:web

FROM node:22.22.0-slim AS runtime
ARG FUMA_DEPLOYMENT_ROOT_DOMAIN
ENV FUMA_DEPLOYMENT_ROOT_DOMAIN=${FUMA_DEPLOYMENT_ROOT_DOMAIN}
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3002

RUN groupadd --system --gid 1001 fuma && useradd --system --uid 1001 --gid fuma web
COPY --from=build --chown=web:fuma /app/apps/web/.next/standalone ./
COPY --from=build --chown=web:fuma /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=web:fuma /app/apps/web/content ./apps/web/content

USER web
EXPOSE 3002
CMD ["node", "apps/web/server.js"]
