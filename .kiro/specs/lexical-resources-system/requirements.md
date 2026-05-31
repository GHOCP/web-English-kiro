# Requirements — Lexical Resources System

## Introduction

This document specifies the requirements for reconstructing the existing vanilla HTML/CSS/JS English vocabulary collection website into a modern interactive lexical resources system. The system will be built with Next.js (React) + SQLite, deployed via Docker, and designed as a single-user personal tool for managing a bilingual English-Chinese lexical collection.

## Glossary

| Term | Definition |
|------|-----------|
| Lexical Entry | A single vocabulary item containing a word/phrase, pronunciation, definitions, examples, and optional images |
| Category | A top-level organizational grouping (e.g., Vocabulary, Accretion, Speaking, Writing) |
| Subcategory | A nested grouping within a category (e.g., "Thesaurus" under Vocabulary) |
| Genre | A thematic grouping of words (e.g., Food, Sports, Politics) |
| Thesaurus Group | A collection of synonyms/related words organized by semantic meaning |
| Entry Field | An individual data attribute of a lexical entry (word, pronunciation, meaning, example, image) |
| Migration Script | An automated tool that extracts data from existing HTML files into structured format |

## Actors

| Actor | Description |
|-------|-------------|
| Owner | The single user who manages the entire lexical collection (no authentication required) |

## Existing System Structure

The current site contains ~20 HTML pages organized as follows:

**Vocabulary**
- A~Z (main index)
- Thesaurus (synonyms grouped by semantic meaning, ~81 verb groups, ~41 noun groups, ~72 adjective groups, plus collections)

**Accretion**
- Words by genres (food, games, politics, sports, etc. with images)
- Look-around (linguistic observations and idioms)

**Speaking**
- Scenes
- Daily

**Writing > Phrases**
- Except Verb/N, Verb_virtual, Noun_virtual, N_normal, V_normal, ADJ_normal

**Writing > Structure**
- Normal, Starting, Link_single word, Link_phrases

**Writing > Expressions**
- Topics, Excerpt, Asking, Normal

---

## Requirements

### Requirement 1: Dynamic Category Management

**User Story:** As the owner, I want to create, rename, reorder, and nest categories freely, so that I can organize my lexical collection in any structure I choose.

#### Acceptance Criteria

1. WHEN the owner creates a new category, THEN the system SHALL allow specifying a name, optional parent category, and display order.
2. WHEN the owner renames a category, THEN the system SHALL update the category name across all navigation and references.
3. WHEN the owner reorders categories, THEN the system SHALL persist the new display order and reflect it in navigation.
4. WHEN the owner nests a category under another, THEN the system SHALL support at least 3 levels of nesting depth.
5. WHEN the owner deletes a category, THEN the system SHALL prompt for confirmation and offer to reassign or delete contained entries.

---

### Requirement 2: Lexical Entry CRUD Operations

**User Story:** As the owner, I want to add, view, edit, and delete lexical entries, so that I can maintain and grow my vocabulary collection.

#### Acceptance Criteria

1. WHEN the owner creates a new entry, THEN the system SHALL accept: word/phrase (required), pronunciation (optional), one or more definitions with Chinese translations, example sentences (optional), and category assignment (required).
2. WHEN the owner edits an entry, THEN the system SHALL allow modification of all entry fields and save changes immediately.
3. WHEN the owner deletes an entry, THEN the system SHALL prompt for confirmation before permanent removal.
4. WHEN the owner views an entry, THEN the system SHALL display all populated fields in a readable format with clear visual hierarchy.
5. WHEN an entry belongs to a thesaurus group, THEN the system SHALL display related synonyms alongside the entry.

---

### Requirement 3: Bilingual Content Support

**User Story:** As the owner, I want to store and display both English and Chinese content for each entry, so that I can use the system as a bilingual learning tool.

#### Acceptance Criteria

1. THE system SHALL support UTF-8 encoding for all text fields to handle Chinese characters.
2. WHEN the owner enters a definition, THEN the system SHALL allow both English and Chinese text in the same field.
3. WHEN displaying entries, THEN the system SHALL render Chinese characters correctly alongside English text.
4. THE system SHALL support mixed-language content in example sentences and notes.

---

### Requirement 4: Image Upload and Management

**User Story:** As the owner, I want to upload and attach images to lexical entries, so that I can include visual references (e.g., food items, bicycle parts, tools).

#### Acceptance Criteria

1. WHEN the owner uploads an image, THEN the system SHALL accept JPEG, PNG, and WebP formats up to 5MB per file.
2. WHEN an image is uploaded, THEN the system SHALL store it locally in a designated uploads directory.
3. WHEN the owner attaches an image to an entry, THEN the system SHALL display a thumbnail in the entry view.
4. WHEN the owner removes an image from an entry, THEN the system SHALL delete the file from storage.
5. THE system SHALL migrate existing images from the current `img/` directories during data migration.

---

### Requirement 5: Responsive Sidebar Navigation

**User Story:** As the owner, I want a responsive layout with a collapsible sidebar and sticky table of contents, so that I can navigate efficiently on any screen size.

#### Acceptance Criteria

1. THE system SHALL display a collapsible navigation sidebar listing all categories and subcategories.
2. WHEN the viewport width is less than 768px, THEN the sidebar SHALL collapse to a hamburger menu.
3. THE system SHALL display a sticky/floating table of contents for the current page's sections.
4. WHEN the owner clicks a category in the sidebar, THEN the system SHALL navigate to that category's content view.
5. WHEN the owner scrolls through content, THEN the table of contents SHALL highlight the currently visible section.

---

### Requirement 6: Basic Search (MVP)

**User Story:** As the owner, I want to search by word or term across all categories, so that I can quickly find entries in my collection.

#### Acceptance Criteria

1. THE system SHALL provide a search input accessible from any page.
2. WHEN the owner types a search query, THEN the system SHALL search across word/phrase fields in all entries.
3. WHEN search results are found, THEN the system SHALL display matching entries with their category, word, and a snippet of the definition.
4. WHEN no results are found, THEN the system SHALL display a "no results" message.
5. THE system SHALL return search results within 200ms for collections up to 10,000 entries.

---

### Requirement 7: Semi-Automated Data Migration

**User Story:** As the owner, I want existing HTML vocabulary data extracted to a reviewable format and then imported, so that I can preserve my collection without manual re-entry.

#### Acceptance Criteria

1. THE system SHALL provide a migration script that parses existing HTML table structures from all ~20 pages.
2. WHEN the migration script runs, THEN it SHALL extract: word/phrase, pronunciation, definitions (English and Chinese), example sentences, and image references.
3. WHEN extraction completes, THEN the system SHALL output data as JSON files organized by source page.
4. WHEN the owner reviews and approves the extracted JSON, THEN the system SHALL provide an import command to load data into the SQLite database.
5. THE migration script SHALL handle the varying table structures across pages (2-column thesaurus tables, 3-column genre tables with images, simple definition tables).

---

### Requirement 8: Data Export in Multiple Formats

**User Story:** As the owner, I want to export my collection in JSON, CSV, and Markdown formats, so that I can back up my data and use it in other tools.

#### Acceptance Criteria

1. THE system SHALL provide export functionality accessible from the UI.
2. WHEN the owner exports as JSON, THEN the system SHALL produce a structured JSON file containing all entries with their full metadata and category hierarchy.
3. WHEN the owner exports as CSV, THEN the system SHALL produce a flat CSV with columns: word, pronunciation, definitions, examples, category, subcategory.
4. WHEN the owner exports as Markdown, THEN the system SHALL produce Markdown files organized by category, suitable for reading in any text editor.
5. WHEN exporting, THEN the system SHALL allow filtering by category or exporting the entire collection.

---

### Requirement 9: Thesaurus/Synonym Grouping

**User Story:** As the owner, I want to group related words by semantic meaning (synonyms/thesaurus), so that I can study and compare words with similar meanings.

#### Acceptance Criteria

1. THE system SHALL support creating thesaurus groups with a semantic label (e.g., "刺激。激发", "压制，压迫").
2. WHEN the owner adds entries to a thesaurus group, THEN the system SHALL display all group members together.
3. WHEN viewing a thesaurus group, THEN the system SHALL show each entry's word, pronunciation, and definition in a table format.
4. THE system SHALL support organizing thesaurus groups by part of speech (Verb, Noun, Adjective, Collection).
5. WHEN the owner views an entry that belongs to a thesaurus group, THEN the system SHALL provide a link to the full group view.

---

### Requirement 10: Genre-Based Organization with Visual Content

**User Story:** As the owner, I want to organize vocabulary by real-world genres (food, sports, politics, etc.) with supporting images, so that I can learn words in thematic context.

#### Acceptance Criteria

1. THE system SHALL support genre categories with subsections (e.g., Food > Vegetables, Food > Meat, Food > Seafood).
2. WHEN displaying genre entries, THEN the system SHALL show entries in a grid/table layout with word, meaning, and optional image.
3. THE system SHALL support multiple entries per row in genre views to maximize information density.
4. WHEN the owner creates a genre entry, THEN the system SHALL allow attaching an image directly to that entry.
5. THE system SHALL preserve the existing genre structure during migration (Food, Games, Politics, Sports, etc.).

---

### Requirement 11: Performance — Fast Local Experience

**User Story:** As the owner, I want pages to load quickly and search to feel instant, so that the system is pleasant to use for daily study.

#### Acceptance Criteria

1. THE system SHALL load any page within 500ms on localhost.
2. THE system SHALL return search results within 200ms for up to 10,000 entries.
3. THE system SHALL use SQLite with appropriate indexes for fast query performance.
4. THE system SHALL implement client-side caching for recently viewed categories.
5. WHEN navigating between categories, THEN the system SHALL use client-side routing to avoid full page reloads.

---

### Requirement 12: Docker Deployment

**User Story:** As the owner, I want to deploy the system as a Docker container, so that I can run it portably on any machine.

#### Acceptance Criteria

1. THE system SHALL provide a Dockerfile that builds a production-ready container image.
2. THE system SHALL provide a docker-compose.yml for easy single-command startup.
3. WHEN the container starts, THEN the system SHALL be accessible on a configurable port (default: 3000).
4. THE system SHALL persist SQLite database and uploaded images via Docker volumes.
5. THE system SHALL include health check endpoints for container orchestration.

---

### Requirement 13: Writing Phrases and Structure Management

**User Story:** As the owner, I want to manage writing-related content (phrases, sentence structures, expressions) in organized subcategories, so that I can reference them when writing.

#### Acceptance Criteria

1. THE system SHALL support the Writing category with subcategories: Phrases, Structure, and Expressions.
2. WHEN the owner creates a phrase entry, THEN the system SHALL accept: phrase/structure text, Chinese translation, usage context, and example sentences.
3. THE system SHALL support categorizing phrases by type (Verb phrases, Noun phrases, Adjective phrases, etc.).
4. THE system SHALL support sentence structure entries with pattern templates and multiple examples.
5. WHEN displaying writing content, THEN the system SHALL preserve the distinction between phrases, structures, and expressions.

---

### Requirement 14: Speaking Content Management

**User Story:** As the owner, I want to manage speaking-related content organized by scenes and daily situations, so that I can practice conversational English.

#### Acceptance Criteria

1. THE system SHALL support the Speaking category with subcategories: Scenes and Daily.
2. WHEN the owner creates a speaking entry, THEN the system SHALL accept: situation/scene description, dialogue or phrases, Chinese translation, and usage notes.
3. THE system SHALL support grouping speaking entries by situation type.
4. WHEN displaying speaking content, THEN the system SHALL present dialogues and phrases in a readable conversational format.

---

## Non-Functional Requirements

### NFR 1: Technology Stack

1. THE system SHALL be built with Next.js (React) for the frontend and server-side rendering.
2. THE system SHALL use SQLite as the database, stored as a local file.
3. THE system SHALL use a Node.js ORM (Prisma or Drizzle) for database access.
4. THE system SHALL not require any external database server.

### NFR 2: Accessibility

1. THE system SHALL use semantic HTML elements for content structure.
2. THE system SHALL support keyboard navigation for all interactive elements.
3. THE system SHALL maintain a minimum color contrast ratio of 4.5:1 for text content.
4. THE system SHALL provide appropriate ARIA labels for interactive components.

### NFR 3: Data Integrity

1. THE system SHALL validate all input data before writing to the database.
2. THE system SHALL use database transactions for operations that modify multiple records.
3. THE system SHALL prevent duplicate entries within the same category (same word + same category = duplicate).

### NFR 4: Security

1. THE system SHALL sanitize all user input to prevent XSS attacks.
2. THE system SHALL validate file uploads by checking MIME types and file size.
3. THE system SHALL not expose the SQLite database file via the web server.
