# Design Plan — Lexical Resources System

## Overview

This plan outlines the steps to produce the technical design document (`design.md`) for the Lexical Resources System. The requirements are already approved (see `requirements.md`). The high-level stack was fixed during requirements (Next.js + React + SQLite, Docker deployment, single-user, semi-automated migration, image upload, responsive sidebar, basic search MVP, multi-format export).

This design phase focuses on **how** to implement those requirements. The questions below surface key design decisions that I should NOT decide alone. Please answer them so the design reflects your intent.

> **Note:** A first draft of `design.md` was generated previously. After you approve this plan and answer the questions, I will regenerate `design.md` to match your decisions.

> **Round 1 questions (1–11): ANSWERED.** Round 2 questions (12–18): **ANSWERED.** All decisions resolved — ready to regenerate `design.md`.

---

## Steps

- [ ] **Step 1: Confirm Technical Foundation & Libraries**
  - ORM, styling system, data-fetching/state approach, testing stack
  - (Driven by Questions 1–4, 11)

- [ ] **Step 2: Define Data Model**
  - Entity-relationship design (Category tree, Entry, Definition, Example, Image, ThesaurusGroup)
  - Decide normalization granularity and how bilingual content is stored
  - (Driven by Questions 5, 6, 12, 13)

- [ ] **Step 3: Define UI/UX & Visual Design**
  - Layout structure (sidebar + TOC + content)
  - Visual style (preserve original dark aesthetic vs modern theme)
  - Edit experience (inline vs modal vs dedicated pages)
  - (Driven by Questions 7, 8, 14, 17)

- [ ] **Step 4: Define Search Design**
  - Indexing and query strategy for the MVP
  - (Driven by Question 9)

- [ ] **Step 5: Define Migration Pipeline**
  - How existing HTML tables are parsed, reviewed, and imported
  - (Driven by Questions 10, 13)

- [ ] **Step 6: Define Image Handling**
  - Upload, validation, storage, thumbnail strategy, serving
  - (Driven by Questions 8, 15)

- [ ] **Step 7: Define Export Design**
  - JSON / CSV / Markdown serialization structure

- [ ] **Step 8: Define Deployment & Infrastructure**
  - Dockerfile, docker-compose, volumes, health checks, migrations on startup
  - (Driven by Question 16)

- [ ] **Step 9: Define Testing Strategy & Correctness Properties**
  - Unit / integration / E2E approach and property-based tests
  - (Driven by Question 11)

- [ ] **Step 10: Review & Finalize**
  - Validate design against all requirements
  - Confirm completeness with user

---

## Questions

### Round 1 — Foundation & Libraries

**[Question 1]** Which ORM / database toolkit should the design specify for SQLite access?

**[Answer]**
- A) **Prisma** — Mature, type-safe, great DX, built-in migrations (recommended)
- B) **Drizzle ORM** — Lighter weight, SQL-like, smaller runtime, fast
- C) **better-sqlite3 (raw queries)** — Maximum control, minimal abstraction
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Prisma**

---

**[Question 2]** What styling approach should the UI use?

**[Answer]**
- A) **Tailwind CSS** — Utility-first, fast to build, responsive helpers (recommended)
- B) **CSS Modules** — Scoped plain CSS, closest to the original styling approach
- C) **styled-components / CSS-in-JS** — Component-scoped dynamic styles
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Tailwind CSS**

---

**[Question 3]** How should the app fetch data and manage client state?

**[Answer]**
- A) **Server Components + SWR for client interactivity** — SSR for reads, SWR caching for dynamic bits (recommended)
- B) **Server Components + TanStack Query (React Query)** — Richer client caching/mutation tooling
- C) **Server Components only + Server Actions** — Minimal client JS, Next.js-native mutations
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Server Components + SWR**

---

**[Question 4]** The requirements mention performance targets. Should the design rely primarily on server-side rendering, or build a more client-heavy SPA feel?

**[Answer]**
- A) **SSR-first with client routing** — Fast first paint, SEO-friendly, snappy nav (recommended)
- B) **Mostly client-side (SPA)** — Heavier initial load, very interactive afterward
- C) **Static generation where possible + dynamic for edits** — Pre-render read views
- D) *(Alternative — fill in your own)*: ___

User choice: **A — SSR-first with client routing**

---

### Round 1 — Data Model

**[Question 5]** How should definitions and examples be stored per entry? Your source data often has multiple numbered definitions and bilingual examples per word.

**[Answer]**
- A) **Fully normalized** — Separate `Definition` and `Example` tables with ordering and English/Chinese fields (recommended; preserves structure, best for CSV export)
- B) **Single rich-text/markdown field per entry** — Simpler, flexible, but harder to query/export structurally
- C) **JSON column on Entry** — Store definitions/examples as a JSON blob; flexible, moderate queryability
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Fully normalized**

---

**[Question 6]** How should bilingual (English/Chinese) text be modeled?

**[Answer]**
- A) **Separate `textEn` / `textZh` fields** — Clean separation, enables language-specific display/export (recommended)
- B) **Single mixed text field** — Matches the existing data where EN and ZH are often combined in one cell; simpler migration, less structure
- C) **Single field + auto-detect/split on migration** — Attempt to split, fall back to mixed
- D) *(Alternative — fill in your own)*: ___

User choice: **B — Single mixed text field**

> **Resolution note (Q5 + Q6):** Combining these, the normalized `Definition` and `Example` tables will each carry a **single mixed-language `text` field** (plus `partOfSpeech` and `displayOrder` on definitions) rather than separate `textEn`/`textZh` columns. See **Question 13** for how formatting within that text is preserved.

---

### Round 1 — UI / UX & Visual Design

**[Question 7]** What visual style should the new UI adopt? The current site has a distinctive **black sidebar** with colored category labels (red Vocabulary, purple Accretion, green Speaking, blue Writing).

**[Answer]**
- A) **Preserve the identity** — Keep the dark sidebar + colored category accents, modernized and responsive (recommended)
- B) **Modern light theme** — Fresh clean look, light sidebar, new color system
- C) **Light + dark mode toggle** — Support both, default to one
- D) *(Alternative — fill in your own)*: ___

User choice: **C — Light + dark mode toggle** (see Question 14 for default & identity)

---

**[Question 8]** What editing experience do you prefer for adding/editing entries and categories?

**[Answer]**
- A) **Inline editing** — Edit in place within the content view (fast, fluid, but more complex)
- B) **Modal/drawer forms** — Click to open a form overlay for create/edit (recommended; clean and simple)
- C) **Dedicated edit pages** — Separate routes like `/entry/:id/edit` (most traditional, simplest to build)
- D) *(Alternative — fill in your own)*: ___

User choice: **B — Modal/drawer forms**

---

### Round 1 — Search

**[Question 9]** What should the MVP search implementation use? (Requirements say basic search now, full-text/fuzzy later.)

**[Answer]**
- A) **SQLite FTS5 from the start** — Fast full-text indexing, easy path to future fuzzy search (recommended)
- B) **Simple `LIKE %query%` on the word field** — Minimal, easy, fine for small collections; upgrade later
- C) **In-memory client-side search (e.g., Fuse.js)** — Load entries client-side, fuzzy match instantly (good for small data)
- D) *(Alternative — fill in your own)*: ___

User choice: **A — SQLite FTS5**

---

### Round 1 — Migration

**[Question 10]** How automated should the migration of the existing ~20 HTML pages be? (Requirements chose "semi-automated".)

**[Answer]**
- A) **Script extracts to JSON → you review/edit → import command** — Balanced, you control quality (recommended; matches requirement Q4=B)
- B) **Best-effort full auto-import** — Faster, but imports noise/empty cells without review
- C) **Script generates an editable spreadsheet (CSV) for review, then import** — Review in a familiar tool
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Extract to JSON → review → import**

---

### Round 1 — Testing

**[Question 11]** What testing stack should the design specify?

**[Answer]**
- A) **Vitest + fast-check (PBT) + Playwright (E2E)** — Modern, fast, great TS support (recommended)
- B) **Jest + fast-check + Cypress** — Established, widely documented
- C) **Vitest only (unit/integration), defer E2E** — Lighter, add E2E later
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Vitest + fast-check + Playwright**

---

## Round 2 — Follow-up Questions (please answer)

These arose from your Round 1 answers and from details in the existing site. I should not decide these alone.

### Data Model

**[Question 12]** In the source, the **Thesaurus** page is organized as part-of-speech (`<h1>` V./N./ADJ.) → semantic label (`<h2>` e.g. "刺激。激发") → table of synonyms. Since you chose a **fully dynamic, nestable category tree** (requirement R1), how should thesaurus groups be modeled?

**[a]**
- A) **Reuse the Category tree** — A thesaurus group is just a category with `viewType = "thesaurus"`; semantic labels become nested categories. Simplest, one unified model, fewer tables (recommended)
- B) **Separate `ThesaurusGroup` entity** — A dedicated table distinct from categories, linked to entries. More explicit, but adds a parallel hierarchy
- C) **Tag-based** — Entries get free-form tags; a "group" is just a tag query. Most flexible, less structured
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Reuse the Category tree** (thesaurus group = category with `viewType="thesaurus"`; semantic labels become nested categories)

---

**[Question 13]** The source content contains inline formatting inside cells: line breaks (`<br>`), **bold** words, and occasional nested lists (e.g. numbered senses "1. … 2. …"). How should this formatting be preserved in the stored `text` fields?

**[a]**
- A) **Markdown** — Store text as Markdown (line breaks, bold, lists); render with a sanitizing Markdown renderer. Portable, clean, good for Markdown export (recommended)
- B) **Plain text only** — Strip formatting to plain text; simplest but loses bold/structure from the source
- C) **Sanitized limited HTML** — Allow a safe subset of HTML (`<br>`, `<b>`, `<ul>`); closest to source, but heavier to sanitize
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Markdown** (stored as Markdown, rendered with a sanitizing Markdown renderer)

---

### UI / Visual

**[Question 14]** Since you chose a **light + dark toggle (Q7=C)**, two sub-decisions:
(a) Which mode is the **default** on first load?
(b) Should **dark mode preserve the original identity** (black sidebar + red/purple/green/blue category accents)?

**[b]**
- A) **Default dark**, and dark mode preserves the original black-sidebar + colored-accent identity; light mode is a clean variant (recommended)
- B) **Default light** (clean modern), with dark mode as the identity-preserving variant
- C) **Follow OS preference** by default; both modes use a fresh unified palette (don't specifically replicate the old look)
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Default dark; dark mode preserves the original black-sidebar + colored-accent identity; light mode is a clean variant**

---

**[Question 15]** For uploaded images (food, bicycle parts, etc.), how should display sizing be handled?

**[b]**
- A) **Generate thumbnails on upload with Sharp** — Store original + a small thumbnail; fast grid rendering, more storage/processing (recommended for grids with many images)
- B) **Store originals only, scale with CSS** — Simplest, no extra processing; larger payloads in image-heavy grids
- C) **Store originals + generate thumbnails lazily/on-demand** — Balance, slightly more complex
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Generate thumbnails on upload with Sharp** (store original + small thumbnail)

---

**[Question 17]** Some categories (e.g. the Thesaurus verb section) have 80+ groups and hundreds of entries. How should large category/content views render?

**[a]**
- A) **Render all + virtualized scrolling** — Everything on one scrollable page (like the original), virtualization keeps it fast (recommended; matches the original reading experience)
- B) **Paginate** — Break large categories into pages
- C) **Lazy-load on scroll (infinite scroll)** — Load more as you scroll
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Render all + virtualized scrolling** (single scrollable page, virtualization keeps it fast)

---

### Data Lifecycle

**[Question 18]** Requirement R1.5 says deleting a category should prompt to reassign or delete its entries. What should the **default** deletion behavior be?

**[a]**
- A) **Prompt with a choice each time** — Reassign entries to a chosen category, OR cascade-delete them (explicit confirmation) (recommended)
- B) **Block deletion of non-empty categories** — Must move/delete entries first; safest
- C) **Always cascade-delete** entries with the category after one confirmation — simplest, most destructive
- D) *(Alternative — fill in your own)*: ___

User choice: **A — Prompt with a choice each time** (reassign entries to a chosen category, OR cascade-delete, with explicit confirmation)

---

### Deployment / Security

**[Question 16]** The app is single-user with **no authentication** (requirement Q2=A), but you also chose **Docker deployment** which can be exposed beyond localhost. How should access be handled?

> ⚠️ Security note: An unauthenticated app reachable on a network lets anyone read/edit/delete your collection. I want your explicit decision here rather than assuming.

**[a]**
- A) **No app-level auth; intended for localhost/trusted-network only** — Document that exposing it publicly requires the owner to add a reverse-proxy/network protection (recommended given single-user scope)
- B) **Optional single password via env var** — If `APP_PASSWORD` is set, gate the app behind a simple login; otherwise open. Safer if ever exposed
- C) **Always require a password** — Even locally
- D) *(Alternative — fill in your own)*: ___

User choice: **A — No app-level auth; intended for localhost/trusted-network only** (documented that public exposure requires owner-added reverse-proxy/network protection)

---

## Approval

- [x] Plan reviewed and approved by user
- [x] All questions answered (Round 1 done; Round 2 = Q12–Q18 answered)
- [x] Ready to proceed with design document

---

*After approval, each step will be executed and `design.md` will be regenerated at `.kiro/specs/lexical-resources-system/design.md` to reflect your decisions.*
