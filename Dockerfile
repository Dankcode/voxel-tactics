FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --workspace=client --workspace=server --include-workspace-root=false --no-audit --no-fund
COPY client ./client
COPY shared ./shared
COPY tools/net ./tools/net
RUN npm run build && npm prune --omit=dev --workspace=client --workspace=server --include-workspace-root=false --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/client/package.json ./client/package.json
COPY --from=build --chown=node:node /app/client/dist ./client/dist
# The shared map catalog imports these JSON packages at runtime.
COPY --from=build --chown=node:node /app/client/public/maps ./client/public/maps
COPY --from=build --chown=node:node /app/shared ./shared
COPY --chown=node:node server/package.json ./server/package.json
COPY --chown=node:node server/src ./server/src
RUN mkdir -p server/data && chown node:node server/data
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:2567/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/src/index.js"]
