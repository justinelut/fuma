# syntax=docker/dockerfile:1.7
ARG OPS_BASE_IMAGE
FROM ${OPS_BASE_IMAGE}
WORKDIR /opt/fuma-ops
COPY --chown=10001:10001 infra/fuma-phase-13-18/ops/main.ts ./main.ts
USER 10001:10001
ENTRYPOINT ["bun", "/opt/fuma-ops/main.ts"]
