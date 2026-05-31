# syntax=docker/dockerfile:1
#
# Multi-stage Docker build for the Lexical Resources System (Task 21, R12).
#
#   deps    -> install all npm dependencies (incl. devDeps needed for the build)
#   build   -> generate the Prisma client and run `next build` (standalone output)
#   runtime -> lean image that runs Prisma migrations on startup, then the
#              Next.js standalone server as a non-root user.
#
# Base image: Debian "bookworm-slim" (glibc). Chosen over Alpine because both
# Prisma (needs OpenSSL 3.0 + glibc) and sharp (prebuilt libvips binaries target
# glibc) work without extra musl/libc shims, making the build more reliable.
#
# Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, NFR 4.3

# ---------------------------------------------------------------------------
# Stage 1 — deps: install the full dependency tree (dev + prod).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# OpenSSL + CA certs are required by Prisma's engines.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install against the lockfile only — copying just the manifests keeps this
# layer cached unless dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build: generate the Prisma client and compile the Next.js app.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# A DATABASE_URL must be defined for `prisma generate`; no connection is made at
# build time (every page is `dynamic = 'force-dynamic'`), so the value is only a
# placeholder that matches the runtime path.
ENV DATABASE_URL="file:/app/data/lexical.db"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client (writes node_modules/.prisma/client) before the
# Next build, which imports @prisma/client transitively.
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime: minimal production image.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The container ALWAYS listens on 3000 internally; the host-side port is mapped
# in docker-compose.yml (default 3000, configurable). HOSTNAME=0.0.0.0 makes the
# standalone server bind every interface so it is reachable from the host.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Absolute paths avoid any ambiguity about where the volume-mounted SQLite file
# and uploads live. The DB file is kept in data/ (NFR 4.3 — never web-served).
ENV DATABASE_URL="file:/app/data/lexical.db"
ENV UPLOADS_DIR="/app/uploads"

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone server + its traced node_modules + the static assets.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Drop any .env that `next build` may have bundled into the standalone output.
# In the container the SINGLE source of truth for config is the Docker ENV /
# compose environment (absolute DATABASE_URL + UPLOADS_DIR); a stale relative
# DATABASE_URL from a bundled .env must never shadow it.
RUN rm -f /app/.env

# Prisma schema + migration history are needed to run `migrate deploy` at
# startup. The prisma CLI, engines, and generated client are copied so the
# entrypoint can apply migrations without a network fetch.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# sharp (native libvips) powers image validation + thumbnailing. Copy it (and
# its @img native binaries) explicitly so image uploads work regardless of how
# Next's file tracing prunes native modules.
COPY --from=build /app/node_modules/sharp ./node_modules/sharp
COPY --from=build /app/node_modules/@img ./node_modules/@img

COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Create the volume mount points and hand the whole app tree to the unprivileged
# `node` user (present in the base image). Because these dirs are node-owned,
# first-time named-volume mounts inherit that ownership and stay writable.
RUN chmod +x ./docker-entrypoint.sh \
 && mkdir -p /app/data /app/uploads \
 && chown -R node:node /app

USER node

EXPOSE 3000

# Container-orchestration health probe (R12.5). Uses Node's built-in fetch so no
# curl/wget needs to be installed in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
