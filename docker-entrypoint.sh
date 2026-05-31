#!/bin/sh
# Container entrypoint for the Lexical Resources System (Task 21, R12).
#
# Responsibilities, in order:
#   1. Ensure the volume-mounted data/ and uploads/ directories exist and are
#      writable by the (non-root) runtime user.
#   2. Apply pending Prisma migrations against the mounted SQLite database with
#      `prisma migrate deploy`. We use `deploy` (never `migrate dev`) because the
#      FTS5 virtual table + sync triggers are raw SQL inside the migration and
#      `migrate dev` would offer to drop them (see prisma/README.md).
#   3. exec the Next.js standalone server (server.js) as PID 1 so it receives
#      SIGTERM/SIGINT directly for clean shutdowns.
#
# Fail fast: any error aborts startup rather than serving against an un-migrated
# database.
set -eu

echo "[entrypoint] Ensuring data and uploads directories exist..."
mkdir -p /app/data /app/uploads

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
# Invoke the Prisma CLI entry directly via node. The runtime image copies the
# `prisma` package without running `npm ci`, so there is no node_modules/.bin
# symlink for `npx` to resolve — calling build/index.js is the robust path.
# Resolve the schema explicitly; the working directory is the standalone root.
node /app/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma

echo "[entrypoint] Starting Next.js standalone server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec node server.js
