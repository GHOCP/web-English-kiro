# Product

**Lexical Resources System** — a single-user web app for managing a bilingual
(English–Chinese) lexical collection. It replaces an older static HTML/CSS/JS
site, which is preserved under `htmls/` for reference only.

## Core capabilities

- Dynamic, nested categories with multiple view types: `list`, `thesaurus`,
  `genre`, `writing`, `speaking`.
- Full CRUD for entries (words, phrases, structures, expressions, speaking
  items) with Markdown definitions, examples, and notes. Content is mixed
  English/Chinese Markdown.
- Image uploads stored on the local filesystem, with Sharp-generated thumbnails.
- Full-text search backed by a SQLite FTS5 index, with a LIKE fallback.
- Multi-format export (JSON, CSV, Markdown).

## Important product constraints

- **Single-user by design. There is NO authentication or authorization.**
  Anyone who can reach the app has full read/write/delete access. Run it on
  localhost or a trusted private network only; never expose it directly to the
  public internet. When adding network-exposed surfaces, do not silently assume
  auth exists — flag the implication.
- The SQLite database file lives in `data/` and must **never** be served over
  HTTP. Images are streamed through an API route that resolves only basenames
  inside `uploads/`.
- Decisions are tracked against requirements/design (e.g. `Q16` = single-user,
  no-auth). When changing behavior, keep it consistent with the spec in
  `.kiro/specs/lexical-resources-system/`.
