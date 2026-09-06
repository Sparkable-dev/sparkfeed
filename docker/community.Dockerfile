FROM oven/bun:1.3.6-alpine AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .

ENV VITE_DEMO_MODE=false
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:22-alpine AS runtime

COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV VITE_DEMO_MODE=false

COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build --chown=node:node /app/package.json /app/bun.lock ./
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["sh", "-c", "bun run db:migrate && exec node .output/server/index.mjs"]
