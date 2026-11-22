# syntax=docker/dockerfile:1.7
#
# Royal's WhatsApp bridge. Two stages: build the TypeScript, then a slim
# runtime with production dependencies only, running as the unprivileged
# `node` user. Everything that must survive a redeploy — the linked device's
# keys, group mappings, queued events, media — lives in /data. Mount a volume
# there: `bridge-data` in compose.yaml, or a Railway Volume at /data. There is
# no VOLUME instruction because Railway refuses a Dockerfile that has one.
#
# The image starts as root only long enough for docker-entrypoint.sh to make
# /data writable by `node` (a host's volume can arrive root-owned), then the
# bridge itself runs as `node`.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data && chown -R node:node /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
