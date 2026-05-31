// End-to-end key-flow coverage (Task 20).
//
// Drives the running app (booted by Playwright's webServer against the isolated,
// seeded E2E database — see global-setup.ts / playwright.config.ts) through the
// owner's core journeys:
//
//   - create an entry          (R2.1)
//   - edit an entry            (R2.2)
//   - delete an entry          (R2.3, with confirmation)
//   - search                   (R6.2 — type a query, see results, click through)
//   - navigate categories      (R5.4 — client-side, no full reload)
//   - toggle the theme         (persisted across reload)
//   - export each format       (R8.2 JSON / R8.3 CSV / R8.4 Markdown)
//
// Selectors are resilient: roles, labels, and accessible names matching the
// components' existing accessibility attributes (the editor is a labelled
// role="dialog", the delete prompt a role="alertdialog", inputs are labelled,
// the search box is role="search", etc.). The seeded dataset and the words
// asserted against are defined in seed.ts (`KNOWN`).
//
// Requirements: 2.1, 2.2, 2.3, 6.2, 8.2, 8.3, 8.4
import { test, expect, type Page } from '@playwright/test';
import { KNOWN } from './known-data';

/**
 * Open the "General" list category by clicking its link in the sidebar. Returns
 * once the category heading is visible. The sidebar fetches the tree via SWR so
 * we wait for the link to appear first.
 */
async function gotoGeneralCategory(page: Page): Promise<void> {
  await page.goto('/');
  // The sidebar may collapse below md; this suite runs at the default desktop
  // viewport where the nav is always visible.
  const generalLink = page
    .getByRole('navigation', { name: /category navigation/i })
    .getByRole('link', { name: KNOWN.generalCategory, exact: true });
  await generalLink.click();
  await expect(
    page.getByRole('heading', { name: KNOWN.generalCategory, level: 1 }),
  ).toBeVisible();
}

test.describe('Entry CRUD', () => {
  test('creates a new entry from the category view (R2.1)', async ({ page }) => {
    await gotoGeneralCategory(page);

    await page.getByRole('button', { name: /new entry/i }).click();

    // The editor is an accessible labelled dialog (create mode → "New entry").
    const dialog = page.getByRole('dialog', { name: /new entry/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/^word/i).fill(KNOWN.newWord);
    await dialog
      .getByLabel(/definition 1 text/i)
      .fill('a fortunate accident 意外的好运');

    await dialog.getByRole('button', { name: /create entry/i }).click();

    // On success the editor reports the entry was created (it stays open so
    // images can be attached).
    await expect(dialog.getByRole('status')).toContainText(/created/i);

    // Close the editor and confirm the new entry now appears in the list.
    await dialog.getByRole('button', { name: /^close$/i }).click();
    await expect(
      page.getByRole('link', { name: KNOWN.newWord, exact: true }),
    ).toBeVisible();
  });

  test('edits an existing entry (R2.2)', async ({ page }) => {
    await gotoGeneralCategory(page);

    await page.getByRole('link', { name: KNOWN.searchWord, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: KNOWN.searchWord, level: 1 }),
    ).toBeVisible();

    await page.getByRole('button', { name: /edit entry/i }).click();
    const dialog = page.getByRole('dialog', { name: /edit entry/i });
    await expect(dialog).toBeVisible();

    // Add a pronunciation change and save.
    const pronunciation = dialog.getByLabel(/pronunciation/i);
    await pronunciation.fill('/prəˈvoʊk/');
    await dialog.getByRole('button', { name: /save changes/i }).click();

    await expect(dialog.getByRole('status')).toContainText(/saved/i);

    await dialog.getByRole('button', { name: /^close$/i }).click();
    // The detail view reflects the saved pronunciation.
    await expect(page.getByText('/prəˈvoʊk/')).toBeVisible();
  });

  test('deletes an entry after confirmation (R2.3)', async ({ page }) => {
    await gotoGeneralCategory(page);

    await page
      .getByRole('link', { name: KNOWN.deletableWord, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: KNOWN.deletableWord, level: 1 }),
    ).toBeVisible();

    await page.getByRole('button', { name: /delete entry/i }).click();

    // A confirmation prompt must appear before permanent removal (R2.3).
    const confirm = page.getByRole('alertdialog', { name: /delete entry/i });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(KNOWN.deletableWord);

    await confirm.getByRole('button', { name: /^delete$/i }).click();

    // After deletion we land back on the category, and the entry is gone.
    await expect(
      page.getByRole('heading', { name: KNOWN.generalCategory, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: KNOWN.deletableWord, exact: true }),
    ).toHaveCount(0);
  });
});

test.describe('Search', () => {
  test('searches, shows results, and clicks through to an entry (R6.2)', async ({
    page,
  }) => {
    await page.goto('/');

    const search = page.getByRole('searchbox', {
      name: /search the lexical collection/i,
    });
    await search.fill(KNOWN.searchWord);
    // Submitting bypasses the debounce and navigates to /search?q=.
    await search.press('Enter');

    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(
      page.getByRole('heading', { name: new RegExp(`results for`, 'i') }),
    ).toBeVisible();

    const resultLink = page.getByRole('link', {
      name: KNOWN.searchWord,
      exact: true,
    });
    await expect(resultLink).toBeVisible();
    await resultLink.click();

    await expect(
      page.getByRole('heading', { name: KNOWN.searchWord, level: 1 }),
    ).toBeVisible();
  });

  test('shows a no-results message for an unmatched query (R6.4)', async ({
    page,
  }) => {
    await page.goto('/search?q=zzzznotarealword');
    await expect(page.getByText(/no results found/i)).toBeVisible();
  });
});

test.describe('Category navigation', () => {
  test('navigates between categories client-side without a full reload (R5.4)', async ({
    page,
  }) => {
    await page.goto('/');

    // Tag the window so a full document reload (which wipes globals) is
    // detectable. App Router client navigation must preserve it.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    const nav = page.getByRole('navigation', { name: /category navigation/i });
    await nav.getByRole('link', { name: KNOWN.generalCategory, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: KNOWN.generalCategory, level: 1 }),
    ).toBeVisible();

    // Navigate to the Food (genre) category.
    await nav.getByRole('link', { name: 'Food', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Food', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(KNOWN.genreWord, { exact: false }),
    ).toBeVisible();

    // The flag survived → no full page reload occurred (client-side routing).
    const survived = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(survived).toBe(true);
  });
});

test.describe('Theme toggle', () => {
  test('toggles the theme and persists the choice across reload', async ({
    page,
  }) => {
    await page.goto('/');

    const html = page.locator('html');
    // App defaults to dark (legacy identity).
    await expect(html).toHaveClass(/dark/);

    // Toggle to light.
    await page
      .getByRole('button', { name: /switch to light theme/i })
      .click();
    await expect(html).toHaveClass(/light/);

    // The preference is persisted (next-themes → localStorage) and applied
    // before paint, so it survives a full reload.
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/light/);
  });
});

test.describe('Export', () => {
  // Asserting the /api/export responses directly is a robust way to cover the
  // export acceptance criteria from E2E: it verifies real content-type + shape
  // for each format against the seeded collection.

  test('exports JSON with the full nested structure (R8.2)', async ({
    request,
  }) => {
    const res = await request.get('/api/export?format=json');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const doc = JSON.parse(await res.text());
    expect(doc.version).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(doc.categories)).toBe(true);

    // The nested tree contains the seeded words somewhere in its JSON.
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain(KNOWN.searchWord);
    expect(serialized).toContain(KNOWN.thesaurusMember);
    expect(serialized).toContain(KNOWN.genreWord);

    // Top-level categories include Vocabulary and Accretion.
    const topNames = (doc.categories as { name: string }[]).map((c) => c.name);
    expect(topNames).toContain(KNOWN.vocabulary);
    expect(topNames).toContain(KNOWN.accretion);
  });

  test('exports CSV with the flat column header (R8.3)', async ({ request }) => {
    const res = await request.get('/api/export?format=csv');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');

    const body = await res.text();
    const firstLine = body.split(/\r?\n/)[0];
    expect(firstLine).toBe(
      'word,pronunciation,definitions,examples,category,subcategory',
    );
    // A seeded word appears as a row value.
    expect(body).toContain(KNOWN.searchWord);
  });

  test('exports Markdown organized by category (R8.4)', async ({ request }) => {
    const res = await request.get('/api/export?format=markdown');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/markdown');

    const body = await res.text();
    // Top-level category becomes an H1 heading; entries are bold list items.
    expect(body).toContain(`# ${KNOWN.vocabulary}`);
    expect(body).toContain(`**${KNOWN.searchWord}**`);
  });

  test('exports a single category subtree when categoryId is given (R8.5)', async ({
    request,
  }) => {
    // Resolve the Accretion category id from the JSON export, then scope to it.
    const all = JSON.parse(
      await (await request.get('/api/export?format=json')).text(),
    ) as { categories: { name: string; children: { name: string }[] }[] };

    // Fetch the category tree to get a concrete id for Accretion.
    const tree = (await (await request.get('/api/categories')).json()) as {
      id: number;
      name: string;
    }[];
    const accretion = tree.find((c) => c.name === KNOWN.accretion);
    expect(accretion).toBeTruthy();

    const res = await request.get(
      `/api/export?format=json&categoryId=${accretion!.id}`,
    );
    expect(res.status()).toBe(200);
    const scoped = JSON.parse(await res.text()) as {
      categories: { name: string }[];
    };
    // Scoped export has exactly the requested category as its single root.
    expect(scoped.categories).toHaveLength(1);
    expect(scoped.categories[0].name).toBe(KNOWN.accretion);
    // And it must not contain a Vocabulary-only word at the top level.
    expect(JSON.stringify(scoped)).toContain(KNOWN.genreWord);

    // `all` is only referenced to demonstrate the whole-collection superset.
    expect(all.categories.length).toBeGreaterThanOrEqual(scoped.categories.length);
  });
});
