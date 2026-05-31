-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "viewType" TEXT NOT NULL DEFAULT 'list',
    "partOfSpeech" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "word" TEXT NOT NULL,
    "pronunciation" TEXT,
    "categoryId" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL DEFAULT 'word',
    "notes" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Definition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Definition_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Example" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Example_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Image" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "thumbnailFilename" TEXT NOT NULL,
    "altText" TEXT,
    "fileSize" INTEGER NOT NULL,
    CONSTRAINT "Image_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Category_displayOrder_idx" ON "Category"("displayOrder");

-- CreateIndex
CREATE INDEX "Entry_categoryId_idx" ON "Entry"("categoryId");

-- CreateIndex
CREATE INDEX "Entry_word_idx" ON "Entry"("word");

-- CreateIndex
CREATE INDEX "Entry_displayOrder_idx" ON "Entry"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_word_categoryId_key" ON "Entry"("word", "categoryId");

-- CreateIndex
CREATE INDEX "Definition_entryId_idx" ON "Definition"("entryId");

-- CreateIndex
CREATE INDEX "Example_entryId_idx" ON "Example"("entryId");

-- CreateIndex
CREATE INDEX "Image_entryId_idx" ON "Image"("entryId");

-- ---------------------------------------------------------------------------
-- Full-text search (FTS5)
-- ---------------------------------------------------------------------------
-- Prisma cannot model FTS5 virtual tables, so they are created here via raw
-- SQL. "EntryFts" indexes each entry's `word` plus the concatenated text of all
-- its definitions. The table's rowid mirrors "Entry"."id" so search results map
-- straight back to entries. The Search API (Task 10) uses MATCH against this
-- table with a LIKE fallback when FTS5 is unavailable. (Requirements 6.5, 3.1)
CREATE VIRTUAL TABLE "EntryFts" USING fts5(
    word,
    definitions,
    tokenize = 'unicode61'
);

-- ---------------------------------------------------------------------------
-- Sync triggers — keep "EntryFts" consistent with "Entry" and "Definition".
-- The definitions column is always recomputed from the current rows so the
-- index can never drift from the source tables (NFR 3.3).
-- ---------------------------------------------------------------------------

-- Entry inserted: add a matching FTS row (definitions filled in as they arrive).
CREATE TRIGGER "Entry_ai_fts" AFTER INSERT ON "Entry" BEGIN
    INSERT INTO "EntryFts"("rowid", "word", "definitions")
    VALUES (
        new."id",
        new."word",
        COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = new."id"), '')
    );
END;

-- Entry deleted: drop its FTS row.
CREATE TRIGGER "Entry_ad_fts" AFTER DELETE ON "Entry" BEGIN
    DELETE FROM "EntryFts" WHERE "rowid" = old."id";
END;

-- Entry updated: rebuild its FTS row (delete + insert is the FTS5-safe pattern).
CREATE TRIGGER "Entry_au_fts" AFTER UPDATE ON "Entry" BEGIN
    DELETE FROM "EntryFts" WHERE "rowid" = old."id";
    INSERT INTO "EntryFts"("rowid", "word", "definitions")
    VALUES (
        new."id",
        new."word",
        COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = new."id"), '')
    );
END;

-- Definition inserted: refresh the owning entry's concatenated definition text.
CREATE TRIGGER "Definition_ai_fts" AFTER INSERT ON "Definition" BEGIN
    UPDATE "EntryFts"
    SET "definitions" = COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = new."entryId"), '')
    WHERE "rowid" = new."entryId";
END;

-- Definition deleted: refresh the owning entry's concatenated definition text.
CREATE TRIGGER "Definition_ad_fts" AFTER DELETE ON "Definition" BEGIN
    UPDATE "EntryFts"
    SET "definitions" = COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = old."entryId"), '')
    WHERE "rowid" = old."entryId";
END;

-- Definition updated: refresh both the previous and the (possibly new) owner.
CREATE TRIGGER "Definition_au_fts" AFTER UPDATE ON "Definition" BEGIN
    UPDATE "EntryFts"
    SET "definitions" = COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = old."entryId"), '')
    WHERE "rowid" = old."entryId";
    UPDATE "EntryFts"
    SET "definitions" = COALESCE((SELECT group_concat("text", ' ') FROM "Definition" WHERE "entryId" = new."entryId"), '')
    WHERE "rowid" = new."entryId";
END;
