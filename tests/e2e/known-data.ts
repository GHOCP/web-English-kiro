// Known E2E dataset constants (Task 20).
//
// The stable words / labels the seed inserts and the specs assert against.
// Kept in a Prisma-free module so the specs can import them without pulling the
// Prisma client into the test bundle (only seed.ts / global-setup.ts need that).
export const KNOWN = {
  vocabulary: 'Vocabulary',
  accretion: 'Accretion',
  // A plain "list" category and its entries.
  generalCategory: 'General',
  // Entry that search must find and that the search spec clicks through to.
  searchWord: 'provoke',
  // A second entry in General used as the delete target so deleting it never
  // affects the other flows.
  deletableWord: 'ephemeral',
  // Thesaurus group + member.
  thesaurusGroupLabel: '刺激。激发',
  thesaurusMember: 'incite',
  // Genre (Food) entry.
  genreWord: 'broccoli',
  // A word the create flow will add (must NOT already exist in General).
  newWord: 'serendipity',
} as const;
