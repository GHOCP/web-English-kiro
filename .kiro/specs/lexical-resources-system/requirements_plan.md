# Requirements Plan — Lexical Resources System

## Overview

This plan outlines the steps to produce a complete requirements document for reconstructing the current vanilla HTML/CSS/JS English vocabulary collection website into a modern interactive lexical resources system.

---

## Steps

- [x] **Step 1: Define System Scope & Glossary**
  - Identify all system actors, components, and key terms
  - Define the boundary between the new system and external services

- [x] **Step 2: Clarify Data Model & Migration**
  - Define lexical resource data structure (entries, categories, genres)
  - Determine how existing inline HTML data will be migrated

- [x] **Step 3: Define Core Functional Requirements**
  - Viewing resources (browse, filter, search)
  - CRUD operations (add, edit, delete entries and categories)
  - Navigation and category management

- [x] **Step 4: Define Content Structure Requirements**
  - Preserve existing category hierarchy (Vocabulary, Accretion, Speaking, Writing)
  - Support bilingual English-Chinese content
  - Support rich entry fields (pronunciation, definitions, examples, images)

- [x] **Step 5: Define User Interface Requirements**
  - Layout and responsive design
  - Navigation patterns
  - Interactive features (search, filter, sort)

- [x] **Step 6: Define Non-Functional Requirements**
  - Performance, scalability, accessibility, security

- [x] **Step 7: Review & Finalize**
  - Validate all requirements against EARS patterns and INCOSE rules
  - Confirm completeness with user

---

## Questions

### Data & Architecture

**[Question 1]** What technology stack should the new system use?

[b] Options:
- A) **Next.js (React) + PostgreSQL + Prisma ORM** — Full-stack framework with SSR, good for SEO and content-heavy sites
- B) **Next.js (React) + SQLite (local file DB)** — Simpler deployment, single-user friendly, no separate DB server needed
- C) **Vue.js (Nuxt) + PostgreSQL** — Alternative frontend framework with similar capabilities
- D) *(Alternative)* **Astro + SQLite** — Lightweight, content-focused static-first framework with islands architecture

User choice: **B**

---

**[Question 2]** Is this system single-user (personal tool) or multi-user?

[a] Options:
- A) **Single-user** — Only the owner manages and views the collection (no auth needed)
- B) **Single-user with public read** — Owner manages, anyone can view (simple auth for admin)
- C) **Multi-user** — Multiple users can register and manage their own collections

User choice: **A**

---

**[Question 3]** Where should the system be deployed/hosted?

[d] Options:
- A) **Local only** — Runs on localhost for personal use
- B) **Vercel / Netlify** — Cloud-hosted, accessible from anywhere
- C) **Self-hosted VPS** — Full control, custom domain
- D) *(Alternative)* **Docker container** — Portable, can run anywhere

User choice: **D**

---

### Content & Data

**[Question 4]** Should the existing ~20 pages of vocabulary data be migrated automatically into the database, or manually re-entered?

[b] Options:
- A) **Automated migration** — Parse existing HTML tables and import into database programmatically
- B) **Semi-automated** — Script extracts data to JSON/CSV, user reviews, then imports
- C) **Manual entry** — User re-enters data through the new UI (not recommended given volume)

User choice: **B**

---

**[Question 5]** Should the system support images (e.g., the food/bicycle images in "Words by genres")?

[a] Options:
- A) **Yes, with file upload** — Users can upload images that are stored locally or in cloud storage
- B) **Yes, URL references only** — Store image URLs, images hosted externally
- C) **Yes, both upload and URL** — Support both methods
- D) *(Alternative)* **No image support initially** — Text-only MVP, add images later

User choice: **A**

---

**[Question 6]** The current site has a fixed category hierarchy. Should the new system allow dynamic category/subcategory creation?

[a] Options:
- A) **Fully dynamic** — Users can create, rename, reorder, nest categories freely
- B) **Semi-dynamic** — Top-level categories are fixed (Vocabulary, Accretion, Speaking, Writing), subcategories are dynamic
- C) **Fixed structure** — Keep the exact same hierarchy, only entries are editable

User choice: **A**

---

### User Interface

**[Question 7]** Should the system preserve the current 3-column layout (nav | TOC | content), or adopt a different layout?

[b] Options:
- A) **Preserve 3-column** — Keep the familiar layout with modern styling
- B) **Responsive sidebar** — Collapsible nav sidebar + main content area, TOC as floating/sticky element
- C) **Dashboard style** — Card-based overview with drill-down into categories
- D) *(Alternative)* **Hybrid** — Dashboard for overview, 3-column for reading/editing

User choice: **B**

---

**[Question 8]** What search/filter capabilities are needed?

[d] Options:
- A) **Basic search** — Search by word/term across all categories
- B) **Advanced search** — Search by word, meaning, category, with filters and sorting
- C) **Full-text search** — Search across all fields including definitions and examples, with fuzzy matching
- D) *(Alternative)* **Basic search MVP** — Start with A, plan for C in future iterations

User choice: **D**

---

### Non-Functional Requirements

**[Question 9]** What are the performance expectations?

[a] Options:
- A) **Fast local experience** — Page loads < 500ms, instant search results (suitable for < 10,000 entries)
- B) **Scalable** — Optimized for potentially 50,000+ entries with pagination and lazy loading
- C) **Balanced** — Good performance for current data size (~5,000 entries) with room to grow

User choice: **A**

---

**[Question 10]** Is offline access important?

[c] Options:
- A) **Yes** — PWA with service worker, full offline reading capability
- B) **Partial** — Cache recently viewed pages for offline reading
- C) **No** — Online-only is acceptable

User choice: **C**

---

**[Question 11]** Should the system support data export/backup?

[b] Options:
- A) **Yes, JSON export** — Export entire collection as structured JSON
- B) **Yes, multiple formats** — Export as JSON, CSV, and/or Markdown
- C) **Yes, with import** — Both export and import (for backup/restore and sharing)
- D) *(Alternative)* **Database backup only** — Rely on DB backup mechanisms

User choice: **B**

---

## Approval

- [x] Plan reviewed and approved by user
- [x] All questions answered
- [x] Ready to proceed with requirements document

---

*After approval, each step will be executed and the requirements document will be generated at `.kiro/specs/lexical-resources-system/requirements.md`.*
