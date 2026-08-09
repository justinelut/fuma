# Build Onlook web client
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV STANDALONE_BUILD=true
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000

COPY . .

RUN bun install --frozen-lockfile
RUN cd apps/web/client && \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    BETTER_AUTH_SECRET="build-only-placeholder-at-least-32-characters" \
    CSB_API_KEY="build-only-placeholder" \
    OPENROUTER_API_KEY="build-only-placeholder" \
    NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
    SKIP_ENV_VALIDATION=1 \
    bun run build:standalone

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

USER bun

CMD ["bun", "apps/web/client/.next/standalone/apps/web/client/server.js"]
