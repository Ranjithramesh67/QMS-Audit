import { expect, request as apiRequest, test, type Locator, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, gotoNav, openCreateDialog, uniqueName } from './helpers';

/**
 * Audit Setup masters (Standards, Audit Types, Checklists, Clauses, Programmes).
 *
 * Every page is rendered by the generic ResourcePage component, so the CRUD
 * flow is uniform: create -> row appears -> search filters -> edit -> delete.
 * Deletes are soft (the backend flips `active` to false) and the list endpoint
 * does not filter on `active`, so a deleted row still renders; we therefore
 * assert the success toast rather than row removal.
 *
 * The rate limiter on /api/auth is shared across the whole test run, so tokens
 * are fetched once in beforeAll and reused. Full page boots also hydrate the
 * user via /auth/me, which shares that limiter, so boots are retried.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/** Short, collision-resistant code kept within the backend's max field length. */
const shortCode = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase()}`;

/** Rows rendered in the data table body. */
const tableRows = (page: Page) => page.locator('tbody tr');
const rowWith = (page: Page, text: string): Locator => page.getByRole('row').filter({ hasText: text });
const searchBox = (page: Page) => page.getByPlaceholder('Search...');

/**
 * Fetch a JWT, honouring the backend's shared /api/auth rate limit. When the
 * limiter is saturated by a concurrent run, wait out the advertised reset
 * window and retry (bounded) instead of failing the suite.
 */
async function fetchToken(email: string): Promise<string> {
  const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const deadline = Date.now() + 13 * 60 * 1000;
    for (;;) {
      const res = await ctx.post('/api/auth/login', { data: { email, password: DEMO.password } });
      if (res.ok()) return ((await res.json()) as { token: string }).token;
      if (res.status() !== 429 || Date.now() > deadline) {
        throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
      }
      const retryAfter = Number(res.headers()['retry-after'] ?? '15');
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 5_000), 60_000)));
    }
  } finally {
    await ctx.dispose();
  }
}

const tokens = { qmr: '', auditor: '' };

/** Seed a pre-fetched token into localStorage before the app boots. */
async function signIn(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value as string);
    },
    [TOKEN_KEY, token] as [string, string],
  );
}

/**
 * Boot the app directly on a route and wait for its PageHeader. Retries cover
 * transient rate-limited /auth/me responses which bounce the app to /login.
 */
async function openAt(page: Page, token: string, path: string, heading: string): Promise<void> {
  await signIn(page, token);
  await expect(async () => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 90_000, intervals: [0, 2_000, 4_000, 8_000, 15_000] });
}

// The dev server can be slow under load; allow generous, non-flaky timeouts.
test.use({ navigationTimeout: 90_000, actionTimeout: 30_000, trace: 'off' });

test.describe('Audit Setup masters', () => {
  // The first token fetch may need to wait out a saturated auth rate limit.
  test.describe.configure({ timeout: 14 * 60 * 1000 });

  test.beforeAll(async () => {
    tokens.qmr = await fetchToken(DEMO.qmr.email);
    tokens.auditor = await fetchToken(DEMO.auditor.email);
  });

  test('Standards: create, search, edit and delete', async ({ page }) => {
    const name = uniqueName('Standard');
    const renamed = `${name} edited`;
    const code = shortCode('STD');

    await openAt(page, tokens.qmr, '/masters/standards', 'Standard');
    await expect(tableRows(page).first()).toBeVisible();

    // Create -----------------------------------------------------------------
    const createDialog = await openCreateDialog(page);
    await createDialog.locator('#code').fill(code);
    await createDialog.locator('#name').fill(name);
    await createDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Standard created')).toBeVisible();
    await expect(createDialog).toBeHidden();

    // Search filters down to the created record ------------------------------
    await searchBox(page).fill(name);
    await expect(tableRows(page)).toHaveCount(1);
    await expect(rowWith(page, name)).toBeVisible();

    // Edit -------------------------------------------------------------------
    await searchBox(page).fill('');
    await rowWith(page, name).getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByText('Edit Standard')).toBeVisible();
    await editDialog.locator('#name').fill(renamed);
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Standard updated')).toBeVisible();
    await expect(editDialog).toBeHidden();

    await searchBox(page).fill(renamed);
    await expect(tableRows(page)).toHaveCount(1);
    await expect(rowWith(page, renamed)).toBeVisible();

    // Delete (soft) ----------------------------------------------------------
    await rowWith(page, renamed).getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByText('Delete Standard?')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Standard deleted')).toBeVisible();
  });

  test('Audit Types: create, search and delete', async ({ page }) => {
    const name = uniqueName('AuditType');
    const code = shortCode('AT');

    await openAt(page, tokens.qmr, '/masters/audit-types', 'Audit Type');
    await expect(rowWith(page, 'System Audit')).toBeVisible();

    // Create (category defaults to SYSTEM via createDefaults) ----------------
    const dialog = await openCreateDialog(page);
    await dialog.locator('#code').fill(code);
    await dialog.locator('#name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Audit Type created')).toBeVisible();
    await expect(dialog).toBeHidden();

    // Search filters to the created record -----------------------------------
    await searchBox(page).fill(name);
    await expect(rowWith(page, name)).toBeVisible();
    await expect(rowWith(page, 'System Audit')).toHaveCount(0);

    // Delete -----------------------------------------------------------------
    await rowWith(page, name).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Audit Type deleted')).toBeVisible();
  });

  test('Checklists: seeded list loads, search filters and create works', async ({ page }) => {
    const name = uniqueName('Checklist');
    const code = shortCode('CL');

    await openAt(page, tokens.qmr, '/masters/checklists', 'Checklist');
    await expect(rowWith(page, 'ISO 9001:2015 Audit Checklist')).toBeVisible();
    await expect(rowWith(page, 'IATF 16949 Audit Checklist')).toBeVisible();

    await searchBox(page).fill('IATF 16949 Audit Checklist');
    await expect(rowWith(page, 'IATF 16949 Audit Checklist')).toBeVisible();
    await expect(rowWith(page, 'ISO 9001:2015 Audit Checklist')).toHaveCount(0);
    await searchBox(page).fill('');
    await expect(rowWith(page, 'ISO 9001:2015 Audit Checklist')).toBeVisible();

    // Create against a seeded standard ---------------------------------------
    const dialog = await openCreateDialog(page);
    await dialog.getByRole('combobox').first().click();
    const option = page.getByRole('option', { name: 'ISO 9001' });
    await expect(option).toBeVisible();
    await option.click();
    await dialog.locator('#code').fill(code);
    await dialog.locator('#name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Checklist created')).toBeVisible();

    await searchBox(page).fill(name);
    await expect(rowWith(page, name)).toBeVisible();

    // Delete -----------------------------------------------------------------
    await rowWith(page, name).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Checklist deleted')).toBeVisible();
  });

  test('Clauses: seeded list loads and search filters', async ({ page }) => {
    await openAt(page, tokens.qmr, '/masters/clauses', 'Clause');

    // The list loads. Page 1 mixes clause trees because each checklist's
    // sortOrder restarts at zero, so assert on aggregate rows, not one clause.
    await expect(tableRows(page).first()).toBeVisible();

    // Search filters down to a clause title that is unique across the seed.
    await searchBox(page).fill('Management review');
    await expect(tableRows(page)).toHaveCount(1);
    await expect(rowWith(page, 'Management review')).toBeVisible();

    // A clause from a different checklist is reachable via search too.
    await searchBox(page).fill('Product safety');
    await expect(rowWith(page, 'Product safety')).toBeVisible();
    await expect(rowWith(page, 'Management review')).toHaveCount(0);

    // Clearing the search restores the unfiltered list.
    await searchBox(page).fill('');
    await expect(tableRows(page).first()).toBeVisible();
  });

  test('Audit Programmes: seeded list loads', async ({ page }) => {
    await openAt(page, tokens.qmr, '/masters/programs', 'Audit Programme');
    await expect(rowWith(page, 'Annual Audit Programme 2026')).toBeVisible();

    await searchBox(page).fill('Annual Audit Programme 2026');
    await expect(rowWith(page, 'Annual Audit Programme 2026')).toBeVisible();
  });

  test('Sidebar navigation opens Standards and Audit Types with PageHeader titles', async ({ page }) => {
    await signIn(page, tokens.qmr);
    await expect(async () => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 90_000, intervals: [0, 2_000, 4_000, 8_000, 15_000] });

    await gotoNav(page, 'Standards');
    await expect(page).toHaveURL(/\/masters\/standards$/);
    await expect(page.getByRole('heading', { name: 'Standard', exact: true })).toBeVisible();

    await gotoNav(page, 'Audit Types');
    await expect(page).toHaveURL(/\/masters\/audit-types$/);
    await expect(page.getByRole('heading', { name: 'Audit Type', exact: true })).toBeVisible();
  });

  test('RBAC: AUDITOR is denied access to Standards', async ({ page }) => {
    await openAt(page, tokens.auditor, '/masters/standards', 'Access denied');
    await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0);
  });
});
