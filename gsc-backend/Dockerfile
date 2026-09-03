# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — compiles TypeScript and installs native modules.
#
# Node 24 (current LTS) rather than 20: Node 20 reached end of life in April
# 2026, so it no longer receives security patches. It also matches the Node
# version used in development, which keeps dev/prod drift low.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

# openssl: Prisma's engines need it.
# python3/make/g++: bcrypt is a native module and Alpine uses musl, which the
# published prebuilt binaries don't cover — so it is compiled from source here.
# These build tools exist ONLY in this stage; they never reach the final image.
RUN apk add --no-cache openssl python3 make g++

WORKDIR /app

# Copy manifests first so this layer is reused unless dependencies actually
# change. npm ci (not npm install) installs exactly what package-lock.json
# pins — reproducible, and it fails loudly if the lockfile is out of sync
# instead of silently resolving different versions.
COPY package*.json ./
RUN npm ci

COPY . .

# prisma generate && tsc — emits dist/
RUN npm run build

# ---------------------------------------------------------------------------
# Development stage — what `docker compose up` runs.
#
# Sits BEFORE the prune below, so it still has tsx and the TypeScript toolchain
# that `npm run dev` needs. Splitting the prune into its own stage is what makes
# that possible: previously the Dockerfile's only default was the production
# image, so `docker compose up` silently ran `node dist/index.js` over a
# bind-mounted source tree instead of a hot-reloading dev server.
# ---------------------------------------------------------------------------
FROM build AS dev
CMD ["npm", "run", "dev"]


# ---------------------------------------------------------------------------
# Prune stage — production node_modules only.
#
# Done here rather than as a second `npm ci --omit=dev` in the runtime stage so
# the compiled bcrypt binary is preserved and never rebuilt, which would drag
# the build toolchain into the final image.
# ---------------------------------------------------------------------------
FROM build AS pruned
RUN npm prune --omit=dev


# ---------------------------------------------------------------------------
# Runtime stage — no compilers, no source, no devDependencies.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

# --chown so files are owned by the unprivileged user that runs them.
COPY --from=pruned --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

# Needed at runtime by `prisma migrate deploy` (see docker-entrypoint.sh):
# the CLI reads the schema and the migration history to decide what to apply.
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.cjs ./prisma.config.cjs

COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Drop root. A process that never needs to write outside /tmp has no business
# running as uid 0 — if the app is ever compromised, this is what stops it
# rewriting its own code or the OS underneath it.
USER node

EXPOSE 3000

# Uses Node's built-in fetch rather than curl, which isn't installed on Alpine.
# Hits /readyz, not /healthz, so the check fails when the database is
# unreachable rather than reporting healthy while unable to serve anything.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
