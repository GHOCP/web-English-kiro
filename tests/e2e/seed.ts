// Deterministic seed for the Playwright E2E run (Task 20).
//
// The E2E suite needs a known, isolated dataset so the create / edit / delete /
// search / navigate / theme / export flows are reproducible and never depend on
// (or mutate) the developer's real `data/lexical.db`. This module:
//
//   1. is pointed at an EPHEMERAL SQLite file via DATABASE_URL (set by the
//      Playwright global setup before this runs);
//   2. seeds a small but representative collection that exercises every flow:
//        - a top-level "list" category with a couple of entries (search +
//          navigate + delete targets);
//        - a Vocabulary → Thesaurus group (viewType="thesaurus") with a
//          part-of-speech sub-category and a semantic-label group + entries;
//        - an Accretion → Food (viewType="genre") category with an entry;
//      which together give the export formats real nested structure to emit.
//
// It is intentionally idempotent-ish for a FRESH database: it assumes the temp
// DB has just been migrated and is empty. The exported `KNOWN` constants are
// re-used by the specs so selectors/assertions stay in lock-step with the data.
//
// Run indirectly via `globalSetup` (see global-setup.ts) — not as a spec.
import { PrismaClient } from '@prisma/client';
import { KNOWN } from './known-data';

export { KNOWN } from './known-data';

/**
 * Seed the database behind `prisma` with the known E2E dataset. Safe to call
 * once against a freshly-migrated, empty temp database.
 */
export async function seedE2eDatabase(prisma: PrismaClient): Promise<void> {
  // --- Vocabulary (root) -------------------------------------------------
  const vocabulary = await prisma.category.create({
    data: { name: KNOWN.vocabulary, viewType: 'list', displayOrder: 0 },
  });

  // General "list" category under Vocabulary with two entries.
  const general = await prisma.category.create({
    data: {
      name: KNOWN.generalCategory,
      parentId: vocabulary.id,
      viewType: 'list',
      displayOrder: 0,
    },
  });

  await prisma.entry.create({
    data: {
      word: KNOWN.searchWord,
      pronunciation: '/prəˈvəʊk/',
      categoryId: general.id,
      entryType: 'word',
      displayOrder: 0,
      definitions: {
        create: [{ text: 'to deliberately annoy or anger 激怒', displayOrder: 0 }],
      },
      examples: {
        create: [{ text: 'Do not **provoke** the dog. 不要激怒那只狗。', displayOrder: 0 }],
      },
    },
  });

  await prisma.entry.create({
    data: {
      word: KNOWN.deletableWord,
      pronunciation: '/ɪˈfem(ə)rəl/',
      categoryId: general.id,
      entryType: 'word',
      displayOrder: 1,
      definitions: {
        create: [{ text: 'lasting for a very short time 短暂的', displayOrder: 0 }],
      },
    },
  });

  // --- Thesaurus group (viewType="thesaurus") ----------------------------
  // Vocabulary → Thesaurus (root group) → Verbs (part-of-speech) →
  // semantic-label group with a member entry.
  const thesaurus = await prisma.category.create({
    data: {
      name: 'Thesaurus',
      parentId: vocabulary.id,
      viewType: 'thesaurus',
      displayOrder: 1,
    },
  });
  const verbs = await prisma.category.create({
    data: {
      name: 'Verbs',
      parentId: thesaurus.id,
      viewType: 'thesaurus',
      partOfSpeech: 'V',
      displayOrder: 0,
    },
  });
  const stimulateGroup = await prisma.category.create({
    data: {
      name: KNOWN.thesaurusGroupLabel,
      parentId: verbs.id,
      viewType: 'thesaurus',
      displayOrder: 0,
    },
  });
  await prisma.entry.create({
    data: {
      word: KNOWN.thesaurusMember,
      pronunciation: '/ɪnˈsʌɪt/',
      categoryId: stimulateGroup.id,
      entryType: 'word',
      displayOrder: 0,
      definitions: {
        create: [{ text: 'to encourage or stir up 煽动', displayOrder: 0 }],
      },
    },
  });

  // --- Accretion → Food (viewType="genre") -------------------------------
  const accretion = await prisma.category.create({
    data: { name: KNOWN.accretion, viewType: 'list', displayOrder: 1 },
  });
  const food = await prisma.category.create({
    data: {
      name: 'Food',
      parentId: accretion.id,
      viewType: 'genre',
      displayOrder: 0,
    },
  });
  await prisma.entry.create({
    data: {
      word: KNOWN.genreWord,
      categoryId: food.id,
      entryType: 'word',
      displayOrder: 0,
      definitions: {
        create: [{ text: 'a green vegetable 西兰花', displayOrder: 0 }],
      },
    },
  });
}
