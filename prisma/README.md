# Prisma schema, migrations & FTS5

This directory holds the data model (`schema.prisma`) and migration history for
the Lexical Resources System.

## Data model

Five models, exactly as specified in the design (`design.md` → "Data Models"):

- **Category** — self-referential tree (`parentId`), with `viewType`
  (`list | thesaurus | genre | writing | speaking`) and `partOfSpeech`. Thesaurus
  groups are just categories with `viewType="thesaurus"` (no separate entity).
- **Entry** — `word`, optional `pronunciation`, `categoryId`, `entryType`,
  Markdown `notes`. `@@unique([word, categoryId])` prevents duplicates within a
  category (NFR 3).
- **Definition** / **Example** — normalized child rows with a single
  mixed-language Markdown `text` field. Cascade-delete with their entry.
- **Image** — `filename` (original) + `thumbnailFilename` (Sharp-generated).
  Cascade-deletes with its entry.

Indexes: `Category.parentId`, `Category.displayOrder`, `Entry.categoryId`,
`Entry.word`, `Entry.displayOrder`, plus the unique `(word, categoryId)`.

## Full-text search (FTS5)

Prisma cannot model SQLite FTS5 virtual tables, so the `EntryFts` virtual table
and its sync triggers are created via **raw SQL appended to the init migration**
(`migrations/*_init/migration.sql`). `EntryFts` indexes each entry's `word` plus
the concatenated `text` of all its definitions; its `rowid` mirrors `Entry.id`.

Six triggers keep the index in sync automatically:

- `Entry_ai_fts` / `Entry_ad_fts` / `Entry_au_fts` — insert/delete/update of entries.
- `Definition_ai_fts` / `Definition_ad_fts` / `Definition_au_fts` — recompute an
  entry's concatenated definition text on any definition change.

## Migration workflow — IMPORTANT

Apply migrations with **`migrate deploy`**, never `migrate dev`:

```bash
npm run prisma:migrate:deploy   # prisma migrate deploy
```

`prisma migrate dev` runs drift detection and, because the FTS5 virtual table and
its shadow tables (`EntryFts`, `EntryFts_data`, …) are **not** declared in
`schema.prisma`, it will interactively offer to drop them. Use `migrate deploy`
for applying existing migrations (this is also what Docker startup and the test
harness use).

### Authoring a new migration

When you need to change the schema:

1. Edit `schema.prisma`.
2. Generate the migration SQL without applying it:
   ```bash
   npx prisma migrate dev --name <change> --create-only
   ```
3. If the change touches `Entry.word` or `Definition.text`, hand-edit any FTS5
   triggers in the generated SQL as needed.
4. Apply it with `npx prisma migrate deploy`.

If you must run `prisma db pull` / `migrate dev` for inspection, expect drift
warnings about the `EntryFts*` tables — that is normal and they must be kept.
