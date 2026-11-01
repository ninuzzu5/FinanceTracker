# Override with a reviewed digest for an identical base across rebuilds.
ARG NODE_IMAGE=docker.io/library/node:22-bookworm-slim

FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json

FROM manifests AS build
RUN npm ci --workspace=@finance-tracker/bot --workspace=@finance-tracker/domain --include-workspace-root --no-audit --no-fund
COPY packages/domain/tsconfig.json ./packages/domain/tsconfig.json
COPY packages/domain/src ./packages/domain/src
COPY apps/bot/tsconfig.json ./apps/bot/tsconfig.json
COPY apps/bot/src ./apps/bot/src
COPY apps/bot/api ./apps/bot/api
RUN npm run build --workspace=@finance-tracker/domain \
    && npm run build --workspace=@finance-tracker/bot

FROM manifests AS runtime-deps
RUN npm ci --omit=dev --ignore-scripts --workspace=@finance-tracker/bot --workspace=@finance-tracker/domain --include-workspace-root --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=runtime-deps /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
# /app/.env.local must be supplied as a private read-only bind mount.
USER node
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "apps/bot/dist/src/local.js"]
