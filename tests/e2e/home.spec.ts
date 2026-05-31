import { test, expect } from '@playwright/test';

// Placeholder E2E so the Playwright toolchain is verifiable. Full key-flow
// coverage (create/edit/delete/search/navigate/theme/export) lands in Task 20.
test('home page shows the app title', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /lexical resources system/i }),
  ).toBeVisible();
});
