# Lexical Resources System

A single-user web app for managing a bilingual (English–Chinese) lexical
collection: dynamic categories, full CRUD entries with Markdown definitions and
examples, image uploads with thumbnails, full-text search, a thesaurus/genre/
writing/speaking view system, and multi-format export. It replaces an older
static HTML/CSS/JS site (preserved under `htmls/`).

- **Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Data:** Prisma + SQLite (with an FTS5 full-text index)
- **Images:** local filesystem + Sharp thumbnails
- **Testing:** Vitest + fast-check (property-based) + Playwright (E2E)

## Prerequisites

- Node.js 20+ and npm (for local development)
- Docker + Docker Compose v2 (for containerized deployment)

## Local development

```bash
npm install
cp .env.example .env          # DATABASE_URL -> data/lexical.db
npm run prisma:migrate:deploy # apply migrations (creates data/lexical.db)
npm run dev                   # http://localhost:3000
```

> Migrations are always applied with `prisma migrate deploy`, **never**
> `prisma migrate dev`. The FTS5 virtual table and its sync triggers are raw SQL
> inside the init migration, and `migrate dev`'s drift detection would offer to
> drop them. See `prisma/README.md` for details.

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (`.next/standalone`) |
| `npm start` | Run the production build locally |
| `npm test` | Unit + property tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run prisma:migrate:deploy` | Apply DB migrations |

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `file:../data/lexical.db` (relative to `prisma/`) | SQLite database location |
| `UPLOADS_DIR` | `uploads/` | Directory for image originals + thumbnails |
| `PORT` | `3000` | Server port |

## Deployment (Docker)

The app ships as a multi-stage Docker image and a Compose file for single-command
startup. The image is built with `output: 'standalone'`, runs as a non-root
user, applies database migrations on startup, and exposes a health check.

### Quick start

```bash
docker compose up -d --build
```

Then open <http://localhost:3000>. Check status (including health) with:

```bash
docker compose ps
curl -i http://localhost:3000/api/health   # 200 + {"status":"ok","database":"up"}
```

Stop the app (data is **kept** — named volumes are not removed):

```bash
docker compose down
```

### Configurable port

The container always listens on `3000` internally; the published host port is
configurable via the `PORT` variable (default `3000`):

```bash
PORT=8080 docker compose up -d        # app reachable on http://localhost:8080
```

By default the port is published on `127.0.0.1` only (loopback), matching the
security posture below. To expose it on a LAN/trusted network, set
`BIND_HOST=0.0.0.0` — but only behind the access controls described below:

```bash
BIND_HOST=0.0.0.0 PORT=8080 docker compose up -d
```

### Persistent data (volumes)

All mutable state lives in two **named volumes**, so it survives container
restarts, rebuilds, and `docker compose down`:

| Volume | Mounted at | Holds |
|--------|-----------|-------|
| `lexical_data` | `/app/data` | The SQLite database file (`lexical.db`) |
| `lexical_uploads` | `/app/uploads` | Uploaded image originals + thumbnails |

Data persists across `docker compose restart` and `docker compose down`. It is
only deleted if you explicitly run `docker compose down -v`.

Per **NFR 4.3**, the SQLite database file lives in the volume-mounted `data/`
directory and is **never served by the web server** — images are streamed
through an API route that only resolves basenames inside `uploads/`, so the
database file and arbitrary filesystem paths are unreachable over HTTP.

### Health check

The container's health is wired to `GET /api/health`, which returns `200`
(`{"status":"ok","database":"up"}`) when the database connection is alive and
`503` otherwise. Both the image `HEALTHCHECK` and the Compose `healthcheck`
probe it with Node's built-in `fetch` (no `curl`/`wget` needed in the slim
image). Orchestrators can use it to gate readiness and restarts.

### How startup works

1. The entrypoint (`docker-entrypoint.sh`) ensures `/app/data` and
   `/app/uploads` exist.
2. It applies pending migrations with `prisma migrate deploy` against the
   mounted SQLite database (creating it on first run).
3. It execs the Next.js standalone server (`node server.js`) as PID 1.

## Security posture — READ THIS BEFORE EXPOSING IT

**This application has NO authentication and NO authorization. By design
(decision Q16), it is a single-user tool.** There are no accounts, passwords,
sessions, or access controls of any kind.

**Anyone who can reach the app over the network has full read/write/delete
access to the entire collection** — they can create, edit, and permanently
delete entries, categories, and uploaded images.

Therefore:

- **Run it on `localhost` or a trusted private network only.** The default
  Compose configuration publishes the port on `127.0.0.1` (loopback) precisely
  to avoid accidental network exposure.
- **Do NOT expose it directly to the public internet.** If you need remote
  access, put it behind one of the following:
  - **A reverse proxy with authentication** — e.g. nginx, Caddy, or Traefik
    enforcing HTTP Basic Auth, OAuth/OIDC (e.g. oauth2-proxy), or mTLS in front
    of the container. Point the proxy at the container's port and keep the
    container itself bound to loopback.
  - **A VPN** (e.g. WireGuard/Tailscale) so the app is only reachable inside the
    private network.
  - **Firewall rules** restricting access to specific trusted source IPs.

#### Example: nginx reverse proxy with Basic Auth

```nginx
# /etc/nginx/sites-available/lexical
server {
    listen 443 ssl;
    server_name lexical.example.internal;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        auth_basic           "Lexical Resources";
        auth_basic_user_file /etc/nginx/.htpasswd;   # created via `htpasswd`
        proxy_pass           http://127.0.0.1:3000;  # container bound to loopback
        proxy_set_header     Host $host;
        proxy_set_header     X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header     X-Forwarded-Proto $scheme;
    }
}
```

Keep the container published on loopback (the default) and let only the proxy
talk to it.

## Project layout

```
src/app/        Next.js App Router (pages + API route handlers)
src/components/  UI components (sidebar, views, editor, ...)
src/lib/         DB client, search, markdown, images, validation, export
prisma/          schema.prisma + migrations (incl. raw-SQL FTS5)
scripts/         HTML -> JSON migration + JSON import tooling
data/            SQLite database file (volume-mounted at runtime)
uploads/         Image originals + thumbnails (volume-mounted at runtime)
htmls/           Legacy static site (reference only; excluded from the image)
```

## License

Personal project. No license granted for redistribution.
