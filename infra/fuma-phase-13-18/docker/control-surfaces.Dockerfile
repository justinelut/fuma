# syntax=docker/dockerfile:1.7
ARG BUN_IMAGE
ARG NODE_IMAGE
ARG FUMA_DEPLOYMENT_ROOT_DOMAIN
FROM ${BUN_IMAGE} AS build
ARG FUMA_DEPLOYMENT_ROOT_DOMAIN
ENV FUMA_DEPLOYMENT_ROOT_DOMAIN=${FUMA_DEPLOYMENT_ROOT_DOMAIN}
RUN printf '%s' "$FUMA_DEPLOYMENT_ROOT_DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/control-surfaces/package.json apps/control-surfaces/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/public-contracts/package.json packages/public-contracts/package.json
COPY packages/fuma-governance-launch/package.json packages/fuma-governance-launch/package.json
RUN bun install --frozen-lockfile
COPY apps/control-surfaces apps/control-surfaces
COPY packages/fuma-governance-launch packages/fuma-governance-launch
RUN bun --cwd=apps/control-surfaces run build

FROM ${NODE_IMAGE} AS runtime
ARG FUMA_DEPLOYMENT_ROOT_DOMAIN
ENV FUMA_DEPLOYMENT_ROOT_DOMAIN=${FUMA_DEPLOYMENT_ROOT_DOMAIN}
ENV NODE_ENV=production PORT=3010 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/apps/control-surfaces/.next/standalone ./
COPY --from=build --chown=10001:10001 /workspace/apps/control-surfaces/.next/static ./apps/control-surfaces/.next/static
USER 10001:10001
EXPOSE 3010
CMD ["node", "apps/control-surfaces/server.js"]
